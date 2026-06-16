// ============================================================================
//  World streaming — chunk manager.
//
//  The world is infinite but only a small window exists in memory. Geometry is
//  a PURE FUNCTION of (seed, global cell) so any chunk regenerates byte-for-byte
//  from its coordinates — unload is lossless. A separate "overrides" diff stores
//  the only things that aren't reproducible from the seed (e.g. an item you
//  picked up), so persistent change survives unload/reload.
//
//  Tiers of existence for GEOMETRY:
//    loaded   chunk grid baked into a Uint8Array (fast lookup, near the player)
//    abstract far cells are computed on demand for long rays but never retained
//
//  update(px,py) keeps a ring of chunks loaded around the player, generates a
//  forward ring AHEAD of movement within a per-frame time budget, and unloads
//  everything past the radius so memory is bounded no matter how far you walk.
// ============================================================================

const CHUNK = 16;            // cells per chunk side
// ---- LAYOUT (tune for feel) ------------------------------------------------
// MASSIVE open rooms joined by WIDE hallways, with random corridors cutting
// across so the place feels like an endless noclipped void, not a tidy grid.
const HALL_W = 4;            // hallway width in cells   (raise = WIDER halls)
const ROOM = 24;             // room size between halls   (raise = BIGGER rooms /
                             //                            LONGER straight runs)
const P = HALL_W + ROOM;     // layout period (28): cross-corridors every P cells
const B = P;                 // legacy alias for the room/zone period
export const WALL = 1, FLOOR = 0;

function hash2(x, y, salt = 0) {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const frac = (h) => (h >>> 8) / 16777216;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Deterministic, seamless geometry: MASSIVE open rooms joined by wide hallways,
// with random corridors carved straight across rooms (joining halls at odd
// places) so the layout feels like an endless noclipped void. Pure fn of coords.
function makeGeometry(S) {
  const doorH = (rcx, rcy) => 1 + (hash2(rcx, rcy, S ^ 0x11) % (ROOM - 3));
  const doorV = (rcx, rcy) => 1 + (hash2(rcx, rcy, S ^ 0x22) % (ROOM - 3));
  const roomStyle = (rcx, rcy) => hash2(rcx, rcy, S ^ 0x55) % 5;            // 0,1 open; 2 sparse; 3 grid; 4 mass
  const openRoom = (rcx, rcy) => (hash2(rcx, rcy, S ^ 0x33) % 100) < 40;    // ~40%: walls gone -> merges into a huge space
  // random branching corridors: a 2-wide lane cut straight across the room,
  // punching through walls to join the hallways on either side.
  const slotH = (rcx, rcy) => { const h = hash2(rcx, rcy, S ^ 0xA17); return (h % 100) < 50 ? 2 + (h >> 9) % (ROOM - 5) : -1; };
  const slotV = (rcx, rcy) => { const h = hash2(rcx, rcy, S ^ 0xB28); return (h % 100) < 50 ? 2 + (h >> 9) % (ROOM - 5) : -1; };
  return function cellWall(gx, gy) {
    gx |= 0; gy |= 0;
    const px = ((gx % P) + P) % P, py = ((gy % P) + P) % P;
    if (px < HALL_W || py < HALL_W) return FLOOR;                           // wide hallways
    const rcx = Math.floor(gx / P), rcy = Math.floor(gy / P);
    const rx = px - HALL_W, ry = py - HALL_W;                                // 0..ROOM-1 inside the room
    // random corridors shooting across (carved through walls and all)
    const sh = slotH(rcx, rcy); if (sh >= 0 && (ry === sh || ry === sh + 1)) return FLOOR;
    const sv = slotV(rcx, rcy); if (sv >= 0 && (rx === sv || rx === sv + 1)) return FLOOR;
    if (openRoom(rcx, rcy)) {                                               // MASSIVE open space, only a few columns
      return (rx % 6 === 3 && ry % 6 === 3 && (hash2(gx, gy, S ^ 0x66) % 100) < 35) ? WALL : FLOOR;
    }
    const onWall = rx === 0 || ry === 0 || rx === ROOM - 1 || ry === ROOM - 1;
    if (onWall) {                                                          // wall ring w/ doorways onto the halls
      const dh = doorH(rcx, rcy), dv = doorV(rcx, rcy);
      if ((ry === 0 || ry === ROOM - 1) && (rx === dh || rx === dh + 1)) return FLOOR;
      if ((rx === 0 || rx === ROOM - 1) && (ry === dv || ry === dv + 1)) return FLOOR;
      return WALL;
    }
    const style = roomStyle(rcx, rcy);                                     // interior
    if (style <= 1) return FLOOR;                                          // big empty room
    if (style === 4) { const c = (ROOM - 1) >> 1; return (Math.abs(rx - c) <= 2 && Math.abs(ry - c) <= 2) ? WALL : FLOOR; }
    if (rx % 5 === 2 && ry % 5 === 2) return style === 3 ? WALL : ((hash2(gx, gy, S ^ 0x77) % 100) < 45 ? WALL : FLOOR);
    return FLOOR;
  };
}

export function createChunkManager(seed = (Math.random() * 1e9) | 0, opts = {}) {
  const S = seed | 0;
  const cellWall = makeGeometry(S);
  const loadR = opts.loadRadius ?? 4;       // generate this many chunks around player
  const unloadR = opts.unloadRadius ?? 6;   // drop chunks past this (hysteresis vs loadR)
  const budgetMs = opts.budgetMs ?? 2;      // async generation time budget per update

  const chunks = new Map();                 // key -> { cx, cy, grid:Uint8Array, lastTouch }
  const overrides = new Map();              // "gx,gy" -> FLOOR/WALL persistent diff
  const takenItems = new Set();             // persistent: items consumed (by id)
  const genQueue = [];
  const inQueue = new Set();
  let generatedCount = 0, unloadedCount = 0;

  const ck = (cx, cy) => cx + ',' + cy;
  const cc = (g) => Math.floor(g / CHUNK);

  function bake(cx, cy) {
    const grid = new Uint8Array(CHUNK * CHUNK);
    const ox = cx * CHUNK, oy = cy * CHUNK;
    for (let y = 0; y < CHUNK; y++) {
      for (let x = 0; x < CHUNK; x++) {
        const gx = ox + x, gy = oy + y;
        const ov = overrides.get(gx + ',' + gy);
        grid[y * CHUNK + x] = ov === undefined ? cellWall(gx, gy) : ov;
      }
    }
    chunks.set(ck(cx, cy), { cx, cy, grid, lastTouch: now() });
    generatedCount++;
  }

  function enqueue(cx, cy) {
    const k = ck(cx, cy);
    if (chunks.has(k) || inQueue.has(k)) return;
    inQueue.add(k); genQueue.push([cx, cy]);
  }

  // Stream around the player. vx,vy (optional) bias generation AHEAD of motion.
  function update(px, py, vx = 0, vy = 0) {
    const pcx = cc(px), pcy = cc(py);
    // enqueue nearest-first rings; push the forward chunk first for predictiveness
    if (vx || vy) {
      const fx = pcx + Math.sign(vx), fy = pcy + Math.sign(vy);
      enqueue(fx, pcy); enqueue(pcx, fy); enqueue(fx, fy);
    }
    for (let r = 0; r <= loadR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          enqueue(pcx + dx, pcy + dy);
        }
      }
    }
    // async generation within a time budget (spread across frames)
    const t0 = now();
    while (genQueue.length && now() - t0 < budgetMs) {
      const [cx, cy] = genQueue.shift(); inQueue.delete(ck(cx, cy)); bake(cx, cy);
    }
    // unload past the radius (geometry is regenerable; only the diff persists)
    for (const [k, ch] of chunks) {
      if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cy - pcy)) > unloadR) {
        chunks.delete(k); unloadedCount++;
      }
    }
  }

  // Geometry lookup. Loaded -> O(1) array read; far -> computed on demand
  // (abstract tier) and not retained, so rays still see distant walls.
  function isWall(gx, gy) {
    gx |= 0; gy |= 0;
    const ch = chunks.get(ck(cc(gx), cc(gy)));
    if (ch) { const lx = gx - ch.cx * CHUNK, ly = gy - ch.cy * CHUNK; return ch.grid[ly * CHUNK + lx]; }
    const ov = overrides.get(gx + ',' + gy);
    return ov === undefined ? cellWall(gx, gy) : ov;
  }
  const isOpen = (gx, gy) => isWall(gx, gy) === FLOOR;

  // Persistent edit (survives unload via the overrides diff).
  function setCell(gx, gy, v) {
    overrides.set(gx + ',' + gy, v);
    const ch = chunks.get(ck(cc(gx), cc(gy)));
    if (ch) ch.grid[(gy - ch.cy * CHUNK) * CHUNK + (gx - ch.cx * CHUNK)] = v;
  }

  function openCellNear(cx, cy, radius = 8, minD = 3) {
    for (let t = 0; t < 80; t++) {
      const a = frac(hash2(cx, cy, S ^ (0x700 + t))) * Math.PI * 2;
      const r = minD + frac(hash2(cy, cx, S ^ (0x800 + t))) * (radius - minD);
      const gx = Math.round(cx + Math.cos(a) * r), gy = Math.round(cy + Math.sin(a) * r);
      if (isOpen(gx, gy)) return { x: gx + 0.5, y: gy + 0.5 };
    }
    for (let r = minD; r < radius + 8; r++)
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++)
        if (isOpen(cx + dx, cy + dy)) return { x: cx + dx + 0.5, y: cy + dy + 0.5 };
    return { x: cx + 0.5, y: cy + 0.5 };
  }

  // ---- biomes / zones (palette + audio bed shift every ~40 cells) ----
  const ZONE = 40;
  const zoneAt = (gx, gy) => hash2(Math.floor(gx / ZONE), Math.floor(gy / ZONE), S ^ 0xABCD) % 6;
  const isSafeRoom = (gx, gy) => (hash2(Math.floor(gx / P), Math.floor(gy / P), S ^ 0xCAFE) % 100) < 6;
  // Dark rooms: ~16% of rooms have dead fluorescents (0 = lit .. 1 = pitch
  // black). Hallways always stay lit so you can navigate; only the set-back
  // rooms go dark.
  function darkness(gx, gy) {
    const px = ((gx % P) + P) % P, py = ((gy % P) + P) % P;
    if (px < HALL_W || py < HALL_W) return 0;            // hallways stay lit
    if (isSafeRoom(gx, gy)) return 0;
    const h = hash2(Math.floor(gx / P), Math.floor(gy / P), S ^ 0xDA12) % 100;
    if (h >= 16) return 0;
    return 0.7 + (h / 16) * 0.3;
  }

  // almond water sits at the centre of ~12% of rooms
  function almondInRoom(rcx, rcy) {
    const id = 'al:' + rcx + ',' + rcy;
    if (takenItems.has(id)) return null;
    if ((hash2(rcx, rcy, S ^ 0x99) % 100) >= 12) return null;
    const cx = rcx * P + HALL_W + (ROOM >> 1), cy = rcy * P + HALL_W + (ROOM >> 1);
    if (!isOpen(cx, cy)) return null;
    return { x: cx + 0.5, y: cy + 0.5, id };
  }
  function almondsNear(px, py, rad = 26) {
    const out = [];
    for (let rcx = Math.floor((px - rad) / P); rcx <= Math.floor((px + rad) / P); rcx++)
      for (let rcy = Math.floor((py - rad) / P); rcy <= Math.floor((py + rad) / P); rcy++) {
        const a = almondInRoom(rcx, rcy);
        if (a) out.push(a);
      }
    return out;
  }
  const takeItem = (id) => takenItems.add(id);

  // ---- furniture: occasional pieces shoved into walls (the noclip glitch
  // aesthetic). Deterministic; placed on an open cell hard against a wall and
  // nudged INTO it so the billboard half-embeds. type 0..4.
  function propsNear(px, py, rad = 22) {
    const out = [];
    for (let rcx = Math.floor((px - rad) / P); rcx <= Math.floor((px + rad) / P); rcx++)
      for (let rcy = Math.floor((py - rad) / P); rcy <= Math.floor((py + rad) / P); rcy++) {
        const h = hash2(rcx, rcy, S ^ 0xF00D);
        const count = (h % 100) < 55 ? (1 + ((h >>> 7) % 2)) : 0;   // ~55% of rooms get 1-2 pieces
        for (let i = 0; i < count; i++) {
          const hh = hash2(rcx * 7 + i, rcy * 13 + 1, S ^ 0xBEEF);
          const ex = HALL_W + 1 + (hh % (ROOM - 2));
          const ey = HALL_W + 1 + ((hh >>> 8) % (ROOM - 2));
          const gx = rcx * P + ex, gy = rcy * P + ey;
          if (!isOpen(gx, gy)) continue;
          let fx = gx, fy = gy, adj = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (isWall(gx + dx, gy + dy)) { adj = true; fx = gx + dx * 0.45; fy = gy + dy * 0.45; break; }  // shove into the wall
          }
          if (!adj) continue;
          out.push({ x: fx + 0.5, y: fy + 0.5, type: (hh >>> 16) % 5, id: rcx + ':' + rcy + ':' + i });
        }
      }
    return out;
  }

  function stats() {
    return { loadedChunks: chunks.size, queued: genQueue.length, overrides: overrides.size, generated: generatedCount, unloaded: unloadedCount };
  }
  // Serialize only what isn't reproducible from the seed -> a tiny save file.
  function serialize() {
    return { seed: S, overrides: [...overrides], taken: [...takenItems] };
  }
  function load(save) {
    if (!save) return;
    overrides.clear(); for (const [k, v] of (save.overrides || [])) overrides.set(k, v);
    takenItems.clear(); for (const id of (save.taken || [])) takenItems.add(id);
  }

  return {
    seed: S, BLOCK: B, CHUNK,
    update, isWall, isOpen, setCell, openCellNear,
    zoneAt, isSafeRoom, darkness, almondsNear, takeItem, propsNear,
    stats, serialize, load,
  };
}
