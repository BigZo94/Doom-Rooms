// ============================================================================
//  Web Audio soundscape for the Backrooms — horror-tuned.
//
//  Design philosophy: fear comes from SPACE and UNPREDICTABILITY, not from a
//  loud constant tone. So instead of a bright buzzing fixture stack (which read
//  as a motor / "vibrator"), the bed here is:
//
//    - a deep, heavily low-passed room rumble you FEEL more than hear
//    - a faint broadband "air" bed (huge empty space) with a slow swell
//    - everything sent through a cold generated REVERB so nothing is dry/close
//    - the fluorescents reduced to an occasional, irregular, distant tick/buzz
//      rather than a sustained drone
//    - entity voices rebuilt from filtered NOISE and INHARMONIC tones (breath,
//      growl, metallic shimmer) — organic and wrong, not clean synth notes
//    - irregular event scares: distant impacts/groans, dissonant swells that
//      rise only when something is genuinely near, rare sub-bass drops
//
//  Everything is generated — no audio files. All calls are guarded.
//  Public API is unchanged so the game keeps working.
// ============================================================================

let ctx = null, master = null, initialized = false;
let busDry, busWet, reverb;                      // routing
let humGain, humNode, droneNode;                 // (names kept for compatibility)
let airGain, airFilter;                          // broadband room air
let threatGain, threatPan, threatFilter;         // hound growl channel
let presGain, presPan, presOsc, presOsc2, presFilter; // presence shimmer
let breathGain, breathFilter;                    // presence breath (noise)
let whisperGain;
let musicGain;
let swellGain, swellOsc, swellOsc2;              // dissonant "something's near" riser
let dripTimer = null, musicTimer = null, fixtureTimer = null, scareTimer = null;
let curZone = -1, musicOn = false, dripRate = 5200;
let stepAccum = 0;
let nearAmount = 0;                              // 0..1 how close the nearest threat is

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

// A cold, long, slightly metallic impulse response built from decaying noise.
// Gives the whole mix the sense of a large, hard-surfaced empty space.
function makeReverbIR(seconds = 3.4, decay = 3.2) {
  const rate = ctx.sampleRate || 44100;
  const len = Math.floor(rate * seconds);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // sparse early reflections + exponential noise tail
      const env = Math.pow(1 - t, decay);
      let s = (Math.random() * 2 - 1) * env;
      // a few discrete early echoes for "hard room" character
      if (i === (rate * 0.013 | 0) || i === (rate * 0.029 | 0) || i === (rate * 0.051 | 0)) s += (ch ? -0.5 : 0.5);
      d[i] = s;
    }
  }
  return ir;
}

export function initAudio() {
  if (initialized) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // ---- master chain: bus -> gentle limiter -> destination ----
    master = ctx.createGain(); master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);

    // ---- reverb send: a shared cold room ----
    reverb = ctx.createConvolver(); reverb.buffer = makeReverbIR();
    busDry = ctx.createGain(); busDry.gain.value = 1.0; busDry.connect(master);
    busWet = ctx.createGain(); busWet.gain.value = 0.55; busWet.connect(reverb); reverb.connect(master);
    // helper: connect a node to both dry and wet busses
    const toRoom = (node, wet = 1) => {
      node.connect(busDry);
      if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(busWet); }
    };

    // ---- deep room rumble — FELT, not heard ----
    //  A low sine through a steep lowpass. No bright harmonics = no buzz.
    //  humGain/humNode/droneNode keep their names so setSanityAudio + zone code
    //  still work, but the character is now a sub rumble, not a fixture.
    humGain = ctx.createGain(); humGain.gain.value = 0.16;
    const humLP = ctx.createBiquadFilter(); humLP.type = 'lowpass'; humLP.frequency.value = 120; humLP.Q.value = 0.4;
    humGain.connect(humLP); toRoom(humLP, 0.25);
    humNode = ctx.createOscillator(); humNode.type = 'sine'; humNode.frequency.value = 48;
    humNode.connect(humGain); humNode.start();
    // a second, even lower body tone for chest-weight
    droneNode = ctx.createOscillator(); droneNode.type = 'sine'; droneNode.frequency.value = 33;
    const dg = ctx.createGain(); dg.gain.value = 0.12; droneNode.connect(dg); toRoom(dg, 0.15); droneNode.start();
    // very slow wander so it never sits perfectly still (uneasy, not pulsing)
    const humDrift = ctx.createOscillator(); humDrift.type = 'sine'; humDrift.frequency.value = 0.06;
    const humDriftG = ctx.createGain(); humDriftG.gain.value = 1.2;
    humDrift.connect(humDriftG); humDriftG.connect(humNode.frequency); humDrift.start();

    // ---- low-mid "presence" bed: a quiet, dark filtered-noise layer in the
    //  150-400Hz region so the atmosphere still reads on laptop/phone speakers
    //  that can't reproduce the sub. Kept low and band-limited so it stays a
    //  dark wash, never an audible tone/buzz.
    const pres = loopNoise();
    const presLP = ctx.createBiquadFilter(); presLP.type = 'lowpass'; presLP.frequency.value = 400; presLP.Q.value = 0.5;
    const presHP = ctx.createBiquadFilter(); presHP.type = 'highpass'; presHP.frequency.value = 130;
    const presBedG = ctx.createGain(); presBedG.gain.value = 0.014;
    pres.connect(presHP); presHP.connect(presLP); presLP.connect(presBedG); toRoom(presBedG, 0.7); pres.start();
    // tie its level to the slow air swell so the whole room breathes together
    const presBedLfo = ctx.createOscillator(); presBedLfo.type = 'sine'; presBedLfo.frequency.value = 0.045;
    const presBedLfoG = ctx.createGain(); presBedLfoG.gain.value = 0.008;
    presBedLfo.connect(presBedLfoG); presBedLfoG.connect(presBedG.gain); presBedLfo.start();

    // ---- broadband air: the sound of a vast empty volume ----
    airFilter = ctx.createBiquadFilter(); airFilter.type = 'lowpass'; airFilter.frequency.value = 520; airFilter.Q.value = 0.3;
    airGain = ctx.createGain(); airGain.gain.value = 0.03;
    const airN = loopNoise(); airN.connect(airFilter); airFilter.connect(airGain); toRoom(airGain, 0.8); airN.start();
    // slow swell on the air so the room "breathes"
    const airLfo = ctx.createOscillator(); airLfo.type = 'sine'; airLfo.frequency.value = 0.05;
    const airLfoG = ctx.createGain(); airLfoG.gain.value = 0.018;
    airLfo.connect(airLfoG); airLfoG.connect(airGain.gain); airLfo.start();

    // ---- hound growl: filtered noise, slow grain, lowpassed ----
    threatGain = ctx.createGain(); threatGain.gain.value = 0;
    threatPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    threatFilter = ctx.createBiquadFilter(); threatFilter.type = 'lowpass'; threatFilter.frequency.value = 200; threatFilter.Q.value = 4;
    const tn = loopNoise(); tn.connect(threatFilter); threatFilter.connect(threatGain); threatGain.connect(threatPan);
    threatPan.connect(busDry);
    const tpw = ctx.createGain(); tpw.gain.value = 0.6; threatPan.connect(tpw); tpw.connect(busWet);
    tn.start();
    // slow irregular amplitude grain = breathing/snarling, not a steady tone
    const tlfo = ctx.createOscillator(); tlfo.type = 'sine'; tlfo.frequency.value = 2.3;
    const tlg = ctx.createGain(); tlg.gain.value = 90; tlfo.connect(tlg); tlg.connect(threatFilter.frequency); tlfo.start();

    // ---- presence: inharmonic metallic shimmer + breath noise ----
    presGain = ctx.createGain(); presGain.gain.value = 0;
    presPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    presFilter = ctx.createBiquadFilter(); presFilter.type = 'bandpass'; presFilter.frequency.value = 1200; presFilter.Q.value = 6;
    presOsc = ctx.createOscillator(); presOsc.type = 'triangle'; presOsc.frequency.value = 220;
    presOsc2 = ctx.createOscillator(); presOsc2.type = 'sine'; presOsc2.frequency.value = 220 * 1.41; // tritone-ish, inharmonic
    presOsc.connect(presFilter); presOsc2.connect(presFilter); presFilter.connect(presGain); presGain.connect(presPan);
    presPan.connect(busDry);
    const ppw = ctx.createGain(); ppw.gain.value = 0.9; presPan.connect(ppw); ppw.connect(busWet);
    presOsc.start(); presOsc2.start();
    // breath layer
    breathGain = ctx.createGain(); breathGain.gain.value = 0;
    breathFilter = ctx.createBiquadFilter(); breathFilter.type = 'bandpass'; breathFilter.frequency.value = 700; breathFilter.Q.value = 1.2;
    const bn = loopNoise(); bn.connect(breathFilter); breathFilter.connect(breathGain); breathGain.connect(presPan); bn.start();
    const blfo = ctx.createOscillator(); blfo.type = 'sine'; blfo.frequency.value = 0.45; // slow breathing
    const blg = ctx.createGain(); blg.gain.value = 0.5; blfo.connect(blg); blg.connect(breathFilter.frequency); blfo.start();

    // ---- "something is near" dissonant swell (rises with proximity) ----
    swellGain = ctx.createGain(); swellGain.gain.value = 0;
    swellOsc = ctx.createOscillator(); swellOsc.type = 'sawtooth'; swellOsc.frequency.value = 73;
    swellOsc2 = ctx.createOscillator(); swellOsc2.type = 'sawtooth'; swellOsc2.frequency.value = 77.5; // beating, sour
    const swLP = ctx.createBiquadFilter(); swLP.type = 'lowpass'; swLP.frequency.value = 420; swLP.Q.value = 1;
    swellOsc.connect(swLP); swellOsc2.connect(swLP); swLP.connect(swellGain); toRoom(swellGain, 0.7);
    swellOsc.start(); swellOsc2.start();

    // ---- whispers (airier) ----
    whisperGain = ctx.createGain(); whisperGain.gain.value = 0;
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 1500; wbp.Q.value = 0.7;
    const wn = loopNoise(); wn.connect(wbp); wbp.connect(whisperGain); toRoom(whisperGain, 1.0);
    const wlfo = ctx.createOscillator(); wlfo.type = 'sine'; wlfo.frequency.value = 0.9;
    const wlg = ctx.createGain(); wlg.gain.value = 0.05; wlfo.connect(wlg); wlg.connect(whisperGain.gain);
    const wfl = ctx.createOscillator(); wfl.type = 'sine'; wfl.frequency.value = 0.13; // sweeps the band = "voices"
    const wflg = ctx.createGain(); wflg.gain.value = 600; wfl.connect(wflg); wflg.connect(wbp.frequency);
    wn.start(); wlfo.start(); wfl.start();

    // ---- music bus ----
    musicGain = ctx.createGain(); musicGain.gain.value = 0; toRoom(musicGain, 1.0);

    initialized = true;
    dripLoop();
    musicLoop();
    fixtureLoop();
    scareLoop();
  } catch (e) { /* no audio */ }
}

const T = () => ctx.currentTime;
const ramp = (param, v, t = 0.4) => { try { param.setTargetAtTime(v, T(), t); } catch (e) { param.value = v; } };

// small helper: a transient routed through the room (dry + wet)
function spawnToRoom(node, wet = 0.7) {
  node.connect(busDry);
  const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(busWet);
}

// ---------- one-shots ----------
export function playStepSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain();
    g.gain.setValueAtTime(0.09, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.18);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200;
    s.connect(f); f.connect(g); spawnToRoom(g, 0.4); s.start(now);
  } catch (e) {}
}
export function playDripSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain();
    g.gain.setValueAtTime(0.1, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(700 + Math.random() * 600, now); o.frequency.exponentialRampToValueAtTime(110, now + 0.4);
    o.connect(g); spawnToRoom(g, 1.0); o.start(now); o.stop(now + 0.5);
  } catch (e) {}
}
export function playTransitionSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.4, now + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, now + 3.2);
    // descending inharmonic drone — a fall into the next place
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, now); o.frequency.exponentialRampToValueAtTime(24, now + 3.2);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 41;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    o.connect(lp); o2.connect(lp); lp.connect(g); spawnToRoom(g, 0.9);
    o.start(now); o.stop(now + 3.3); o2.start(now); o2.stop(now + 3.3);
  } catch (e) {}
}
// kept for compatibility
export function playEntitySound() { playSting('watcher'); }

// stinger when something gets close / is documented — short dissonant hit + sub
export function playSting(type = 'watcher') {
  if (!ctx) return;
  try {
    const now = T();
    // sub-bass impact
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, now); g.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = type === 'smiler' ? 180 : type === 'hound' ? 70 : 120;
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(24, now + 1.0);
    o.connect(g); spawnToRoom(g, 0.6); o.start(now); o.stop(now + 1.45);
    // metallic dissonant top (bandpassed noise burst) — a scrape/shriek
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(type === 'smiler' ? 0.16 : 0.09, now); ng.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(0.7);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8;
    bp.frequency.setValueAtTime(type === 'smiler' ? 2600 : 900, now);
    bp.frequency.exponentialRampToValueAtTime(type === 'smiler' ? 1400 : 400, now + 0.7);
    ns.connect(bp); bp.connect(ng); spawnToRoom(ng, 1.0); ns.start(now); ns.stop(now + 0.72);
  } catch (e) {}
}
export function playPickupSound() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.14, now + 0.05); g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(330, now); o.frequency.linearRampToValueAtTime(495, now + 0.22);
    o.connect(g); spawnToRoom(g, 0.5); o.start(now); o.stop(now + 0.6);
  } catch (e) {}
}
export function playRecordBeep(on = true) {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain();
    g.gain.setValueAtTime(0.1, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = on ? 1320 : 660;
    o.connect(g); spawnToRoom(g, 0.2); o.start(now); o.stop(now + 0.13);
  } catch (e) {}
}

// ---------- zone ambience ----------
const ZONE_PROFILES = [
  { drone: 33, drip: 4200, music: false, air: 480 },
  { drone: 30, drip: 2600, music: true,  air: 360 },
  { drone: 38, drip: 6800, music: false, air: 640 },
  { drone: 28, drip: 3400, music: true,  air: 300 },
  { drone: 35, drip: 9000, music: false, air: 720 },
  { drone: 26, drip: 2200, music: true,  air: 260 },
];
export function setZoneAudio(zoneIndex) {
  if (!ctx || zoneIndex === curZone) return;
  curZone = zoneIndex;
  const p = ZONE_PROFILES[((zoneIndex % ZONE_PROFILES.length) + ZONE_PROFILES.length) % ZONE_PROFILES.length];
  dripRate = p.drip;
  musicOn = p.music;
  ramp(droneNode.frequency, p.drone, 4.0);
  if (airFilter) ramp(airFilter.frequency, p.air, 4.0);
  ramp(musicGain.gain, p.music ? 0.08 : 0.0, 4.0);
}

// ---------- spatial entity audio ----------
// player: {x,y,angle}; entities: [{type,x,y,dist}]
export function updateSpatialAudio(player, entities, dt = 16) {
  if (!ctx) return;
  try {
    const rx = Math.cos(player.angle + Math.PI / 2), ry = Math.sin(player.angle + Math.PI / 2);
    const panOf = (e, d) => Math.max(-1, Math.min(1, ((e.x - player.x) * rx + (e.y - player.y) * ry) / (d || 1)));

    let hound = null, other = null, nearest = 1e9;
    for (const e of (entities || [])) {
      const d = e.dist || Math.hypot(e.x - player.x, e.y - player.y);
      if (d < nearest) nearest = d;
      if (e.type === 'hound') { if (!hound || d < hound.d) hound = { e, d }; }
      else { if (!other || d < other.d) other = { e, d }; }
    }

    // dissonant proximity swell: rises only when something is genuinely close
    nearAmount = nearest < 10 ? (1 - nearest / 10) : 0;
    ramp(swellGain.gain, nearAmount * nearAmount * 0.12, 0.6);

    if (hound && hound.d < 15) {
      const v = (1 - hound.d / 15) * 0.34;
      ramp(threatGain.gain, v, 0.18);
      if (threatPan.pan) ramp(threatPan.pan, panOf(hound.e, hound.d), 0.2);
      ramp(threatFilter.frequency, 150 + (1 - hound.d / 15) * 300, 0.25);
      stepAccum += dt;
      const interval = 180 + hound.d * 36;
      if (stepAccum > interval) { stepAccum = 0; if (hound.d < 11) playStepSound(); }
    } else ramp(threatGain.gain, 0, 0.5);

    if (other && other.d < 13) {
      const t = other.e.type;
      const base = t === 'smiler' ? 330 : t === 'watcher' ? 150 : 210;
      const v = (1 - other.d / 13) * (t === 'smiler' ? 0.12 : 0.07);
      ramp(presGain.gain, v, 0.25);
      ramp(breathGain.gain, (1 - other.d / 13) * 0.06, 0.3);
      ramp(presOsc.frequency, base, 0.4); ramp(presOsc2.frequency, base * 1.41, 0.4);
      ramp(presFilter.frequency, 900 + (1 - other.d / 13) * 1600, 0.4);
      if (presPan.pan) ramp(presPan.pan, panOf(other.e, other.d), 0.3);
    } else { ramp(presGain.gain, 0, 0.6); ramp(breathGain.gain, 0, 0.6); }
  } catch (e) {}
}

// ---------- sanity ----------
export function setSanityAudio(sanity) {
  if (!ctx) return;
  const dread = (100 - sanity) / 100;
  // rumble swells and the air thickens as you fray — no pitch-up buzz
  ramp(humGain.gain, 0.16 + dread * 0.18, 0.7);
  if (humNode) ramp(humNode.frequency, 48 - dread * 8, 0.8);   // sinks, doesn't rise
  if (airGain) ramp(airGain.gain, 0.03 + dread * 0.05, 0.8);
  ramp(whisperGain.gain, sanity < 60 ? ((60 - sanity) / 60) * 0.12 : 0, 1.0);
}
// kept for compatibility (dread is inverse of sanity)
export function setDreadAudio(dread) { setSanityAudio(100 - dread); }

// ---------- schedulers ----------
function dripLoop() {
  if (!ctx) return;
  const next = dripRate * (0.5 + Math.random());
  dripTimer = setTimeout(() => { if (Math.random() < 0.7) playDripSound(); dripLoop(); }, next);
}

// occasional dead-fixture tick/buzz — short, irregular, distant. NOT sustained.
function fixtureBuzz() {
  if (!ctx) return;
  try {
    const now = T(), g = ctx.createGain();
    const dur = 0.05 + Math.random() * 0.22;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.04, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110 + Math.random() * 30;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000 + Math.random() * 1500; bp.Q.value = 3;
    // a fast amplitude stutter so it reads as an electrical fault, not a note
    const stut = ctx.createOscillator(); stut.type = 'square'; stut.frequency.value = 24 + Math.random() * 40;
    const stutG = ctx.createGain(); stutG.gain.value = 0.5; stut.connect(stutG); stutG.connect(g.gain);
    o.connect(bp); bp.connect(g); spawnToRoom(g, 0.9);
    o.start(now); o.stop(now + dur + 0.02); stut.start(now); stut.stop(now + dur + 0.02);
  } catch (e) {}
}
function fixtureLoop() {
  if (!ctx) return;
  fixtureTimer = setTimeout(() => { if (Math.random() < 0.5) fixtureBuzz(); fixtureLoop(); }, 4000 + Math.random() * 9000);
}

// irregular distant event: a low groan/impact somewhere in the building.
function distantScare() {
  if (!ctx) return;
  try {
    const now = T(); const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = Math.random() * 2 - 1;
    const g = ctx.createGain();
    const kind = Math.random();
    if (kind < 0.5) {
      // distant impact / door slam: filtered noise thud + sub
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(0.9);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(80, now); o.frequency.exponentialRampToValueAtTime(30, now + 0.6);
      ns.connect(lp); lp.connect(g); o.connect(g);
      g.connect(pan); pan.connect(busDry);
      const w = ctx.createGain(); w.gain.value = 1.2; pan.connect(w); w.connect(busWet); // very reverberant = far
      ns.start(now); ns.stop(now + 0.92); o.start(now); o.stop(now + 0.92);
    } else {
      // distant groan/moan: inharmonic low swell
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.07, now + 0.5);
      g.gain.exponentialRampToValueAtTime(0.001, now + 2.4);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 90 + Math.random() * 50;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = o.frequency.value * 1.06;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 2;
      const wob = ctx.createOscillator(); wob.type = 'sine'; wob.frequency.value = 4 + Math.random() * 3;
      const wobG = ctx.createGain(); wobG.gain.value = 12; wob.connect(wobG); wobG.connect(o.frequency);
      o.connect(lp); o2.connect(lp); lp.connect(g);
      g.connect(pan); pan.connect(busDry);
      const w = ctx.createGain(); w.gain.value = 1.3; pan.connect(w); w.connect(busWet);
      o.start(now); o.stop(now + 2.5); o2.start(now); o2.stop(now + 2.5); wob.start(now); wob.stop(now + 2.5);
    }
  } catch (e) {}
}
function scareLoop() {
  if (!ctx) return;
  // base interval long; tightens when something is near (nearAmount)
  const base = 14000 + Math.random() * 16000;
  const next = base * (1 - nearAmount * 0.5);
  scareTimer = setTimeout(() => { if (Math.random() < 0.6 + nearAmount * 0.3) distantScare(); scareLoop(); }, next);
}

const SCALE = [0, 1, 6, 7, 11];          // half-steps + tritone — sour, unresolved
function musicNote() {
  if (!ctx || !musicOn) return;
  try {
    const now = T();
    const root = 110;                       // A2 — lower, heavier
    const semi = SCALE[(Math.random() * SCALE.length) | 0] + (Math.random() < 0.4 ? 12 : 0);
    const freq = root * Math.pow(2, semi / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0006, now + 3.4);
    // detuned pair through a lowpass — a sour, bowed-string-ish swell
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq * 1.008;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.Q.value = 3;
    o.connect(lp); o2.connect(lp); lp.connect(g); spawnToRoom(g, 1.2);
    o.start(now); o.stop(now + 3.5); o2.start(now); o2.stop(now + 3.5);
  } catch (e) {}
}
function musicLoop() {
  if (!ctx) return;
  musicTimer = setTimeout(() => { if (musicOn && Math.random() < 0.6) musicNote(); musicLoop(); }, 2600 + Math.random() * 4200);
}

export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function stopAudio() {
  try {
    if (dripTimer) clearTimeout(dripTimer);
    if (musicTimer) clearTimeout(musicTimer);
    if (fixtureTimer) clearTimeout(fixtureTimer);
    if (scareTimer) clearTimeout(scareTimer);
  } catch (e) {}
}
