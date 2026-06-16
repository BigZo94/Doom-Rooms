// ============================================================================
//  Infinite Backrooms world.
//
//  There are no discrete "levels" — instead one endless map generated on the
//  fly. Geometry is a PURE FUNCTION of the global cell coordinates and a world
//  seed, so any area you revisit regenerates identically (the world is
//  "saved" for free, and streaming back into an old section is seamless).
//
//  Layout grammar: a grid of rooms (6x6 interior) separated by 1-cell walls,
//  with deterministic doorways punched between neighbours so everything stays
//  connected. Rooms vary — some are open, some studded with pillars, and some
//  pairs are merged into larger halls. Zones (large regions) shift the palette
//  and audio bed so the further you wander, the stranger it feels.
// ============================================================================

const B = 7;                 // block size: 6x6 room + 1 shared wall border
export const WALL = 1;
export const FLOOR = 0;

// --- tiny stable hashes ------------------------------------------------------
function hash2(x, y, salt = 0) {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const frac = (h) => (h >>> 8) / 16777216;   // [0,1)

export function createWorld(seed = (Math.random() * 1e9) | 0) {
  const S = seed | 0;

  // doorway offset along a shared wall (1..4 so door+1 stays inside 1..6)
  const doorV = (bx, by) => 1 + (hash2(bx, by, S ^ 0x11) % 4);
  const doorH = (bx, by) => 1 + (hash2(bx, by, S ^ 0x22) % 4);
  const mergedV = (bx, by) => (hash2(bx, by, S ^ 0x33) % 100) < 15;
  const mergedH = (bx, by) => (hash2(bx, by, S ^ 0x44) % 100) < 15;

  // pillar "style" per room: 0 empty, 1 sparse, 2 grid, 3 single centre column
  const roomStyle = (bx, by) => hash2(bx, by, S ^ 0x55) % 4;

  function isWall(gx, gy) {
    gx |= 0; gy |= 0;
    const bx = Math.floor(gx / B), by = Math.floor(gy / B);
    const lx = gx - bx * B, ly = gy - by * B;          // 0..6
    const onV = lx === 0;                                // left shared wall
    const onH = ly === 0;                                // top shared wall

    if (onV && onH) return WALL;                         // wall-grid junction

    if (onV) {
      if (mergedV(bx, by)) return FLOOR;                 // rooms fused L<->R
      const d = doorV(bx, by);
      return (ly === d || ly === d + 1) ? FLOOR : WALL;  // 2-wide doorway
    }
    if (onH) {
      if (mergedH(bx, by)) return FLOOR;                 // rooms fused U<->D
      const d = doorH(bx, by);
      return (lx === d || lx === d + 1) ? FLOOR : WALL;
    }

    // ---- interior: pillars ----
    const style = roomStyle(bx, by);
    if (style === 0) return FLOOR;                       // open room
    if (style === 3) {                                   // one central column
      return (lx >= 3 && lx <= 4 && ly >= 3 && ly <= 4) ? WALL : FLOOR;
    }
    // sparse / grid pillars sit on odd interior cells
    if (lx % 2 === 1 && ly % 2 === 1) {
      if (style === 2) return WALL;                      // full pillar grid
      return (hash2(gx, gy, S ^ 0x66) % 100) < 55 ? WALL : FLOOR; // sparse
    }
    return FLOOR;
  }

  // Is a whole cell safely open (floor) — convenience for spawns/collision.
  const isOpen = (gx, gy) => isWall(gx, gy) === FLOOR;

  // Find an open cell near (cx,cy) within radius, min distance minD from it.
  function openCellNear(cx, cy, radius = 8, minD = 3) {
    for (let tries = 0; tries < 80; tries++) {
      const a = frac(hash2(cx, cy, S ^ (0x700 + tries))) * Math.PI * 2;
      const r = minD + frac(hash2(cy, cx, S ^ (0x800 + tries))) * (radius - minD);
      const gx = Math.round(cx + Math.cos(a) * r);
      const gy = Math.round(cy + Math.sin(a) * r);
      if (isOpen(gx, gy) && isOpen(gx + 1, gy) && isOpen(gx - 1, gy)) return { x: gx + 0.5, y: gy + 0.5 };
    }
    // fallback: scan outward
    for (let r = minD; r < radius + 6; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const gx = cx + dx, gy = cy + dy;
        if (isOpen(gx, gy)) return { x: gx + 0.5, y: gy + 0.5 };
      }
    }
    return { x: cx + 0.5, y: cy + 0.5 };
  }

  // ---- zones: large regions (~ every 40 cells) pick a palette + audio bed ----
  const ZONE = 40;
  function zoneAt(gx, gy) {
    const zx = Math.floor(gx / ZONE), zy = Math.floor(gy / ZONE);
    return hash2(zx, zy, S ^ 0xABCD) % 6;          // 0..5 -> palette index
  }

  // ---- almond water pickups: rare, deterministic, one per some rooms --------
  // Returns the pickup world-pos for a room if it has one, else null.
  function almondInRoom(bx, by) {
    if ((hash2(bx, by, S ^ 0x99) % 100) >= 12) return null;   // ~12% of rooms
    // place near room centre on an open cell
    const cx = bx * B + 3, cy = by * B + 3;
    if (!isOpen(cx, cy)) return null;
    return { x: cx + 0.5, y: cy + 0.5 };
  }
  // list almond pickups within a cell radius of (px,py)
  function almondsNear(px, py, rad = 26) {
    const out = [];
    const b0x = Math.floor((px - rad) / B), b1x = Math.floor((px + rad) / B);
    const b0y = Math.floor((py - rad) / B), b1y = Math.floor((py + rad) / B);
    for (let bx = b0x; bx <= b1x; bx++) for (let by = b0y; by <= b1y; by++) {
      const a = almondInRoom(bx, by);
      if (a) out.push({ ...a, id: bx + ',' + by });
    }
    return out;
  }

  // "Safe room": some rooms are brightly lit havens that restore sanity.
  function isSafeRoom(gx, gy) {
    const bx = Math.floor(gx / B), by = Math.floor(gy / B);
    return (hash2(bx, by, S ^ 0xCAFE) % 100) < 6;     // ~6% of rooms
  }

  // "Dark room": some rooms have dead fluorescents and sit in near-blackness.
  // Returns 0 for a normally-lit room, up to 1 for pitch black. Safe rooms are
  // never dark. ~16% of rooms are dark, and of those the darkest are rare, so
  // most of the world stays lit and the flashlight matters only in pockets.
  function darkness(gx, gy) {
    const bx = Math.floor(gx / B), by = Math.floor(gy / B);
    if (isSafeRoom(gx, gy)) return 0;
    const h = hash2(bx, by, S ^ 0xDA12) % 100;
    if (h >= 16) return 0;                              // 84% normally lit
    // map the unlucky 0..15 bucket onto 0.7..1.0 darkness (deep gloom..black)
    return 0.7 + (h / 16) * 0.3;
  }

  return {
    seed: S, isWall, isOpen, openCellNear, zoneAt, almondsNear, almondInRoom, isSafeRoom, darkness,
    BLOCK: B,
  };
}
