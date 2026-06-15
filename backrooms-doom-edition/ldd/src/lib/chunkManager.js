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
const B = 7;                 // room block (6x6 room + shared wall)
export const WALL = 1, FLOOR = 0;

function hash2(x, y, salt = 0) {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const frac = (h) => (h >>> 8) / 16777216;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Deterministic, seamless geometry: rooms separated by 1-cell walls with
// doorways, varied pillars, and occasional merged halls. Pure fn of coords.
function makeGeometry(S) {
  const doorV = (bx, by) => 1 + (hash2(bx, by, S ^ 0x11) % 4);
  const doorH = (bx, by) => 1 + (hash2(bx, by, S ^ 0x22) % 4);
  const mergedV = (bx, by) => (hash2(bx, by, S ^ 0x33) % 100) < 15;
  const mergedH = (bx, by) => (hash2(bx, by, S ^ 0x44) % 100) < 15;
  const roomStyle = (bx, by) => hash2(bx, by, S ^ 0x55) % 4;
  return function cellWall(gx, gy) {
    gx |= 0; gy |= 0;
    const bx = Math.floor(gx / B), by = Math.floor(gy / B);
    const lx = gx - bx * B, ly = gy - by * B;
    const onV = lx === 0, onH = ly === 0;
    if (onV && onH) return WALL;
    if (onV) { if (mergedV(bx, by)) return FLOOR; const d = doorV(bx, by); return (ly === d || ly === d + 1) ? FLOOR : WALL; }
    if (onH) { if (mergedH(bx, by)) return FLOOR; const d = doorH(bx, by); return (lx === d || lx === d + 1) ? FLOOR : WALL; }
    const style = roomStyle(bx, by);
    if (style === 0) return FLOOR;
    if (style === 3) return (lx >= 3 && lx <= 4 && ly >= 3 && ly <= 4) ? WALL : FLOOR;
    if (lx % 2 === 1 && ly % 2 === 1) {
      if (style === 2) return WALL;
      return (hash2(gx, gy, S ^ 0x66) % 100) < 55 ? WALL : FLOOR;
    }
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
  const isSafeRoom = (gx, gy) => (hash2(Math.floor(gx / B), Math.floor(gy / B), S ^ 0xCAFE) % 100) < 6;

  function almondInRoom(bx, by) {
    if (takenItems.has('al:' + bx + ',' + by)) return null;
    if ((hash2(bx, by, S ^ 0x99) % 100) >= 12) return null;
    const cx = bx * B + 3, cy = by * B + 3;
    if (!isOpen(cx, cy)) return null;
    return { x: cx + 0.5, y: cy + 0.5, id: 'al:' + bx + ',' + by };
  }
  function almondsNear(px, py, rad = 26) {
    const out = [];
    for (let bx = Math.floor((px - rad) / B); bx <= Math.floor((px + rad) / B); bx++)
      for (let by = Math.floor((py - rad) / B); by <= Math.floor((py + rad) / B); by++) {
        const a = almondInRoom(bx, by);
        if (a) out.push(a);
      }
    return out;
  }
  const takeItem = (id) => takenItems.add(id);

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
    zoneAt, isSafeRoom, almondsNear, takeItem,
    stats, serialize, load,
  };
}
