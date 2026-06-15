// ============================================================================
//  Entities — things that share the Backrooms with you.
//
//  Four distinct kinds, each with its own rule. They are dynamic (not part of
//  the saved geometry): they spawn around you out of sight, hunt by their own
//  logic, and despawn when far. You "deal with" one by DOCUMENTING it — holding
//  it in the camcorder frame long enough — which logs it and drives it off.
//
//    wanderer  drifts aimlessly; mostly harmless but frays the nerves up close.
//    watcher   a Weeping-Angel: freezes while you look at it, stalks when you
//              look away. Filming it is easy (it holds still) but it herds you.
//    smiler    a grin in the dark. Advances only when your flashlight is OFF;
//              light makes it cower. Drains sanity fast while it's in view.
//    hound     fast pack predator. Hunts by proximity and sound and will run
//              you down. The only one that does real bodily harm.
// ============================================================================

export const ENTITY_PARAMS = {
  wanderer: { speed: 0.014, sense: 6,  sanityNear: 5,  contactSanity: 4,  contactHealth: 0,  record: 2.0, despawn: 20 },
  watcher:  { speed: 0.030, sense: 16, sanityNear: 9,  contactSanity: 20, contactHealth: 0,  record: 2.6, despawn: 28, freezeWhenWatched: true },
  smiler:   { speed: 0.024, sense: 13, sanityNear: 15, contactSanity: 12, contactHealth: 6,  record: 3.2, despawn: 26, lightAverse: true },
  hound:    { speed: 0.052, sense: 12, sanityNear: 7,  contactSanity: 6,  contactHealth: 16, record: 4.2, despawn: 32, chaser: true },
};

const HALF_VIEW = 0.62;          // ~35°, "is it on screen / am I looking at it"

// Bresenham-ish line of sight over open cells.
export function hasLOS(world, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist * 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (world.isWall(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
  }
  return true;
}

function bearingDot(player, e) {
  const dx = e.x - player.x, dy = e.y - player.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const fx = Math.cos(player.angle), fy = Math.sin(player.angle);
  return (dx / d) * fx + (dy / d) * fy;   // 1 = dead ahead
}

// BFS over open cells; returns the first cell on the shortest path toward the
// target (or null if unreachable within `radius`). Used so hounds actually
// navigate rooms/doorways to reach you instead of grinding against a wall.
export function pathNextCell(world, sx, sy, tx, ty, radius = 16, limit = 700) {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  if (sx === tx && sy === ty) return null;
  const came = new Map(); const q = [[sx, sy]]; came.set(sx + ',' + sy, null);
  let n = 0, found = false;
  while (q.length && n < limit) {
    const c = q.shift(); n++;
    if (c[0] === tx && c[1] === ty) { found = true; break; }
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c[0] + d[0], ny = c[1] + d[1];
      if (Math.abs(nx - sx) > radius || Math.abs(ny - sy) > radius) continue;
      const key = nx + ',' + ny;
      if (came.has(key) || world.isWall(nx, ny)) continue;
      came.set(key, c); q.push([nx, ny]);
    }
  }
  if (!found) return null;
  let cur = [tx, ty], prev = came.get(tx + ',' + ty);
  while (prev && !(prev[0] === sx && prev[1] === sy)) { cur = prev; prev = came.get(cur[0] + ',' + cur[1]); }
  return [cur[0], cur[1]];
}

// Build a steering function bound to a world (fans out around obstacles).
export function makeSteer(world) {
  const m = 0.3;
  const freeAt = (x, y) =>
    !world.isWall(Math.floor(x + m), Math.floor(y)) && !world.isWall(Math.floor(x - m), Math.floor(y)) &&
    !world.isWall(Math.floor(x), Math.floor(y + m)) && !world.isWall(Math.floor(x), Math.floor(y - m));
  return function steer(e, dirx, diry, speed, k) {
    const base = Math.atan2(diry, dirx);
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6]) {
      const a = base + off;
      const nx = e.x + Math.cos(a) * speed * k, ny = e.y + Math.sin(a) * speed * k;
      if (freeAt(nx, ny)) { e.x = nx; e.y = ny; return a; }
    }
    return base;
  };
}

// FULL-FIDELITY (Tier 1) update for ONE entity. Pure per-entity logic — the
// caller owns the list, so this is reused by both the simple manager and the
// tiered streaming simulation. Returns 'documented' | 'despawn' | null.
export function stepActive(world, e, player, ctx, cb, steer, dt) {
  const k = dt / 16;
  const P = ENTITY_PARAMS[e.type];
  const dx = player.x - e.x, dy = player.y - e.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  e.dist = dist;
  const los = hasLOS(world, e.x, e.y, player.x, player.y);
  const dot = bearingDot(player, e);
  const onScreen = dot > HALF_VIEW && los;
  e.visible = onScreen;
  const ndx = dx / dist, ndy = dy / dist;
  const framed = ctx.recording && dot > 0.80 && los && dist < 14;

  let move = 0, ax = ndx, ay = ndy;
  if (e.type === 'wanderer') {
    if (Math.random() < 0.015) e.wanderA += (Math.random() - 0.5) * 1.2;
    ax = Math.cos(e.wanderA); ay = Math.sin(e.wanderA); move = P.speed;
  } else if (e.type === 'watcher') {
    e.frozen = onScreen;
    move = onScreen ? 0 : (dist < P.sense ? P.speed : P.speed * 0.5);
  } else if (e.type === 'smiler') {
    const lit = ctx.flashlight && dot > 0.2 && dist < 8 && los;
    if (lit) { ax = -ndx; ay = -ndy; move = P.speed * 1.2; e.frozen = false; }
    else { move = dist < P.sense ? P.speed : 0; e.frozen = false; }
    e.glow = onScreen ? Math.min(1, (e.glow || 0) + 0.05) : Math.max(0, (e.glow || 0) - 0.03);
  } else if (e.type === 'hound') {
    const heard = ctx.moving && dist < P.sense + 4;
    if (dist < P.sense || heard || los) {
      move = P.speed;
      e._pt = (e._pt || 0) - dt;
      const atWp = e.wx !== undefined && Math.hypot(e.x - e.wx, e.y - e.wy) < 0.45;
      if (e._pt <= 0 || e.wx === undefined || atWp) {
        const nc = pathNextCell(world, e.x, e.y, player.x, player.y);
        if (nc) { e.wx = nc[0] + 0.5; e.wy = nc[1] + 0.5; } else { e.wx = player.x; e.wy = player.y; }
        e._pt = 110;
      }
      ax = e.wx - e.x; ay = e.wy - e.y; const L = Math.hypot(ax, ay) || 1; ax /= L; ay /= L;
    } else {
      if (Math.random() < 0.03) e.wanderA += (Math.random() - 0.5);
      ax = Math.cos(e.wanderA); ay = Math.sin(e.wanderA); move = P.speed * 0.4; e.wx = undefined;
    }
    if (dist < 6 && cb.onAlert) cb.onAlert('hound', dist);
  }

  if (framed) move *= 0.3;
  if (move > 0 && !e.frozen) {
    const used = steer(e, ax, ay, move, k);
    if (e.type === 'wanderer' || e.type === 'hound') e.wanderA = used;
  }

  if (dist < P.sense) {
    let drain = P.sanityNear * (1 - dist / P.sense);
    if (e.type === 'smiler' && onScreen) drain *= 2.2;
    if (e.type === 'watcher' && onScreen) drain *= 0.4;
    cb.onContact && cb.onContact({ type: e.type, sanity: drain * k * 0.05, health: 0 });
  }
  if (dist < 0.6) {
    cb.onContact && cb.onContact({ type: e.type, health: P.contactHealth * k * 0.08, sanity: P.contactSanity * k * 0.08 });
    if (e.type === 'watcher' || e.type === 'wanderer') {
      const np = world.openCellNear(Math.round(e.x), Math.round(e.y), 12, 6);
      e.x = np.x; e.y = np.y; e.capture = 0;
    }
  }
  if (framed) {
    e.capture = (e.capture || 0) + dt / 1000;
    if (e.capture >= P.record) return 'documented';
  } else if (e.capture > 0) {
    e.capture = Math.max(0, e.capture - dt / 1500);
  }
  if (dist > P.despawn && !onScreen) return 'despawn';
  return null;
}

let _id = 1;
export const nextEntityId = () => _id++;

// Simple flat manager (legacy / single-tier). The streaming game uses the
// tiered simulation in entitySim.js, which reuses stepActive above.
export function createEntityManager(world, opts = {}) {
  const maxActive = opts.maxActive || 5;
  const list = [];
  const documented = {};
  let spawnCooldown = 3000;
  const steer = makeSteer(world);

  function pickType(sanity) {
    const dread = (100 - sanity) / 100;
    const r = Math.random();
    if (r < 0.30 + dread * 0.10) return 'wanderer';
    if (r < 0.55 + dread * 0.05) return 'watcher';
    if (r < 0.80) return 'smiler';
    return 'hound';
  }
  function trySpawn(player, sanity) {
    if (list.length >= maxActive) return;
    const type = pickType(sanity);
    for (let tries = 0; tries < 12; tries++) {
      const ang = Math.random() * Math.PI * 2, r = 7 + Math.random() * 6;
      const gx = Math.round(player.x + Math.cos(ang) * r), gy = Math.round(player.y + Math.sin(ang) * r);
      if (!world.isOpen(gx, gy)) continue;
      const cand = { x: gx + 0.5, y: gy + 0.5 };
      if (bearingDot(player, cand) > 0.4 && tries < 8) continue;
      list.push({ id: _id++, type, x: cand.x, y: cand.y, wanderA: Math.random() * Math.PI * 2, capture: 0, frozen: false, visible: false, dist: r, glow: 0 });
      return;
    }
  }
  function update(dt, player, ctx, cb) {
    spawnCooldown -= dt;
    if (spawnCooldown <= 0) { trySpawn(player, ctx.sanity); spawnCooldown = 2600 + Math.random() * 3000 - (100 - ctx.sanity) * 14; }
    for (let i = list.length - 1; i >= 0; i--) {
      const r = stepActive(world, list[i], player, ctx, cb, steer, dt);
      if (r === 'documented') { const t = list[i].type; documented[t] = (documented[t] || 0) + 1; cb.onDocument && cb.onDocument(t); list.splice(i, 1); }
      else if (r === 'despawn') list.splice(i, 1);
    }
  }
  return { list, documented, update, get count() { return list.length; }, reset() { list.length = 0; for (const k in documented) delete documented[k]; spawnCooldown = 3000; } };
}
