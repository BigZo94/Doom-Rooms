// ============================================================================
//  Web Audio soundscape for the Backrooms.
//
//  Layers:
//    - a persistent fluorescent hum + sub drone (the ever-present buzz)
//    - per-ZONE ambient beds that crossfade as you cross regions, plus sparse
//      generative "music" (a detuned, dissonant music-box) in some zones
//    - SPATIAL entity audio: each threat drives a stereo-panned, distance-
//      attenuated voice (a hound growl from your left, a smiler's whine ahead)
//    - low-SANITY whispers that swell as you come apart
//  Everything is generated — no audio files. All calls are guarded so the game
//  runs fine if Web Audio is unavailable.
// ============================================================================

let ctx = null, master = null, initialized = false;
let humGain, humNode, droneNode;
let threatGain, threatPan, threatFilter;        // hound-ish growl channel
let presGain, presPan, presOsc, presOsc2;       // generic presence channel
let whisperGain;                                 // low-sanity whispers
let musicGain;                                   // zone music bus
let dripTimer = null, musicTimer = null;
let curZone = -1, musicOn = false, dripRate = 5200;
let stepAccum = 0;

function noiseBuffer(seconds = 2) {
  const n = Math.floor((ctx.sampleRate || 44100) * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function loopNoise() {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(2.2); s.loop = true; return s;
}

export function initAudio() {
  if (initialized) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.42; master.connect(ctx.destination);

    // ---- persistent hum + drone ----
    humGain = ctx.createGain(); humGain.gain.value = 0.08; humGain.connect(master);
    humNode = ctx.createOscillator(); humNode.type = 'sawtooth'; humNode.frequency.value = 60;
    humNode.connect(humGain); humNode.start();
    const h2 = ctx.createOscillator(); h2.type = 'sine'; h2.frequency.value = 120;
    const h2g = ctx.createGain(); h2g.gain.value = 0.035; h2.connect(h2g); h2g.connect(master); h2.start();
    droneNode = ctx.createOscillator(); droneNode.type = 'sine'; droneNode.frequency.value = 40;
    const dg = ctx.createGain(); dg.gain.value = 0.06; droneNode.connect(dg); dg.connect(master); droneNode.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.1; const lg = ctx.createGain(); lg.gain.value = 1.5;
    lfo.connect(lg); lg.connect(humNode.frequency); lfo.start();

    // ---- threat channel (hound growl): looping noise -> lowpass -> gain -> pan ----
    threatGain = ctx.createGain(); threatGain.gain.value = 0;
    threatPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    threatFilter = ctx.createBiquadFilter(); threatFilter.type = 'lowpass'; threatFilter.frequency.value = 180;
    const tn = loopNoise(); tn.connect(threatFilter); threatFilter.connect(threatGain); threatGain.connect(threatPan); threatPan.connect(master); tn.start();
    const tlfo = ctx.createOscillator(); tlfo.type = 'sine'; tlfo.frequency.value = 7; const tlg = ctx.createGain(); tlg.gain.value = 60;
    tlfo.connect(tlg); tlg.connect(threatFilter.frequency); tlfo.start();

    // ---- presence channel (watcher/smiler/wanderer): detuned osc -> gain -> pan ----
    presGain = ctx.createGain(); presGain.gain.value = 0;
    presPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    presOsc = ctx.createOscillator(); presOsc.type = 'sine'; presOsc.frequency.value = 90;
    presOsc2 = ctx.createOscillator(); presOsc2.type = 'sine'; presOsc2.frequency.value = 93;
    presOsc.connect(presGain); presOsc2.connect(presGain); presGain.connect(presPan); presPan.connect(master);
    presOsc.start(); presOsc2.start();

    // ---- whispers ----
    whisperGain = ctx.createGain(); whisperGain.gain.value = 0;
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 1100; wbp.Q.value = 0.8;
    const wn = loopNoise(); wn.connect(wbp); wbp.connect(whisperGain); whisperGain.connect(master);
    const wlfo = ctx.createOscillator(); wlfo.type = 'sine'; wlfo.frequency.value = 0.7; const wlg = ctx.createGain(); wlg.gain.value = 0.04;
    wlfo.connect(wlg); wlg.connect(whisperGain.gain); wn.start(); wlfo.start();

    // ---- music bus ----
    musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);

    initialized = true;
    dripLoop();
    musicLoop();
  } catch (e) { /* no audio */ }
}

const T = () => ctx.currentTime;
const ramp = (param, v, t = 0.4) => { try { param.setTargetAtTime(v, T(), t); } catch (e) { param.value = v; } };

// ---------- one-shots ----------
export function playStepSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.1, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.15);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    s.connect(f); f.connect(g); s.start(now);
  } catch (e) {}
}
export function playDripSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(500 + Math.random() * 500, now); o.frequency.exponentialRampToValueAtTime(90, now + 0.4);
    o.connect(g); o.start(now); o.stop(now + 0.45);
  } catch (e) {}
}
export function playTransitionSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.45, now); g.gain.exponentialRampToValueAtTime(0.001, now + 2);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, now); o.frequency.exponentialRampToValueAtTime(20, now + 2);
    o.connect(g); o.start(now); o.stop(now + 2);
  } catch (e) {}
}
// kept for compatibility
export function playEntitySound() { playSting('watcher'); }

// stinger when something gets close / is documented
export function playSting(type = 'watcher') {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.28, now); g.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
    const o = ctx.createOscillator();
    o.type = type === 'hound' ? 'square' : 'sawtooth';
    const f0 = type === 'smiler' ? 520 : type === 'hound' ? 110 : 200;
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(28, now + 1.3);
    o.connect(g); o.start(now); o.stop(now + 1.35);
  } catch (e) {}
}
export function playPickupSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.18, now + 0.05); g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(380, now); o.frequency.linearRampToValueAtTime(620, now + 0.25);
    o.connect(g); o.start(now); o.stop(now + 0.65);
  } catch (e) {}
}
export function playRecordBeep(on = true) {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = on ? 880 : 440;
    o.connect(g); o.start(now); o.stop(now + 0.13);
  } catch (e) {}
}

// ---------- zone ambience ----------
const ZONE_PROFILES = [
  { drone: 40, drip: 4200, music: false, hum: 60 },
  { drone: 36, drip: 2600, music: true,  hum: 58 },   // dripping, musical
  { drone: 52, drip: 6800, music: false, hum: 66 },
  { drone: 33, drip: 3400, music: true,  hum: 54 },
  { drone: 46, drip: 9000, music: false, hum: 70 },   // dry, high buzz
  { drone: 30, drip: 2200, music: true,  hum: 50 },   // deep, musical, wet
];
export function setZoneAudio(zoneIndex) {
  if (!ctx || zoneIndex === curZone) return;
  curZone = zoneIndex;
  const p = ZONE_PROFILES[((zoneIndex % ZONE_PROFILES.length) + ZONE_PROFILES.length) % ZONE_PROFILES.length];
  dripRate = p.drip;
  musicOn = p.music;
  ramp(droneNode.frequency, p.drone, 2.5);
  ramp(musicGain.gain, p.music ? 0.09 : 0.0, 3.0);
}

// ---------- spatial entity audio ----------
// player: {x,y,angle}; entities: [{type,x,y,dist}]
export function updateSpatialAudio(player, entities, dt = 16) {
  if (!ctx) return;
  try {
    const rx = Math.cos(player.angle + Math.PI / 2), ry = Math.sin(player.angle + Math.PI / 2);
    const panOf = (e, d) => Math.max(-1, Math.min(1, ((e.x - player.x) * rx + (e.y - player.y) * ry) / (d || 1)));

    let hound = null, other = null;
    for (const e of (entities || [])) {
      const d = e.dist || Math.hypot(e.x - player.x, e.y - player.y);
      if (e.type === 'hound') { if (!hound || d < hound.d) hound = { e, d }; }
      else { if (!other || d < other.d) other = { e, d }; }
    }

    if (hound && hound.d < 15) {
      const v = (1 - hound.d / 15) * 0.32;
      ramp(threatGain.gain, v, 0.15);
      if (threatPan.pan) ramp(threatPan.pan, panOf(hound.e, hound.d), 0.2);
      ramp(threatFilter.frequency, 140 + (1 - hound.d / 15) * 260, 0.2);
      // footfalls quicken as it nears
      stepAccum += dt;
      const interval = 180 + hound.d * 36;
      if (stepAccum > interval) { stepAccum = 0; if (hound.d < 11) playStepSound(); }
    } else ramp(threatGain.gain, 0, 0.4);

    if (other && other.d < 13) {
      const t = other.e.type;
      const base = t === 'smiler' ? 360 : t === 'watcher' ? 70 : 130;
      const v = (1 - other.d / 13) * (t === 'smiler' ? 0.16 : 0.1);
      ramp(presGain.gain, v, 0.2);
      ramp(presOsc.frequency, base, 0.3); ramp(presOsc2.frequency, base * 1.03, 0.3);
      if (presPan.pan) ramp(presPan.pan, panOf(other.e, other.d), 0.25);
    } else ramp(presGain.gain, 0, 0.5);
  } catch (e) {}
}

// ---------- sanity ----------
export function setSanityAudio(sanity) {
  if (!ctx) return;
  const dread = (100 - sanity) / 100;
  ramp(humGain.gain, 0.08 + dread * 0.16, 0.5);
  if (humNode) ramp(humNode.frequency, 56 + dread * 30, 0.6);
  ramp(whisperGain.gain, sanity < 55 ? ((55 - sanity) / 55) * 0.14 : 0, 0.8);
}
// kept for compatibility (dread is inverse of sanity)
export function setDreadAudio(dread) { setSanityAudio(100 - dread); }

// ---------- schedulers ----------
function dripLoop() {
  if (!ctx) return;
  const next = dripRate * (0.5 + Math.random());
  dripTimer = setTimeout(() => { if (Math.random() < 0.8) playDripSound(); dripLoop(); }, next);
}
const SCALE = [0, 3, 5, 7, 10, 12];      // minor-ish, a little dissonant
function musicNote() {
  if (!ctx || !musicOn) return;
  try {
    const now = T();
    const root = 196;                       // G3-ish
    const semi = SCALE[(Math.random() * SCALE.length) | 0] + (Math.random() < 0.3 ? 12 : 0);
    const freq = root * Math.pow(2, semi / 12);
    const g = ctx.createGain(); g.connect(musicGain);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 2.6);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01; // shimmer
    const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2); g2.connect(g);
    o.connect(g); o.start(now); o.stop(now + 2.7); o2.start(now); o2.stop(now + 2.7);
  } catch (e) {}
}
function musicLoop() {
  if (!ctx) return;
  musicTimer = setTimeout(() => { if (musicOn && Math.random() < 0.7) musicNote(); musicLoop(); }, 1400 + Math.random() * 2600);
}

export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function stopAudio() { try { if (dripTimer) clearTimeout(dripTimer); if (musicTimer) clearTimeout(musicTimer); } catch (e) {} }
