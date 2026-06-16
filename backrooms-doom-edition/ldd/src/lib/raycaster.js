// ============================================================================
//  BACKROOMS raycaster  —  textured floor/ceiling + wall casting
//  Pure-JS software renderer writing a single ImageData buffer per frame.
//  No external deps.  Aesthetic target: the mono-yellow liminal Backrooms —
//  damp wallpaper, moist office carpet, dropped-ceiling tiles w/ fluorescents.
// ============================================================================

export const SCREEN_WIDTH = 480;
export const SCREEN_HEIGHT = 270;
export const FOV = Math.PI / 3;          // 60°
export const HALF_FOV = FOV / 2;
export const MAX_DEPTH = 32;

const TEX = 64;                          // texture size (px)
const PLANE_LEN = Math.tan(HALF_FOV);    // camera-plane half-length (legacy default)
const WALL_HEIGHT = 3.15;                 // room height in world units (camera centred).
                                         // walls + floor/ceiling row-distance scale by
                                         // this together, so the wall base stays glued
                                         // to the floor — lower = less oppressive, more
                                         // open. (was 3.6 — felt claustrophobic.)

// ----------------------------------------------------------------------------
//  Per-level palettes.  Level 0 = canonical Backrooms yellow.  Deeper levels
//  shift the whole space without losing the liminal grammar.
// ----------------------------------------------------------------------------
export const LEVEL_PALETTES = [
  { // 0 — The Lobby (classic yellow)
    wall: [200,184,95], wallHi:[218,202,122], wallLo:[168,150,64], seam:[140,124,52],
    base:[110,99,48], stain:[120,108,60],
    carpet:[111,101,51], carpetLo:[78,70,36], wet:[58,52,28], fleck:[140,128,78],
    tile:[201,192,138], grout:[140,132,86], panel:[247,239,184], glow:[255,250,210],
    fog:[14,12,5],
  },
  { // 1 — Habitable Zone (yellow-green, concrete)
    wall:[178,186,96], wallHi:[198,204,120], wallLo:[150,156,66], seam:[120,126,52],
    base:[96,100,48], stain:[110,116,58],
    carpet:[96,100,52], carpetLo:[66,70,36], wet:[48,52,28], fleck:[128,132,80],
    tile:[190,194,150], grout:[126,130,92], panel:[238,242,200], glow:[250,252,220],
    fog:[10,12,6],
  },
  { // 2 — Pipe Dreams (grey-green damp)
    wall:[158,166,120], wallHi:[178,184,140], wallLo:[122,128,88], seam:[98,104,70],
    base:[84,90,62], stain:[96,102,72],
    carpet:[84,88,64], carpetLo:[56,60,42], wet:[40,44,30], fleck:[112,116,90],
    tile:[176,180,150], grout:[112,116,90], panel:[224,228,200], glow:[238,242,214],
    fog:[9,11,9],
  },
  { // 3 — Electrical Station (rust / sodium)
    wall:[196,128,72], wallHi:[214,148,90], wallLo:[150,96,56], seam:[120,76,44],
    base:[104,66,40], stain:[126,82,50],
    carpet:[112,74,44], carpetLo:[78,50,30], wet:[52,34,22], fleck:[150,104,64],
    tile:[198,160,118], grout:[140,108,72], panel:[250,212,150], glow:[255,224,168],
    fog:[14,9,5],
  },
  { // 4 — Abandoned Office (cold fluorescent blue-grey)
    wall:[150,154,176], wallHi:[172,176,198], wallLo:[112,116,140], seam:[88,92,114],
    base:[78,82,104], stain:[92,96,118],
    carpet:[88,92,112], carpetLo:[58,62,80], wet:[40,44,58], fleck:[120,124,148],
    tile:[180,184,200], grout:[120,124,146], panel:[226,232,248], glow:[240,246,255],
    fog:[8,9,13],
  },
  { // 5 — Terror Hotel (sickly teal-green)
    wall:[88,150,124], wallHi:[108,170,142], wallLo:[60,110,90], seam:[44,86,70],
    base:[44,84,68], stain:[54,98,80],
    carpet:[52,96,78], carpetLo:[34,66,54], wet:[24,46,38], fleck:[78,128,106],
    tile:[150,186,168], grout:[96,134,116], panel:[206,238,222], glow:[222,250,236],
    fog:[6,12,10],
  },
];

export function getPalette(level) {
  return LEVEL_PALETTES[level % LEVEL_PALETTES.length];
}

// ----------------------------------------------------------------------------
//  Small deterministic PRNG so textures are stable between frames.
// ----------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const pack = (r, g, b, a = 255) =>
  ((a << 24) | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0;

// mix two [r,g,b] by t
const mix = (c1, c2, t) => [
  c1[0] + (c2[0] - c1[0]) * t,
  c1[1] + (c2[1] - c1[1]) * t,
  c1[2] + (c2[2] - c1[2]) * t,
];

// ----------------------------------------------------------------------------
//  Texture generation — all procedural, baked once per palette.
//  Reference: Backrooms Level 0 — mono-yellow wallpaper w/ scattered
//  outlets/vents, moist carpet, dropped ceiling w/ irregular fluorescents.
// ----------------------------------------------------------------------------
// Seamless (wrapping) value noise in [0,1]; cells^2 lattice, bilerp.
function makeNoise(rnd, cells) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (x, y) => {
    const fx = (x / TEX) * cells, fy = (y / TEX) * cells;
    const x0 = Math.floor(fx) % cells, y0 = Math.floor(fy) % cells;
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const a = g[y0 * cells + x0], b = g[y0 * cells + x1];
    const c = g[y1 * cells + x0], d = g[y1 * cells + x1];
    const top = a + (b - a) * tx, bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  };
}

const addc = (c, v) => [c[0] + v, c[1] + v, c[2] + v];
const scalec = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

// ---- WALLPAPER -------------------------------------------------------------
// variant 0: clean   1: duplex electrical outlet   2: HVAC return vent
// 3: heavy water stain.  All share one mono-yellow base so the space stays
// oppressively uniform ("the madness of mono-yellow"); only fixtures change.
function makeWallpaper(p, variant = 0) {
  const out = new Uint32Array(TEX * TEX);
  const rnd = mulberry32((0xA17 ^ (p.wall[0] * 131) ^ (variant * 7919)) >>> 0);
  const blotch = makeNoise(rnd, 5);    // broad damp discoloration
  const grain = makeNoise(rnd, 32);    // fine paper grain
  const plate = mix(p.wallHi, [240, 236, 220], 0.6);   // ivory cover plate
  const plateLo = scalec(plate, 0.82);
  const slot = scalec(p.base, 0.5);                    // dark socket holes
  const metal = mix(p.base, [120, 120, 124], 0.5);     // vent louvers
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const bl = blotch(x, y);
      let base = mix(p.wallLo, p.wallHi, 0.5 + (bl - 0.5) * 0.45);
      base = addc(base, (grain(x, y) - 0.5) * 9 + (rnd() - 0.5) * 5);
      base = scalec(base, 1 - (y / TEX) * 0.10);         // faint top-down light
      if (bl > 0.72) base = mix(base, p.stain, (bl - 0.72) * 0.7);

      if (variant === 1) {
        const px0 = 27, py0 = TEX - 22, pw = 11, ph = 15;
        if (x >= px0 && x < px0 + pw && y >= py0 && y < py0 + ph) {
          const ex = x - px0, ey = y - py0;
          const edge = ex === 0 || ey === 0 || ex === pw - 1 || ey === ph - 1;
          base = edge ? plateLo : plate;
          for (const cy of [4, 10]) {
            if (ex >= 3 && ex <= 7 && ey >= cy - 2 && ey <= cy + 2) {
              base = mix(plate, [0, 0, 0], 0.18);
              if ((ex === 4 || ex === 6) && ey >= cy - 1 && ey <= cy) base = slot;
              if (ex === 5 && ey === cy + 1) base = slot;
            }
          }
        }
      } else if (variant === 2) {
        const vx0 = 22, vy0 = 20, vw = 20, vh = 16;
        if (x >= vx0 && x < vx0 + vw && y >= vy0 && y < vy0 + vh) {
          const ex = x - vx0, ey = y - vy0;
          const edge = ex === 0 || ey === 0 || ex === vw - 1 || ey === vh - 1;
          base = edge ? scalec(metal, 0.7) : mix(metal, base, 0.25);
          if (!edge && ey % 3 === 0) base = scalec(metal, 0.55);
        }
      } else if (variant === 3) {
        const cx = 30 + Math.sin(y * 0.18) * 4;
        const w = 9 - (y / TEX) * 4;
        const d = Math.abs(x - cx);
        if (d < w) {
          const t = (1 - d / w) * (0.25 + (y / TEX) * 0.5);
          base = mix(base, p.stain, t * 0.8);
          base = addc(base, -t * 22);
        }
      }

      if (y >= TEX - 7) {
        base = mix(base, p.base, 0.9);
        if (y === TEX - 7) base = mix(base, p.wallHi, 0.25);
      }
      out[y * TEX + x] = pack(base[0], base[1], base[2]);
    }
  }
  return out;
}

// ---- CARPET ----------------------------------------------------------------
// Moist low-pile commercial loop carpet; tile seams every world unit.
function makeCarpet(p) {
  const out = new Uint32Array(TEX * TEX);
  const rnd = mulberry32((0xC0FFEE ^ (p.carpet[1] * 17)) >>> 0);
  const mott = makeNoise(rnd, 6);    // broad mottling
  const damp = makeNoise(rnd, 4);    // wet patches
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      let base = mix(p.carpetLo, p.carpet, 0.35 + mott(x, y) * 0.55);
      const sp = rnd();
      if (sp > 0.88) base = mix(base, p.fleck, 0.45);
      else if (sp < 0.12) base = mix(base, p.wet, 0.4);
      base = addc(base, (rnd() - 0.5) * 8);
      const dv = damp(x, y);
      if (dv > 0.62) base = mix(base, p.wet, (dv - 0.62) * 1.1);
      if (x === 0 || y === 0 || x === TEX - 1 || y === TEX - 1)
        base = mix(base, p.wet, 0.5);
      out[y * TEX + x] = pack(base[0], base[1], base[2]);
    }
  }
  return out;
}

// Ceiling texture maps to a 2x2 world-tile region: a regular acoustic-tile grid
// with a recessed fluorescent panel in one quadrant -> lights on a lattice.
// ---- CEILING ---------------------------------------------------------------
// 4x4 grid of acoustic tiles (texture spans 4 world units) with a couple of
// long fluorescent troffers placed irregularly -> "inconsistently placed
// fluorescent lighting" instead of one neat panel per block.
function makeCeiling(p) {
  const out = new Uint32Array(TEX * TEX);
  const rnd = mulberry32((0x5EED ^ (p.tile[0] * 7)) >>> 0);
  const speck = makeNoise(rnd, 32);
  const T = TEX / 4;                 // one acoustic tile = 16px = 1 world unit
  const fixtures = [[0, 0, 1, 2], [2, 1, 2, 1], [1, 3, 1, 1]];
  const inFixture = (tc, tr) => {
    for (const f of fixtures)
      if (tc >= f[0] && tc < f[0] + f[2] && tr >= f[1] && tr < f[1] + f[3]) return f;
    return null;
  };
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const tc = (x / T) | 0, tr = (y / T) | 0;
      const lx = x - tc * T, ly = y - tr * T;
      const f = inFixture(tc, tr);
      let base;
      if (f) {
        const gx = x - f[0] * T, gy = y - f[1] * T, gw = f[2] * T, gh = f[3] * T;
        const frame = gx < 1 || gy < 1 || gx > gw - 2 || gy > gh - 2;
        if (frame) base = mix(p.grout, p.panel, 0.3);
        else {
          base = mix(p.panel, p.glow, 0.45);
          const along = gw >= gh ? gy : gx;
          const span = gw >= gh ? gh : gw;
          if (Math.abs(along - span / 2) < 1.2) base = scalec(base, 0.9);
          base = addc(base, (rnd() - 0.5) * 5);
        }
      } else {
        base = addc(p.tile.slice(), (speck(x, y) - 0.5) * 14);
        if (rnd() > 0.82) base = mix(base, p.grout, 0.3);
      }
      if ((lx === 0 || ly === 0) && !f) base = mix(base, p.grout, 0.75);
      out[y * TEX + x] = pack(base[0], base[1], base[2]);
    }
  }
  return out;
}

// ---- Entity sprites: a distinct, volumetrically-shaded form per kind.
//  These are baked at a high "PS2-era" texel density (vs the old chunky
//  PS1-ish 48x80 billboards) and use soft body lighting, limb separation,
//  rim light and per-type surface detail so they read as rounded, modelled
//  creatures rather than flat silhouettes. Glowing features (eyes, grin) are
//  still drawn at billboard time so they can pulse/redden. alpha 0 = clear.
const SPR_W = 128, SPR_H = 208;

// soft signed-distance helpers for rounded volumes -------------------------
const _smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// distance to a vertical capsule (rounded limb/torso) in uv space
function capsuleD(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay) || 0));
  const dx = pax - bax * h, dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

function makeBody(type) {
  const out = new Uint32Array(SPR_W * SPR_H);
  const rnd = mulberry32(0xD00D ^ (type.charCodeAt(0) * 2654435761));
  // per-type form + shading config.
  //   tone: base albedo rgb (0-255). lum: overall brightness multiplier.
  //   The light comes from upper-left (camcorder-ish), so we shade by a
  //   pseudo-normal derived from the body's local surface slope.
  const cfg = {
    wanderer: { tone: [150, 142, 124], lum: 0.92, low: 0, rough: 0.06 },
    watcher:  { tone: [54, 50, 46],    lum: 0.70, low: 0, rough: 0.04 },
    smiler:   { tone: [40, 38, 35],    lum: 0.64, low: 0, rough: 0.05 },
    hound:    { tone: [70, 52, 44],    lum: 0.78, low: 1, rough: 0.10 },
  }[type];

  const LX = -0.55, LY = -0.7, LZ = 0.46;        // light direction (normalized-ish)
  const Llen = Math.hypot(LX, LY, LZ);

  for (let y = 0; y < SPR_H; y++) {
    for (let x = 0; x < SPR_W; x++) {
      const u = x / SPR_W, v = y / SPR_H;
      // coverage = how "inside" the body we are (>0 inside), used for soft edges
      let cover = 0;            // 0..1 alpha-ish coverage
      let depth = 0;            // pseudo-bulge (0 flat .. 1 nearest the camera), drives normal.z
      let lateral = 0;          // signed horizontal position within the limb, for side shading
      let region = 0;           // 0 body, 1 head, 2 limb — lets us tint differently

      const lean = (v - 0.5) * (cfg.low ? 0.0 : (type === 'smiler' ? 0.10 : type === 'watcher' ? 0.04 : 0.05));
      const cx = 0.5 + lean;

      if (!cfg.low) {
        // ---- upright biped --------------------------------------------------
        // torso: a tapering capsule from chest to hip; width breathes by type
        const wTop = type === 'watcher' ? 0.14 : type === 'smiler' ? 0.185 : 0.165;
        const wBot = wTop * 0.82;
        const torsoTop = 0.22, torsoBot = 0.74;
        if (v >= torsoTop && v <= torsoBot + 0.05) {
          const tt = (v - torsoTop) / (torsoBot - torsoTop);
          const halfW = wTop + (wBot - wTop) * Math.min(1, tt) + 0.018 * Math.sin(tt * Math.PI); // ribcage swell
          const d = Math.abs(u - cx);
          const c = _smooth(halfW, halfW - 0.045, d);
          if (c > cover) { cover = c; lateral = (u - cx) / (halfW + 1e-4); depth = Math.sqrt(Math.max(0, 1 - lateral * lateral)); region = 0; }
        }
        // shoulders: a broad soft lump near the top of the torso
        {
          const d = capsuleD(u, v, cx - 0.11, 0.255, cx + 0.11, 0.255, 0.075);
          const c = _smooth(0.0, -0.05, d);
          if (c > cover) { cover = c; lateral = (u - cx) / 0.18; depth = _smooth(0.075, -0.045, d); region = 0; }
        }
        // head: rounded, slightly egg-shaped
        const hy = type === 'smiler' ? 0.15 : type === 'watcher' ? 0.105 : 0.125;
        const hr = type === 'smiler' ? 0.115 : type === 'watcher' ? 0.09 : 0.1;
        {
          const hdx = (u - 0.5) / hr, hdy = (v - hy) / (hr * 1.18);
          const rr = Math.sqrt(hdx * hdx + hdy * hdy);
          const c = _smooth(1.0, 0.84, rr);
          if (c > cover) { cover = c; lateral = hdx; depth = Math.sqrt(Math.max(0, 1 - Math.min(1, rr * rr))); region = 1; }
        }
        // neck
        {
          const d = capsuleD(u, v, 0.5, hy + hr * 0.6, cx, 0.25, 0.05);
          const c = _smooth(0.0, -0.04, d);
          if (c > cover) { cover = c; lateral = (u - 0.5) / 0.08; depth = _smooth(0.05, -0.03, d); region = 0; }
        }
        // arms: thick capsules from the shoulders, attached to the body line.
        {
          const armR = type === 'watcher' ? 0.042 : 0.05;
          const reach = type === 'smiler' ? 0.14 : 0.06;      // smiler's arms splay out
          const shoff = wTop + 0.02;
          const dL = capsuleD(u, v, cx - shoff, 0.27, cx - shoff - reach, 0.72, armR);
          const dR = capsuleD(u, v, cx + shoff, 0.27, cx + shoff + reach, 0.72, armR);
          const d = Math.min(dL, dR);
          const c = _smooth(0.0, -0.05, d);
          if (c > cover) {
            cover = c;
            const near = dL < dR;
            lateral = near ? -0.5 : 0.5;
            depth = _smooth(0.06, -0.04, d) * 0.95;
            region = 2;
          }
        }
        // legs: thick, joined at the hip
        {
          const legR = 0.06;
          const dL = capsuleD(u, v, cx - 0.06, 0.72, cx - 0.07, 0.985, legR);
          const dR = capsuleD(u, v, cx + 0.06, 0.72, cx + 0.07, 0.985, legR);
          const d = Math.min(dL, dR);
          const c = _smooth(0.0, -0.05, d);
          if (c > cover) { cover = c; lateral = (dL < dR ? -0.5 : 0.5); depth = _smooth(0.06, -0.04, d) * 0.9; region = 2; }
        }
      } else {
        // ---- hound: low, long, hunched quadruped ----------------------------
        // body mass: a thick arched capsule running across the lower-mid frame
        {
          const d = capsuleD(u, v, 0.26, 0.66, 0.66, 0.60, 0.155);
          const c = _smooth(0.0, -0.07, d);
          if (c > cover) { cover = c; lateral = (v - 0.62) / 0.155; depth = _smooth(0.13, -0.06, d); region = 0; }
        }
        // neck/shoulder hump sloping up toward the head (front-heavy build)
        {
          const d = capsuleD(u, v, 0.60, 0.62, 0.74, 0.56, 0.115);
          const c = _smooth(0.0, -0.06, d);
          if (c > cover) { cover = c; lateral = (u - 0.67) / 0.12; depth = _smooth(0.1, -0.05, d); region = 0; }
        }
        // raised hackles / spine ridge
        {
          const d = capsuleD(u, v, 0.30, 0.49, 0.56, 0.49, 0.04);
          const c = _smooth(0.0, -0.03, d);
          if (c > cover * 0.9) { cover = Math.max(cover, c); lateral = 0; depth = Math.max(depth, _smooth(0.04, -0.025, d)); region = 0; }
        }
        // head: blends out of the shoulder hump, thrust forward
        {
          const hdx = (u - 0.79) / 0.105, hdy = (v - 0.56) / 0.12;
          const rr = Math.sqrt(hdx * hdx + hdy * hdy);
          const c = _smooth(1.0, 0.8, rr);
          if (c > cover) { cover = c; lateral = hdx * 0.8; depth = Math.sqrt(Math.max(0, 1 - Math.min(1, rr * rr))); region = 1; }
        }
        // muzzle: a tapering snout off the head, not a detached block
        {
          const d = capsuleD(u, v, 0.84, 0.575, 0.96, 0.60, 0.045);
          const c = _smooth(0.0, -0.045, d);
          if (c > cover) { cover = c; lateral = (v - 0.59) / 0.045; depth = _smooth(0.045, -0.03, d); region = 1; }
        }
        // four thick legs
        {
          const legR = 0.04;
          const d = Math.min(
            capsuleD(u, v, 0.34, 0.72, 0.31, 0.97, legR),
            capsuleD(u, v, 0.44, 0.74, 0.42, 0.985, legR),
            capsuleD(u, v, 0.58, 0.72, 0.60, 0.97, legR),
            capsuleD(u, v, 0.67, 0.70, 0.72, 0.96, legR),
          );
          const c = _smooth(0.0, -0.045, d);
          if (c > cover) { cover = c; lateral = 0.3; depth = _smooth(0.05, -0.03, d) * 0.85; region = 2; }
        }
        // tail
        {
          const d = capsuleD(u, v, 0.26, 0.62, 0.07, 0.50, 0.03);
          const c = _smooth(0.0, -0.03, d);
          if (c > cover) { cover = c; lateral = 0; depth = _smooth(0.035, -0.02, d) * 0.75; region = 0; }
        }
      }

      if (cover <= 0.02) { out[y * SPR_W + x] = 0; continue; }

      // ---- shading: build a cheap surface normal and light it -------------
      // normal.x from lateral curvature, normal.y from vertical bulge, z from depth
      let nx = lateral * 0.9;
      let ny = (region === 1 ? (v - 0.5) * -1.2 : -0.25);   // heads catch top light
      let nz = 0.35 + depth * 0.9;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;

      let diff = (nx * LX + ny * LY + nz * LZ) / Llen;       // -1..1
      diff = 0.42 + 0.58 * Math.max(0, diff);                // wrap + ambient

      // rim light along the silhouette edge gives the PS2 "specular fresnel" feel
      const rim = Math.pow(1 - Math.min(1, depth + 0.15), 3) * 0.5;

      // micro surface noise (skin/fur grain), scaled by roughness
      const grain = (rnd() - 0.5) * cfg.rough;

      let shade = cfg.lum * diff + rim + grain;
      // region tinting: heads a touch paler, limbs slightly darker / deeper
      let tr = cfg.tone[0], tg = cfg.tone[1], tb = cfg.tone[2];
      if (region === 1) { tr *= 1.06; tg *= 1.04; tb *= 1.02; }
      if (region === 2) { shade *= 0.86; }

      // ambient occlusion in the body crevices (where coverage edge is soft)
      const ao = 0.65 + 0.35 * _smooth(0.2, 0.9, cover);
      shade *= ao;

      let r = tr * shade, g = tg * shade, b = tb * shade;
      // pack with coverage-as-alpha so soft edges anti-alias against the scene
      const al = (cover * 255) | 0;
      out[y * SPR_W + x] = pack(r, g, b, al);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
//  Caches
// ----------------------------------------------------------------------------
const texCache = new Map();          // zoneIndex -> {walls,floor,ceil}
const bodyCache = {};                // type -> sprite Uint32Array
function getBody(type) {
  if (!bodyCache[type]) bodyCache[type] = makeBody(type);
  return bodyCache[type];
}
function getTextures(level) {
  const key = level % LEVEL_PALETTES.length;
  let t = texCache.get(key);
  if (!t) {
    const p = getPalette(level);
    t = {
      walls: [makeWallpaper(p, 0), makeWallpaper(p, 1), makeWallpaper(p, 2), makeWallpaper(p, 3)],
      floor: makeCarpet(p), ceil: makeCeiling(p),
    };
    texCache.set(key, t);
  }
  return t;
}

let frameBuf = null, frameU32 = null, bufW = 0, bufH = 0;
function getFrame(ctx) {
  if (!frameBuf || bufW !== SCREEN_WIDTH || bufH !== SCREEN_HEIGHT) {
    frameBuf = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    frameU32 = new Uint32Array(frameBuf.data.buffer);
    bufW = SCREEN_WIDTH; bufH = SCREEN_HEIGHT;
  }
  return frameBuf;
}

// Camcorder lens: precomputed barrel-distortion remap (dest index -> src
// index, or -1 for "outside the lens"). Built once per screen size. K is the
// barrel strength — moderate, so it clearly reads as a lens without the
// extreme GoPro wrap.
let lensMap = null, lensW = 0, lensH = 0, lensScratch = null;
function getLensMap(W, H) {
  if (lensMap && lensW === W && lensH === H) return lensMap;
  const K = 0.22;                          // moderate barrel
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const norm = 1 / Math.hypot(cx, cy);     // so the corner radius is ~1
  const m = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // normalized offset from centre
      const nx = (x - cx) * norm, ny = (y - cy) * norm;
      const r2 = nx * nx + ny * ny;
      // barrel: sample point pulled inward by (1 + K*r^2)
      const f = 1 + K * r2;
      const sxN = nx * f, syN = ny * f;
      const sx = Math.round(cx + sxN / norm);
      const sy = Math.round(cy + syN / norm);
      m[y * W + x] = (sx < 0 || sx >= W || sy < 0 || sy >= H) ? -1 : (sy * W + sx);
    }
  }
  lensMap = m; lensW = W; lensH = H;
  return m;
}
function getLensScratch(W, H) {
  if (!lensScratch || lensScratch.length !== W * H) lensScratch = new Uint32Array(W * H);
  return lensScratch;
}

// ============================================================================
//  Main render
// ============================================================================
let _tick = 0;
// Deterministic per-cell wall feature so fixtures scatter instead of repeating.
function cellVariant(mx, my) {
  const h = (Math.imul(mx, 73856093) ^ Math.imul(my, 19349663)) >>> 0;
  const r = h % 100;
  if (r < 70) return 0;   // clean wall (dominant)
  if (r < 84) return 1;   // electrical outlet
  if (r < 94) return 2;   // return vent
  return 3;               // heavy water stain
}

export function castRays(ctx, world, player, zoneIndex, dread, entities, flashlight = false, camcorder = false, fx = null) {
  _tick++;
  const W = SCREEN_WIDTH, H = SCREEN_HEIGHT, halfH = H >> 1;
  // vertical look (pitch) shifts the horizon line up/down — a raycaster
  // y-shear. Positive pitch looks up. Clamped so the world can't fully invert.
  const pitch = (fx && fx.pitch) ? Math.max(-H * 0.6, Math.min(H * 0.6, fx.pitch)) : 0;
  const horizon = (halfH + pitch) | 0;
  const p = getPalette(zoneIndex);
  const tex = getTextures(zoneIndex);

  const img = getFrame(ctx);
  const buf = frameU32;

  const posX = player.x, posY = player.y;
  const dirX = Math.cos(player.angle), dirY = Math.sin(player.angle);
  // FOV is dynamic (settings menu). A wider FOV pushes the walls back and makes
  // the space read as larger / more open — important for the Backrooms feel,
  // where tight walls kill the sense of endlessness. Default 90°.
  const fovDeg = (fx && fx.fov) ? fx.fov : 90;
  const planeLen = Math.tan((fovDeg * Math.PI / 180) / 2);
  const planeX = -dirY * planeLen, planeY = dirX * planeLen;

  // dread colour push (toward red, away from cool)
  const dr = dread / 100;
  const rMul = 1 + dr * 0.42, gMul = 1 - dr * 0.26, bMul = 1 - dr * 0.42;

  // flicker: occasional brown-out of the fluorescents
  let flick = 1;
  if (((_tick + 13) % 47) < 2) flick = 0.82;
  if (Math.random() < 0.012) flick = 0.6 + Math.random() * 0.3;

  const fog = p.fog;
  const useFlash = !!flashlight;
  const fcx = W * 0.5, fcy = H * 0.55;        // flashlight screen centre

  // ---- area darkness: dead-fluorescent rooms sit in near-blackness. ------
  //  `dk` (0 lit .. 1 pitch black) sampled at the player's cell. Without the
  //  flashlight this crushes ambient light so you must switch it on; the
  //  flashlight cone (below) still punches through. We blend across the cell
  //  the player is in plus its neighbours so the transition at a doorway is a
  //  gradient rather than a hard step.
  let dk = 0;
  if (world.darkness) {
    const px = Math.floor(player.x), py = Math.floor(player.y);
    let s = 0, n = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const w = (ox === 0 && oy === 0) ? 4 : 1;
      s += world.darkness(px + ox, py + oy) * w; n += w;
    }
    dk = s / n;
  }
  // ambient multiplier applied to the whole scene when the light is off.
  const ambient = 1 - dk * 0.92;                       // dark room -> ~0.08
  // the flashlight is what makes a dark room navigable, so its cone gets a
  // boost proportional to how dark the room is.
  const flashBoost = 1 + dk * 0.6;

  // ---- floor + ceiling cast (per scanline, relative to the pitched horizon) -
  const rayX0 = dirX - planeX, rayY0 = dirY - planeY;  // leftmost ray
  const rayX1 = dirX + planeX, rayY1 = dirY + planeY;  // rightmost ray
  const floorTexF = tex.floor, ceilTexF = tex.ceil;

  // FLOOR: every scanline below the horizon.
  for (let y = Math.max(horizon + 1, 0); y < H; y++) {
    const pRow = y - horizon;
    if (pRow <= 0) continue;
    const rowDist = (0.5 * H * WALL_HEIGHT) / pRow;
    const stepX = rowDist * (rayX1 - rayX0) / W;
    const stepY = rowDist * (rayY1 - rayY0) / W;
    let fx2 = posX + rowDist * rayX0;
    let fy2 = posY + rowDist * rayY0;
    let shade = 1 - rowDist * 0.040; if (shade < 0) shade = 0;
    const floorShade = shade * 0.94 * flick;
    const rowFloor = y * W;
    for (let x = 0; x < W; x++, fx2 += stepX, fy2 += stepY) {
      let cfx = fx2 - Math.floor(fx2), cfy = fy2 - Math.floor(fy2);
      let txF = (cfx * TEX) & (TEX - 1), tyF = (cfy * TEX) & (TEX - 1);
      let fp = floorTexF[tyF * TEX + txF];
      let bF = floorShade * ambient;
      if (useFlash) {
        const dxs = x - fcx, dys = y - fcy;
        const coneF = 1.5 - (dxs * dxs + dys * dys) * 0.000085;
        bF = (floorShade * 0.18 * ambient) + (coneF > 0 ? coneF : 0) * (1 - rowDist * 0.04 < 0 ? 0 : 1 - rowDist * 0.04) * 1.1 * flashBoost;
      }
      const fr = (fp & 0xFF) * bF, fg = ((fp >> 8) & 0xFF) * bF, fb = ((fp >> 16) & 0xFF) * bF;
      buf[rowFloor + x] = pack(fr * rMul, fg * gMul, fb * bMul);
    }
  }
  // CEILING: every scanline above the horizon.
  for (let y = Math.min(horizon - 1, H - 1); y >= 0; y--) {
    const pRow = horizon - y;
    if (pRow <= 0) continue;
    const rowDist = (0.5 * H * WALL_HEIGHT) / pRow;
    const stepX = rowDist * (rayX1 - rayX0) / W;
    const stepY = rowDist * (rayY1 - rayY0) / W;
    let fx2 = posX + rowDist * rayX0;
    let fy2 = posY + rowDist * rayY0;
    let shade = 1 - rowDist * 0.040; if (shade < 0) shade = 0;
    const ceilShade = shade * 1.04 * flick;
    const rowCeil = y * W;
    for (let x = 0; x < W; x++, fx2 += stepX, fy2 += stepY) {
      let hfx = fx2 * 0.25, hfy = fy2 * 0.25;
      let chx = hfx - Math.floor(hfx), chy = hfy - Math.floor(hfy);
      let txC = (chx * TEX) & (TEX - 1), tyC = (chy * TEX) & (TEX - 1);
      let cp = ceilTexF[tyC * TEX + txC];
      let bC = ceilShade * ambient;
      if (useFlash) {
        const dxs = x - fcx, dys = y - fcy;
        const coneC = 1.5 - (dxs * dxs + dys * dys) * 0.000085;
        bC = (ceilShade * 0.18 * ambient) + (coneC > 0 ? coneC : 0) * (1 - rowDist * 0.04 < 0 ? 0 : 1 - rowDist * 0.04) * 1.1 * flashBoost;
      }
      const cr = (cp & 0xFF) * bC, cg = ((cp >> 8) & 0xFF) * bC, cb = ((cp >> 16) & 0xFF) * bC;
      buf[rowCeil + x] = pack(cr * rMul, cg * gMul, cb * bMul);
    }
  }

  // ---- wall cast ----------------------------------------------------------
  const zBuf = new Float32Array(W);

  for (let x = 0; x < W; x++) {
    const cameraX = 2 * x / W - 1;
    const rdX = dirX + planeX * cameraX;
    const rdY = dirY + planeY * cameraX;

    let mapX = Math.floor(posX), mapY = Math.floor(posY);
    const ddX = rdX === 0 ? 1e30 : Math.abs(1 / rdX);
    const ddY = rdY === 0 ? 1e30 : Math.abs(1 / rdY);

    let stepX, stepY, sideX, sideY;
    if (rdX < 0) { stepX = -1; sideX = (posX - mapX) * ddX; }
    else { stepX = 1; sideX = (mapX + 1 - posX) * ddX; }
    if (rdY < 0) { stepY = -1; sideY = (posY - mapY) * ddY; }
    else { stepY = 1; sideY = (mapY + 1 - posY) * ddY; }

    let hit = 0, side = 0, steps = 96;
    while (!hit && steps-- > 0) {
      if (sideX < sideY) { sideX += ddX; mapX += stepX; side = 0; }
      else { sideY += ddY; mapY += stepY; side = 1; }
      if (world.isWall(mapX, mapY)) hit = 1;
    }
    if (!hit) hit = 2;

    let perp;
    if (hit === 2) perp = MAX_DEPTH;
    else perp = side === 0 ? (sideX - ddX) : (sideY - ddY);
    if (perp < 0.0001) perp = 0.0001;
    zBuf[x] = perp;

    const lineH = (H * WALL_HEIGHT / perp) | 0;
    let dStart = -(lineH >> 1) + horizon;
    let dEnd = (lineH >> 1) + horizon;
    const drawS = dStart < 0 ? 0 : dStart;
    const drawE = dEnd >= H ? H - 1 : dEnd;

    if (hit === 2) {
      // void column -> fill with fog so it reads as distance, not a hole
      for (let y = drawS; y <= drawE; y++) buf[y * W + x] = pack(fog[0] * rMul, fog[1] * gMul, fog[2] * bMul);
      continue;
    }

    // texture X coordinate on the wall
    let wallX = side === 0 ? posY + perp * rdY : posX + perp * rdX;
    wallX -= Math.floor(wallX);
    let texX = (wallX * TEX) | 0;
    if (side === 0 && rdX > 0) texX = TEX - texX - 1;
    if (side === 1 && rdY < 0) texX = TEX - texX - 1;
    if (texX < 0) texX = 0; if (texX > TEX - 1) texX = TEX - 1;

    // distance shade + side darkening
    let shade = 1 - perp * 0.038;
    if (shade < 0.05) shade = 0.05;
    if (side === 1) shade *= 0.74;
    shade *= flick;

    // this wall belongs to a room that may be dark — shade by ITS darkness,
    // so a lit corridor still glows when viewed from a dark room and vice versa.
    let wallAmbient = 1;
    if (world.darkness) wallAmbient = 1 - world.darkness(mapX, mapY) * 0.92;

    let cone = 1;
    if (useFlash) {
      const dxs = x - fcx;
      cone = 1.45 - (dxs * dxs) * 0.000085;
      if (cone < 0) cone = 0;
    }

    const texStep = TEX / lineH;
    let texPos = (drawS - horizon + (lineH >> 1)) * texStep;
    const wtex = tex.walls[cellVariant(mapX, mapY)];
    const fAmt = 1 - (1 - perp * 0.038 < 0.05 ? 0.05 : 1 - perp * 0.038);

    for (let y = drawS; y <= drawE; y++) {
      let ty = texPos & (TEX - 1);
      texPos += texStep;
      const px = wtex[ty * TEX + texX];
      let r = (px & 0xFF), g = (px >> 8) & 0xFF, b = (px >> 16) & 0xFF;
      let bri = shade * wallAmbient;
      if (useFlash) {
        const dys = y - fcy;
        let c = cone - (dys * dys) * 0.000085;
        if (c < 0) c = 0;
        bri = (shade * 0.16 * wallAmbient) + c * (1 - perp * 0.05 < 0 ? 0 : 1 - perp * 0.05) * 1.1 * flashBoost;
      }
      r = r * bri; g = g * bri; b = b * bri;
      r += (fog[0] - r) * fAmt * 0.7; g += (fog[1] - g) * fAmt * 0.7; b += (fog[2] - b) * fAmt * 0.7;
      buf[y * W + x] = pack(r * rMul, g * gMul, b * bMul);
    }
  }

  // ---- entities (billboards, z-tested, drawn far-to-near) ----------------
  if (entities && entities.length) {
    drawEntities(buf, W, H, posX, posY, dirX, dirY, planeX, planeY, entities, zBuf, dread, flick, ambient, useFlash, flashBoost, fcx, fcy, horizon);
  }

  // ---- camcorder lens: a moderate barrel (fisheye) warp of the whole frame.
  //  Real camcorders have a wide, slightly-bulged lens; this remaps the
  //  rendered buffer through a barrel function so the picture noticeably
  //  bows out toward the edges while recording (vs the flat raw view).
  if (camcorder) {
    const map = getLensMap(W, H);
    const src = getLensScratch(W, H);
    src.set(buf);                                  // snapshot before remapping
    const edge = pack(6, 10, 6, 255);              // dark vignette beyond the lens
    for (let i = 0; i < map.length; i++) {
      const s = map[i];
      buf[i] = s < 0 ? edge : src[s];
    }
  }

  ctx.putImageData(img, 0, 0);

  // ---- light/film grain overlay (cheap ctx pass) -------------------------
  if (flick < 0.85) {
    ctx.fillStyle = 'rgba(0,0,0,' + ((1 - flick) * 0.5).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }

  // ---- weapon feedback ----
  if (fx) {
    if (fx.muzzle) {
      // a sharp, brief muzzle flash from the gun (lower-centre), tighter and
      // whiter than the old flashlight bloom
      const grad = ctx.createRadialGradient(W * 0.5, H * 0.82, 0, W * 0.5, H * 0.82, H * 0.38);
      grad.addColorStop(0, 'rgba(255,244,210,0.7)');
      grad.addColorStop(0.5, 'rgba(255,210,120,0.25)');
      grad.addColorStop(1, 'rgba(255,210,120,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    if (fx.hitFlash) {
      ctx.fillStyle = 'rgba(180,20,20,0.22)';
      ctx.fillRect(0, 0, W, H);
    }
  }
}

function drawEntities(buf, W, H, posX, posY, dirX, dirY, planeX, planeY, ents, zBuf, dread, flick, ambient = 1, useFlash = false, flashBoost = 1, fcx = W * 0.5, fcy = H * 0.55, horizon = H >> 1) {
  const invDet = 1 / (planeX * dirY - dirX * planeY);
  // project + sort far -> near so nearer entities overdraw correctly
  const draw = [];
  for (const e of ents) {
    const sx = e.x - posX, sy = e.y - posY;
    const tY = invDet * (-planeY * sx + planeX * sy);   // depth
    if (tY <= 0.2) continue;
    const tX = invDet * (dirY * sx - dirX * sy);
    draw.push({ e, tX, tY });
  }
  draw.sort((a, b) => b.tY - a.tY);

  const halfH = H >> 1;
  const dr = dread / 100;
  for (const { e, tX, tY } of draw) {
    const body = getBody(e.type);
    const screenX = ((W / 2) * (1 + tX / tY)) | 0;
    // Monsters are large and looming. Uprights tower; the hound is big & wide.
    const vscale = e.type === 'hound' ? 1.0 : 1.5;
    // a slow per-entity sway so they breathe/loom instead of standing static
    const sway = 1 + Math.sin(_tick * 0.05 + (e.id || 0) * 1.7) * 0.015;
    const sH = (Math.abs(H / tY) * vscale * sway) | 0;
    const sW = (sH * SPR_W / SPR_H) | 0;
    // sit feet near the floor line rather than centring on the horizon
    const footY = horizon + (Math.abs(H / tY) * WALL_HEIGHT * 0.5) | 0;
    const drawStartY = footY - sH;
    const drawStartX = screenX - (sW >> 1);
    let shade = Math.max(0.16, 1 - tY * 0.07) * (0.85 + flick * 0.15);
    // in a dark room the body is swallowed by gloom; the flashlight, if the
    // entity sits within its cone, picks it back out. (Glowing eyes/grin are
    // drawn afterwards and stay visible — a shape's eyes in the dark.)
    if (useFlash) {
      const dxs = screenX - fcx, dys = footY - (sH >> 1) - fcy;
      let c = 1.45 - (dxs * dxs + dys * dys) * 0.000085;
      if (c < 0) c = 0;
      shade *= Math.min(1.1, ambient + c * flashBoost);
    } else {
      shade *= ambient;
    }
    const aggro = e.type === 'hound' || dr > 0.5;
    const hurt = (e.hurt || 0) > 0;            // recently shot -> flash red-white

    for (let stripe = 0; stripe < sW; stripe++) {
      const x = drawStartX + stripe;
      if (x < 0 || x >= W) continue;
      if (tY >= zBuf[x]) continue;                 // occluded by wall
      const texX = (stripe * SPR_W / sW) | 0;
      for (let yy = 0; yy < sH; yy++) {
        const y = drawStartY + yy;
        if (y < 0 || y >= H) continue;
        const texY = (yy * SPR_H / sH) | 0;
        const sp = body[texY * SPR_W + texX];
        const sa = sp >>> 24;
        if (sa === 0) continue;
        let r = (sp & 0xFF) * shade, g = ((sp >> 8) & 0xFF) * shade, b = ((sp >> 16) & 0xFF) * shade;
        if (aggro) { r += 26 * (e.type === 'hound' ? 1 : dr); }
        if (hurt) { r = r * 0.5 + 230; g = g * 0.5 + 60; b = b * 0.5 + 40; }   // damage flash
        if (sa >= 250) {
          buf[y * W + x] = pack(r, g, b, 255);
        } else {
          // soft silhouette edge: alpha-blend over the scene behind it so the
          // high-res sprite anti-aliases instead of showing stair-stepping.
          const a = sa / 255;
          const bg = buf[y * W + x];
          const br = bg & 0xFF, bgc = (bg >> 8) & 0xFF, bb = (bg >> 16) & 0xFF;
          buf[y * W + x] = pack(r * a + br * (1 - a), g * a + bgc * (1 - a), b * a + bb * (1 - a), 255);
        }
      }
    }

    // ---- glowing features per type ----
    const eyeRed = aggro || e.dist < 7;        // glow red from farther = scarier
    const drawDot = (cxp, cyp, rad, col) => {
      const ex = (screenX + cxp * sW) | 0, ey = (drawStartY + cyp * sH) | 0;
      for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
        const px = ex + ox, py = ey + oy;
        if (px >= 0 && px < W && py >= 0 && py < H && tY < zBuf[px]) buf[py * W + px] = col;
      }
    };
    // a soft additive bloom around a glowing eye so it reads as a light source
    // burning in the dark — the core scare of "eyes watching you".
    const drawGlow = (cxp, cyp, rad, rc, gc, bc) => {
      const ex = (screenX + cxp * sW) | 0, ey = (drawStartY + cyp * sH) | 0;
      const r2 = rad * rad;
      for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
        const d2 = ox * ox + oy * oy; if (d2 > r2) continue;
        const px = ex + ox, py = ey + oy;
        if (px < 0 || px >= W || py < 0 || py >= H || tY >= zBuf[px]) continue;
        const f = (1 - d2 / r2) * 0.7;                 // falloff
        const bg = buf[py * W + px];
        const br = bg & 0xFF, bgc = (bg >> 8) & 0xFF, bb = (bg >> 16) & 0xFF;
        buf[py * W + px] = pack(Math.min(255, br + rc * f), Math.min(255, bgc + gc * f), Math.min(255, bb + bc * f), 255);
      }
    };
    const ew = Math.max(1, (sW * 0.045) | 0);          // bigger eyes
    const glowR = Math.max(2, (sW * 0.13) | 0);
    if (e.type === 'wanderer') {
      // faceless — hollow eyes that catch the light when close
      if (e.dist < 8) {
        if (eyeRed) { drawGlow(-0.10, 0.12, glowR, 120, 12, 8); drawGlow(0.10, 0.12, glowR, 120, 12, 8); }
        const c = eyeRed ? pack(255, 60, 40) : pack(170, 158, 120);
        drawDot(-0.10, 0.12, ew, c); drawDot(0.10, 0.12, ew, c);
      }
    } else if (e.type === 'watcher') {
      if (eyeRed) { drawGlow(-0.09, 0.10, glowR, 150, 14, 8); drawGlow(0.09, 0.10, glowR, 150, 14, 8); }
      const c = eyeRed ? pack(255, 40, 24) : pack(245, 210, 80);
      drawDot(-0.09, 0.10, ew, c); drawDot(0.09, 0.10, ew, c);
    } else if (e.type === 'smiler') {
      const lit = 0.5 + (e.glow || 0) * 0.5;
      drawGlow(0, 0.23, glowR * 1.4, 120 * lit, 130 * lit, 120 * lit);
      const cEye = pack(235 * lit, 245 * lit, 235 * lit);
      drawDot(-0.10, 0.20, ew, cEye); drawDot(0.10, 0.20, ew, cEye);
      // wide jagged grin: a row of bright teeth, wider than before
      const gy = (drawStartY + 0.27 * sH) | 0, gw = (sW * 0.30) | 0;
      const gx0 = screenX - (gw >> 1);
      for (let i = 0; i <= gw; i++) {
        const px = gx0 + i; if (px < 0 || px >= W || tY >= zBuf[px]) continue;
        const teeth = (i % 3 === 0) ? 0.55 : 1;                  // jagged tooth gaps
        const curve = Math.sin((i / gw) * Math.PI) * (sH * 0.045);
        const py = (gy - curve) | 0;
        // draw teeth a couple px tall so the grin has height
        for (let th = 0; th < 2; th++) {
          const yy = py + th;
          if (yy >= 0 && yy < H) buf[yy * W + px] = pack(240 * lit * teeth, 245 * lit * teeth, 230 * lit * teeth);
        }
      }
    } else if (e.type === 'hound') {
      drawGlow(0.12, 0.50, glowR, 160, 14, 6); drawGlow(0.20, 0.52, glowR, 160, 14, 6);
      const c = pack(255, 40, 22);
      drawDot(0.12, 0.50, Math.max(1, ew), c); drawDot(0.20, 0.52, Math.max(1, ew), c);  // forward-set eyes
    }
  }
}

// ----------------------------------------------------------------------------
//  Minimap (top-left) — a local window onto the infinite world.
// ----------------------------------------------------------------------------
export function renderMinimap(ctx, world, player, entities) {
  const CELL = 4, R = 9;                 // show (2R+1)^2 cells around the player
  const dim = (2 * R + 1) * CELL, ox = 6, oy = SCREEN_HEIGHT - dim - 6;
  const pcx = Math.floor(player.x), pcy = Math.floor(player.y);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(ox - 2, oy - 2, dim + 4, dim + 4);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const gx = pcx + dx, gy = pcy + dy;
      const sxp = ox + (dx + R) * CELL, syp = oy + (dy + R) * CELL;
      if (world.isWall(gx, gy)) ctx.fillStyle = '#c8b85f';
      else if (world.isSafeRoom && world.isSafeRoom(gx, gy)) ctx.fillStyle = '#16361c';
      else ctx.fillStyle = '#1c1808';
      ctx.fillRect(sxp, syp, CELL - 1, CELL - 1);
    }
  }
  // entity blips
  if (entities) {
    for (const e of entities) {
      const dx = Math.floor(e.x) - pcx, dy = Math.floor(e.y) - pcy;
      if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      ctx.fillStyle = e.type === 'hound' ? '#ff3020' : e.type === 'smiler' ? '#e8e8e8' : e.type === 'watcher' ? '#ffd23a' : '#9a8fb0';
      ctx.fillRect(ox + (dx + R) * CELL, oy + (dy + R) * CELL, CELL, CELL);
    }
  }
  // player + facing
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ox + R * CELL, oy + R * CELL, CELL, CELL);
  ctx.fillStyle = '#ff9a3a';
  ctx.fillRect(
    ox + (R + Math.round(Math.cos(player.angle))) * CELL,
    oy + (R + Math.round(Math.sin(player.angle))) * CELL, 2, 2);
}
