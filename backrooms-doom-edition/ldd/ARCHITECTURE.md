# Infinite Backrooms — Streaming & Simulation Architecture

This document is the architecture deliverable for the world-streaming redesign.
The guiding rule is **the illusion of an infinite, continuously-active world while
only a small window is ever in memory or simulated at full fidelity.**

Everything described here is implemented and headless-tested in:

| Concern | Module |
| --- | --- |
| World streaming + chunks | `src/lib/chunkManager.js` |
| Deterministic geometry | `makeGeometry()` inside `chunkManager.js` |
| Tiered entity simulation + persistence | `src/lib/entitySim.js` |
| Per-entity AI (Tier 1) | `stepActive()` in `src/lib/entities.js` |
| Rendering (reads state only) | `src/lib/raycaster.js` |

Verified results (from the headless test runs) are quoted in **§9**.

---

## 1. World streaming architecture

The world is an infinite grid of cells (`1` = wall, `0` = floor). It is divided
into **chunks** of `16×16` cells. A `ChunkManager` owns three things:

- `chunks: Map<"cx,cy", Chunk>` — the **loaded window** (baked geometry).
- `overrides: Map<"gx,gy", cell>` — the **persistence diff** (see §3).
- `genQueue` — chunks waiting to be baked, processed under a time budget.

`update(px, py, vx, vy)` runs once per frame and does three things:

1. **Enqueue** every chunk within `loadRadius` of the player, nearest ring
   first, and (if a velocity is supplied) the chunk *ahead* of motion first so
   generation runs **predictively, before the player arrives**.
2. **Generate** from the queue until a per-frame **time budget** (`budgetMs`,
   default 2 ms) is exhausted — generation is amortised across frames so it
   never stalls the render loop.
3. **Unload** any chunk past `unloadRadius` (default 6, with hysteresis vs.
   `loadRadius` 4 so chunks don't thrash on the boundary). Unloading just drops
   the `Uint8Array`; geometry is regenerable, so this is lossless.

```
loadRadius (4)      unloadRadius (6)
   ┌─────────┐         ┌─────────────┐
   │ generate│         │   keep      │   > unloadRadius → unload
   │  ahead  │ ····    │  loaded     │ ····  (abstract, computed on demand)
   └─────────┘         └─────────────┘
            player ●
```

**Geometry lookup** (`isWall(gx, gy)`) resolves in O(1) from the owning chunk's
array when loaded. When a cell is **outside the loaded window** (e.g. a raycast
that reaches 90 cells away), it is **computed on demand from the seed and not
retained** — this is the "abstract tier" for geometry. Tests confirm the
on-demand result is byte-identical to the baked result (**§9**).

---

## 2. Chunk generation pipeline

Generation is a **pure function** `cellWall(gx, gy)` seeded by the world seed:

```
block      = 7×7  (a 6×6 room + a shared 1-cell wall border)
walls      = block borders, EXCEPT a 2-wide doorway punched at a
             seeded offset between each pair of neighbours  → always connected
merges     = ~15% of shared walls are removed entirely      → larger halls
pillars    = per-room style {empty | sparse | grid | single centre column}
biome/zone = hash(region) every 40 cells → palette + audio bed
```

Because each cell depends **only** on its global coordinates and the seed,
chunk borders line up automatically with zero seam-stitching, and **any chunk
regenerates identically forever**. Baking a chunk is just:

```js
for (y in 0..16) for (x in 0..16)
    grid[y*16+x] = override("gx,gy") ?? cellWall(ox+x, oy+y)
```

This satisfies *infinite expansion*, *deterministic regeneration*, *biome
transitions*, and *continuity across revisits*. Rooms, corridors, doorways,
merged landmarks, pillar hazards, "safe rooms", and almond-water pickups are all
emitted by this deterministic layer (`zoneAt`, `isSafeRoom`, `almondsNear`).

---

## 3. Entity persistence system

An entity is a **record**, not a live object:

```js
{
  id,            // stable unique id
  type,          // 'wanderer' | 'watcher' | 'smiler' | 'hound'
  x, y,          // last known location
  state,         // behavioural state: 'roam' | 'hunt'
  tx, ty,        // current roam/hunt attractor (target)
  lastSim,       // timestamp (sim clock ms) of last advance
  // — transient, only while ACTIVE (Tier 1): —
  wx, wy, _pt,   // pathfinding waypoint + recompute timer
  frozen, glow, capture, visible, dist
}
```

A record **never requires continuous simulation**. When it becomes relevant
(promoted toward the player) it is advanced in one shot:

```
fastForward(rec):
    elapsed = now - rec.lastSim
    drift(rec, elapsed)                 # integrate roaming over the whole gap
    if hound: p_hunt = 1 - e^(-elapsed/30s)   # statistical state progression
              rec.state = (seededRand < p_hunt) ? 'hunt' : 'roam'
    rec.lastSim = now
```

`drift()` integrates in fixed 1-second sub-steps with target re-rolls bucketed
on the **absolute** sim clock, so *fast-forwarding across a 40-second gap lands
in the same place as if the entity had been ticked every frame.* Hunting
records bias their attractor toward the player, so threats **migrate toward you
even while unsimulated**; roaming records wander. The world stays "alive"
without paying for it.

Only the **non-reproducible** facts are ever stored to persist: the chunk
`overrides` diff and the `takenItems` set. `serialize()` emits just these — in
the test a picked-up-item world serialises to **45 bytes** regardless of how far
the player has travelled.

---

## 4. Multi-tier simulation

`entitySim.update(dt, player, ctx, cb)` reclassifies every record each frame by
distance and processes it at the appropriate fidelity:

| Tier | Radius | Processing | Rendered |
| --- | --- | --- | --- |
| **1 Active** | ≤ `R1` (18), nearest `maxActive`=5 | full `stepActive()`: BFS pathfinding, line-of-sight, contact, recording, audio | yes |
| **2 Dormant** | ≤ `R2` (42) | `drift()` toward target at a **250 ms** tick; no pathfinding/LOS | no |
| **3 Abstract** | ≤ `AWARE` (80) | **nothing per frame**; advanced via `fastForward()` on promotion | no |
| — Culled | > `AWARE` | removed from the registry ("migrated away") | — |

Promotion/demotion is handled by tier transitions: crossing from abstract into
range triggers `fastForward`; entering Tier 1 instantiates transient pathfinding
fields; leaving Tier 1 strips them and stamps `lastSim`. The **active set is
capped** to the nearest 5 so per-frame AI cost is constant no matter how
crowded the region is. Population is held at a target (8–14, rising as the
player's sanity falls); a nearby threat is guaranteed (`nearCount < 3 → spawn in
the R1–R2 ring`) while the remainder spawn at the fringe for ambience.

**Rendering reads state only.** `raycaster.castRays()` receives
`entitySim.physical` (the Tier-1 list) and the `world` handle and draws the
current snapshot. It performs no world logic; simulation and presentation are
fully separated, which is also what makes the Web-Worker split in §5 a drop-in.

---

## 5. Multi-threaded simulation design

JavaScript is single-threaded, so true parallelism means a **Web Worker**. The
codebase is already structured for it: the simulation modules
(`chunkManager`, `entitySim`) are pure logic with no DOM/canvas access, and the
renderer already consumes a *snapshot* rather than driving the sim. The
production split:

```
┌──────────────── Main thread (60 fps) ─────────────────┐
│  input → player intent                                │
│  read latest SNAPSHOT (double-buffered)               │
│  castRays(ctx, localGrid, snapshot.entities)          │  ← render only
│  postMessage(playerState)            (or write SAB)   │
└───────────────────────────────────────────────────────┘
                 ▲ snapshot         ▼ playerState
┌──────────────── Simulation worker (fixed 30–60 Hz) ───┐
│  chunkManager.update(player)                          │
│  entitySim.update(dt, player, ctx)                    │
│  build SNAPSHOT { localGrid window, Tier-1 entities } │
│  postMessage(snapshot)               (or write SAB)   │
└───────────────────────────────────────────────────────┘
```

Transport options, cheapest first:

- **`SharedArrayBuffer` + `Atomics`** — the worker writes the local grid window
  and a packed entity array into shared memory; the main thread reads it with no
  copy. A seqlock (`Atomics`) gives tear-free double-buffering. Best latency.
- **Transferable `postMessage`** — transfer an `ArrayBuffer` snapshot each sim
  tick (zero-copy transfer, not structured-clone). Simpler, slightly higher
  latency; fine at 30 Hz.

Worker shell (pseudocode):

```js
// sim.worker.js
import { createChunkManager } from './chunkManager.js';
import { createEntitySim }   from './entitySim.js';
let world, sim, player = {x:0,y:0,angle:0};
onmessage = (e) => {
  if (e.data.type === 'init')  { world = createChunkManager(e.data.seed); sim = createEntitySim(world); }
  if (e.data.type === 'input') { player = e.data.player; }
};
setInterval(() => {                       // fixed-step sim, independent of render
  world.update(player.x, player.y, player.vx, player.vy);
  sim.update(SIM_DT, player, ctxFlags, callbacks);
  const snap = packSnapshot(world, sim.physical, player);   // ArrayBuffer
  postMessage(snap, [snap.buffer]);       // transferable
}, SIM_DT);
```

Render and simulation now run at independent rates; a frame-rate dip never slows
world logic, and a heavy sim tick never drops a frame. (Note: `SharedArrayBuffer`
requires the page to be served cross-origin-isolated — `COOP`/`COEP` headers.)

---

## 6. Data structures

| Structure | Type | Purpose | Bound |
| --- | --- | --- | --- |
| `chunks` | `Map<"cx,cy", {cx,cy,grid:Uint8Array,lastTouch}>` | loaded geometry window | `(2·unloadR+1)²` chunks |
| `Chunk.grid` | `Uint8Array(256)` | one chunk's cells, cache-friendly | 256 B each |
| `overrides` | `Map<"gx,gy", 0|1>` | persistent geometry diff | # of edits only |
| `takenItems` | `Set<itemId>` | consumed pickups | # consumed |
| `genQueue` / `inQueue` | array + `Set` | pending bakes (dedup) | ≤ ring size |
| `records` | `Array<EntityRecord>` | all known entities (all tiers) | ≤ ~14 |
| `activeSet` | `Set<EntityRecord>` | Tier-1 entities this frame | ≤ `maxActive` |

Keys are stringized integer pairs for simplicity; a packed `int32` key
(`(cx<<16)^cy`) or a flat typed-array spatial hash is the next step if profiling
demands it. Entity records are plain objects so they serialise directly.

---

## 7. Performance optimization strategy

- **Constant-cost frame.** Full AI is capped to the nearest `maxActive` entities;
  everything else is cheap drift or nothing. Measured: tiered sim
  **0.045 ms/frame** with 14 records (5 active). Render + 5 active entities +
  AI ≈ **4 ms/frame** (~245 fps headroom in node, pre-blit).
- **Amortised generation.** Chunk baking runs under a 2 ms/frame budget from a
  queue, so a burst of newly-revealed chunks never spikes a frame.
- **Predictive load.** The chunk ahead of the player's velocity is enqueued
  first, so geometry is ready before arrival.
- **Aggressive unload.** Memory is bounded by `unloadRadius`, *not* by distance
  travelled. Measured: after **4000 cells** of travel, loaded chunks peaked at
  **117** (cap 169) — flat, no leak.
- **Event-driven over polling.** Pathfinding recomputes on a timer / on waypoint
  arrival, not every frame; dormant entities tick at 4 Hz; audio zone changes
  fire only on region crossings.
- **Typed arrays** for chunk grids (contiguous, GC-light) and the render frame
  buffer (single `ImageData` reused per frame).

---

## 8. Example implementation pseudocode (single-thread main loop)

This is the shape of the per-frame loop wiring the modules together (the
worker version in §5 just moves the first two calls off-thread):

```js
const world = createChunkManager(seed, { loadRadius: 4, unloadRadius: 6 });
const sim   = createEntitySim(world, { maxActive: 5 });

function frame(dt) {
  // 1. intent
  applyInput(player, dt, (nx,ny) => !world.isWall(nx|0, ny|0));   // collision

  // 2. stream world around the player (budgeted, predictive)
  world.update(player.x, player.y, player.vx, player.vy);

  // 3. simulate entities in tiers
  sim.update(dt, player,
    { flashlight, recording, moving: player.speed > 0, sanity },
    { onContact: applyDamage, onDocument: logEntity, onAlert: cueAudio });

  // 4. ambient systems keyed off world state
  setZoneAudio(world.zoneAt(player.x|0, player.y|0));
  updateSpatialAudio(player, sim.physical);
  if (world.isSafeRoom(player.x|0, player.y|0)) sanity += recover * dt;

  // 5. render the current snapshot — no world logic here
  castRays(ctx, world, player, world.zoneAt(player.x|0, player.y|0),
           100 - sanity, sim.physical, flashlight);
}
```

---

## 9. Verification (headless tests)

Run without a browser via the deterministic logic modules:

```
Bounded memory   : walked 4000 cells → loaded chunks peak 117 (cap 169)  → BOUNDED
Lossless reload  : 6000 samples after unload vs fresh seed → 0 mismatches → LOSSLESS
Abstract==baked  : 4000 far/loaded comparisons → 0 mismatches             → CONSISTENT
Persistence diff : edit survives unload/reload; save = 45 bytes           → OK
Entity fast-fwd  : abstract hound roamed 11.9 cells over 30 s, no per-frame
                   sim, then promoted to active                           → LIVING
Threat migration : stationary player → first active entity at ~10 s       → OK
Pathfinding      : hound reached player in 32/32 trials across 8 seeds    → OK
Sim cost         : 0.045 ms/frame, 14 records (5 active)                  → CONSTANT
```

---

## 10. Scalability considerations for multiplayer

The single-player design generalises to authoritative multiplayer with three
changes:

1. **Server owns the sim.** `chunkManager` + `entitySim` run server-side (the
   same modules; geometry is identical from the shared seed so clients never
   download a map). Each connected player contributes a streaming centre, so the
   server keeps a **union of active windows** — load/unload/Tier logic is per
   player, deduplicated by chunk.
2. **Interest management.** Each client is sent only the chunks and **Tier-1/2
   entity snapshots within its awareness radius** (the same `AWARE` filter,
   applied per connection). Abstract entities are never transmitted; they are
   reconstructed by `fastForward` the moment they enter someone's interest set —
   so a hound that "migrated" across the map while no one watched simply appears
   at its mathematically-advanced position. Bandwidth scales with *visible*
   density, not world size.
3. **Determinism + diff sync.** Because geometry and entity progression are
   deterministic functions of `(seed, id, clock)`, the server transmits only the
   **overrides diff** and authoritative entity corrections, not full state.
   Late-joiners and re-connecting players resync from the small diff plus the
   seed.

Remaining production concerns are the usual ones — lag compensation /
client-side prediction for the local player, server tick authority for combat
and pickups (the `onContact`/`takeItem` callbacks become server-validated
events), and sharding very dense regions across worker processes (the per-player
window union makes this a natural partition). None of these require changing the
core streaming or persistence model.
