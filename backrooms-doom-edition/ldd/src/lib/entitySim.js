// ============================================================================
//  Tiered entity simulation.
//
//  Entities are DATA RECORDS first, physical things second. Each record holds
//  only { id, type, x, y, state, target, lastSim, ... } and can persist with no
//  ongoing simulation. Three tiers by distance to the player:
//
//    Tier 1  ACTIVE   (<= R1)  full AI via stepActive(): pathfinding, LOS,
//                              contact, recording, audio, rendering. Capped to
//                              `maxActive` (the nearest few) for stable cost.
//    Tier 2  DORMANT  (<= R2)  cheap drift toward a roaming target at a low
//                              tick rate. No pathfinding/LOS. Not rendered.
//    Tier 3  ABSTRACT (> R2)   NOT ticked at all. When the player returns, the
//                              record is fast-forwarded mathematically across
//                              the elapsed time to where it "would" be.
//
//  Records beyond the awareness radius are culled (migrated out of the world);
//  new ones spawn at the fringe (migrated in), so the population — and cost —
//  stays bounded while the world feels continuously inhabited.
// ============================================================================

import { ENTITY_PARAMS, makeSteer, stepActive, damageEntity, hasLOS } from './entities.js';

const R1 = 18;      // active radius (cells)
const R2 = 42;      // dormant radius
const AWARE = 80;   // beyond this, records are culled
const SUBSTEP = 1000;   // ms — fixed integration step (active drift & fast-forward agree)
const REROLL = 4000;    // ms — abstract target re-roll bucket

// lazy-roam speeds (cells/sec) — slower than active pursuit; pure ambience
const ABSTRACT_SPEED = { wanderer: 0.6, watcher: 0.9, smiler: 0.8, hound: 1.4 };

function hashId(id, bucket) {
  let h = (Math.imul(id | 0, 2654435761) ^ Math.imul(bucket | 0, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const f01 = (h) => (h >>> 8) / 16777216;

export function createEntitySim(world, opts = {}) {
  const maxActive = opts.maxActive || 5;
  const records = [];
  const killed = {};
  let _id = 1, clock = 0, spawnCd = 1500;
  let dormantAccum = 0;
  const steer = makeSteer(world);
  const tierCounts = { active: 0, dormant: 0, abstract: 0 };

  function pickType(sanity) {
    const dread = (100 - sanity) / 100;
    const r = Math.random();
    if (r < 0.30 + dread * 0.10) return 'wanderer';
    if (r < 0.55 + dread * 0.05) return 'watcher';
    if (r < 0.80) return 'smiler';
    return 'hound';
  }

  function reroll(rec, bucket, player) {
    const h = hashId(rec.id, bucket);
    const a = f01(h) * Math.PI * 2;
    const r = 8 + f01(h >>> 7) * 16;
    if (rec.state === 'hunt' && player) {
      // home toward the player's area with some noise — "hunting" migration
      rec.tx = player.x + Math.cos(a) * (3 + f01(h >>> 3) * 5);
      rec.ty = player.y + Math.sin(a) * (3 + f01(h >>> 3) * 5);
    } else {
      rec.tx = rec.x + Math.cos(a) * r;
      rec.ty = rec.y + Math.sin(a) * r;
    }
  }

  // Integrate lazy roaming for `ms` of elapsed time, in fixed SUBSTEPs so the
  // dormant path and the abstract fast-forward path produce the same motion.
  function drift(rec, startClock, ms, player) {
    const sp = ABSTRACT_SPEED[rec.type] || 0.7;
    let c = startClock, remain = Math.min(ms, 60000);   // cap for safety
    while (remain > 0) {
      const bucket = Math.floor(c / REROLL);
      if (rec.tx === undefined || Math.hypot(rec.tx - rec.x, rec.ty - rec.y) < 1.2) reroll(rec, bucket, player);
      const stepMs = Math.min(remain, SUBSTEP);
      const dx = rec.tx - rec.x, dy = rec.ty - rec.y, d = Math.hypot(dx, dy) || 1;
      const adv = Math.min(d, sp * (stepMs / 1000));
      rec.x += dx / d * adv; rec.y += dy / d * adv;
      remain -= stepMs; c += stepMs;
    }
    if (world.isWall(Math.floor(rec.x), Math.floor(rec.y))) {
      const o = world.openCellNear(Math.round(rec.x), Math.round(rec.y), 10, 1);
      rec.x = o.x; rec.y = o.y; rec.tx = undefined;
    }
    rec.lastSim = clock;
  }

  // Advance an abstract record across the gap since it was last simulated, and
  // progress its behavioural state statistically (a hound left alone grows
  // hungry → likelier to be hunting when you meet it again).
  function fastForward(rec, player) {
    const elapsed = clock - (rec.lastSim || clock);
    if (elapsed > 0) drift(rec, rec.lastSim || clock, elapsed, player);
    if (rec.type === 'hound') {
      const pHunt = 1 - Math.exp(-elapsed / 30000);
      const h = hashId(rec.id, Math.floor(clock / REROLL) ^ 0x55);
      rec.state = f01(h) < pHunt ? 'hunt' : 'roam';
    }
  }

  function targetPop(sanity) {
    // base 8..14, scaled up 1.5% per the latest tuning pass
    return Math.round((8 + (100 - sanity) / 100 * 6) * 1.015);
  }

  function initialState(type) {
    if (type === 'hound') return Math.random() < 0.6 ? 'hunt' : 'roam';
    if (type === 'smiler' || type === 'watcher') return Math.random() < 0.25 ? 'hunt' : 'roam';
    return 'roam';
  }
  function spawnRecord(player, sanity, near) {
    const type = pickType(sanity);
    const rLo = near ? R1 + 1 : R2 + 4;
    const rHi = near ? R2 - 2 : AWARE - 8;
    for (let t = 0; t < 16; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = rLo + Math.random() * (rHi - rLo);
      const gx = Math.round(player.x + Math.cos(a) * r), gy = Math.round(player.y + Math.sin(a) * r);
      if (!world.isOpen(gx, gy)) continue;
      records.push({ id: _id++, type, x: gx + 0.5, y: gy + 0.5, state: initialState(type), tx: undefined, ty: undefined, lastSim: clock, glow: 0, capture: 0, wanderA: Math.random() * 6.28, dist: r, _tier: near ? 'dormant' : 'abstract' });
      return;
    }
  }

  // dt ms. ctx {flashlight,recording,moving,sanity}. cb {onKill,onAlert}
  function update(dt, player, ctx, cb) {
    clock += dt;

    // --- population: cull far, spawn at fringe to maintain target count ---
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      const d = Math.hypot(r.x - player.x, r.y - player.y);
      r.dist = d;
      if (d > AWARE) records.splice(i, 1);
    }
    spawnCd -= dt;
    if (spawnCd <= 0) {
      const nearCount = records.reduce((n, r) => n + (r.dist <= R2 ? 1 : 0), 0);
      if (nearCount < 3) spawnRecord(player, ctx.sanity, true);          // guarantee a nearby threat
      else if (records.length < targetPop(ctx.sanity)) spawnRecord(player, ctx.sanity, false);
      spawnCd = 900 + Math.random() * 1200;
    }

    // --- classify by distance; pick nearest as ACTIVE ---
    const near = [];
    for (const r of records) {
      if (r.dist <= R1) near.push(r);
    }
    near.sort((a, b) => a.dist - b.dist);
    const activeSet = new Set(near.slice(0, maxActive));

    const dormantTick = (dormantAccum += dt) >= 250;
    if (dormantTick) dormantAccum = 0;

    tierCounts.active = 0; tierCounts.dormant = 0; tierCounts.abstract = 0;

    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      const wasActive = r._active === true;

      if (activeSet.has(r)) {
        // promote: if it was abstract, advance it across the gap first
        if (!wasActive && r._tier === 'abstract') fastForward(r, player);
        r._active = true; r._tier = 'active'; tierCounts.active++;
        const status = stepActive(world, r, player, ctx, cb, steer, dt);
        if (status === 'killed') { killed[r.type] = (killed[r.type] || 0) + 1; cb.onKill && cb.onKill(r.type, r); records.splice(i, 1); }
        else if (status === 'despawn') { records.splice(i, 1); }
      } else if (r.dist <= R2) {
        // DORMANT: cheap drift at low rate; clear transient active fields
        if (wasActive) { r._active = false; r.wx = undefined; r._pt = 0; }
        r._tier = 'dormant'; tierCounts.dormant++;
        if (dormantTick) drift(r, r.lastSim || clock, Math.min(clock - (r.lastSim || clock), 300), player);
      } else {
        // ABSTRACT: do nothing this frame; just stamp tier + lastSim baseline
        if (wasActive) { r._active = false; r.wx = undefined; }
        if (r._tier !== 'abstract') { r._tier = 'abstract'; r.lastSim = clock; }
        tierCounts.abstract++;
      }
    }
  }

  // Fire the weapon: find the active entity best aligned with the player's
  // aim (within `cone`, with line of sight) and deal `dmg` to it. Returns the
  // hit record (with a .killedNow flag) or null if nothing was in the beam.
  function damageAlongAim(player, dmg, cone = 0.9, range = 22) {
    const fx = Math.cos(player.angle), fy = Math.sin(player.angle);
    let best = null, bestDot = cone;
    for (const r of records) {
      if (r._tier !== 'active') continue;
      const dx = r.x - player.x, dy = r.y - player.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      if (d > range) continue;
      const dot = (dx / d) * fx + (dy / d) * fy;
      if (dot < bestDot) continue;
      if (!hasLOS(world, player.x, player.y, r.x, r.y)) continue;
      best = r; bestDot = dot;
    }
    if (!best) return null;
    // closer = more aligned damage; falloff is gentle so it stays usable
    const kn = damageEntity(best, dmg);
    best.killedNow = kn;
    if (kn) {
      killed[best.type] = (killed[best.type] || 0) + 1;
      const i = records.indexOf(best);
      if (i >= 0) records.splice(i, 1);
    }
    return best;
  }

  return {
    update, damageAlongAim,
    get physical() { return records.filter((r) => r._tier === 'active'); },
    records, killed, documented: killed, tierCounts,
    get count() { return records.length; },
    stats() { return { total: records.length, ...tierCounts }; },
    reset() { records.length = 0; for (const k in killed) delete killed[k]; clock = 0; spawnCd = 1500; },
  };
}
