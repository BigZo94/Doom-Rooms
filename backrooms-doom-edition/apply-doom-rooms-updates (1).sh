#!/usr/bin/env bash
# ============================================================================
#  apply-doom-rooms-updates.sh   (v11)
#  Cumulative patch for Doom-Rooms (Backrooms: Doom Edition).
#  Includes: horror audio, PS2 monster sprites, dark rooms, fisheye cam,
#  open FOV, real pistol + ammo/reload, sanity-in-FOV/health-at-0, settings
#  menu, VERTICAL MOUSE LOOK (look up/down), and the gun viewmodel as a 3/4
#  angled FPS pistol (front sight toward crosshair, no bore facing you, hand
#  barely visible) with idle sway, walk/sprint bob, recoil, muzzle flash, and
#  a reload lower-and-return animation.
#
#  Run from anywhere inside the repo:  bash apply-doom-rooms-updates.sh
# ============================================================================
set -euo pipefail
find_ldd() {
  if [ -f "src/lib/audioEngine.js" ] && [ -f "src/lib/raycaster.js" ]; then echo "."; return 0; fi
  local hit
  hit="$(find . -type d -path '*/src/lib' \
            -exec test -f '{}/audioEngine.js' -a -f '{}/raycaster.js' ';' \
            -print 2>/dev/null | head -n1 || true)"
  if [ -n "$hit" ]; then echo "${hit%/src/lib}"; return 0; fi
  return 1
}
LDD="$(find_ldd || true)"
if [ -z "${LDD:-}" ]; then
  echo "ERROR: could not find the project (need src/lib/audioEngine.js + raycaster.js)." >&2
  exit 1
fi
echo "Project found at: $LDD"
backup_once() { if [ -f "$1" ] && [ ! -f "$1.bak" ]; then cp "$1" "$1.bak"; echo "  backed up: $1 -> $1.bak"; fi; }
write_file() { local dest="$LDD/$1"; mkdir -p "$(dirname "$dest")"; backup_once "$dest"; }

write_file "src/lib/audioEngine.js"
cat > "$LDD/src/lib/audioEngine.js" << 'DOOMROOMS_EOF'
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

// ---------- settings / weapon ----------
// Master volume 0..1 (scaled into the engine's internal headroom).
export function setMasterVolume(v) {
  if (!ctx || !master) return;
  const vol = Math.max(0, Math.min(1, v));
  ramp(master.gain, 0.5 * vol, 0.1);
}

// Pistol discharge: a sharp percussive crack (fast noise transient through a
// highpass) + a short low-mid body thump, with a faint tail. `empty` plays a
// dry hammer click instead. `hit` adds a metallic impact ring.
export function playGunSound(hit = false, empty = false) {
  if (!ctx) return;
  try {
    const now = T();
    if (empty) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(0.05);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      ns.connect(hp); hp.connect(g); spawnToRoom(g, 0.2); ns.start(now); ns.stop(now + 0.06);
      return;
    }
    // crack: a very fast, bright noise transient = the report
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.55, now); cg.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    const cn = ctx.createBufferSource(); cn.buffer = noiseBuffer(0.12);
    const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 1400;
    cn.connect(chp); chp.connect(cg); spawnToRoom(cg, 0.6); cn.start(now); cn.stop(now + 0.13);
    // body: a short punchy low-mid thump (the gun's weight)
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.4, now); bg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    const bo = ctx.createOscillator(); bo.type = 'triangle';
    bo.frequency.setValueAtTime(220, now); bo.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    bo.connect(bg); spawnToRoom(bg, 0.4); bo.start(now); bo.stop(now + 0.19);
    // sub kick for chest weight
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.3, now); sg.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    const so = ctx.createOscillator(); so.type = 'sine';
    so.frequency.setValueAtTime(90, now); so.frequency.exponentialRampToValueAtTime(40, now + 0.1);
    so.connect(sg); spawnToRoom(sg, 0.2); so.start(now); so.stop(now + 0.15);
    // hit confirm: brief metallic ring
    if (hit) {
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.1, now + 0.01); hg.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      const ho = ctx.createOscillator(); ho.type = 'triangle'; ho.frequency.value = 1700;
      const ho2 = ctx.createOscillator(); ho2.type = 'triangle'; ho2.frequency.value = 1700 * 1.5;
      ho.connect(hg); ho2.connect(hg); spawnToRoom(hg, 0.7);
      ho.start(now); ho.stop(now + 0.37); ho2.start(now); ho2.stop(now + 0.37);
    }
  } catch (e) {}
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
DOOMROOMS_EOF
echo "  wrote: $LDD/src/lib/audioEngine.js"

write_file "src/lib/raycaster.js"
cat > "$LDD/src/lib/raycaster.js" << 'DOOMROOMS_EOF'
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
DOOMROOMS_EOF
echo "  wrote: $LDD/src/lib/raycaster.js"

write_file "src/lib/entities.js"
cat > "$LDD/src/lib/entities.js" << 'DOOMROOMS_EOF'
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
  wanderer: { speed: 0.014, sense: 6,  hp: 120, despawn: 20 },
  watcher:  { speed: 0.030, sense: 16, hp: 200, despawn: 28, freezeWhenWatched: true },
  smiler:   { speed: 0.024, sense: 13, hp: 160, despawn: 26, lightAverse: true },
  hound:    { speed: 0.052, sense: 12, hp: 240, despawn: 32, chaser: true },
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
// tiered streaming simulation. Returns 'killed' | 'despawn' | null.
//
// Sanity/health are NO LONGER drained here. The engine now drains sanity
// centrally based on whether ANY monster is in the player's FOV (and converts
// 0-sanity into health loss), so this function's only player-facing outputs
// are: marking e.visible (for the FOV check) and reacting to damage.
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

  // ensure HP exists (records created elsewhere may predate this field)
  if (e.hp === undefined) e.hp = P.hp || 100;
  if (e.hurt === undefined) e.hurt = 0;
  if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);          // hit-flash timer

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

  // a freshly-hit monster recoils briefly (knocked back, staggered)
  if (e.hurt > 0) move *= 0.35;

  if (move > 0 && !e.frozen) {
    const used = steer(e, ax, ay, move, k);
    if (e.type === 'wanderer' || e.type === 'hound') e.wanderA = used;
  }

  if (dist > P.despawn && !onScreen) return 'despawn';
  return null;
}

// Apply weapon damage to an entity. Returns true if this killed it.
// Tanky by design: see ENTITY_PARAMS.hp. Caller handles removal + fx.
export function damageEntity(e, amount) {
  const P = ENTITY_PARAMS[e.type] || {};
  if (e.hp === undefined) e.hp = P.hp || 100;
  e.hp -= amount;
  e.hurt = 220;                 // ms of hit-flash / recoil
  return e.hp <= 0;
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
      if (r === 'killed') { const t = list[i].type; documented[t] = (documented[t] || 0) + 1; cb.onKill && cb.onKill(t); list.splice(i, 1); }
      else if (r === 'despawn') list.splice(i, 1);
    }
  }
  return { list, documented, update, get count() { return list.length; }, reset() { list.length = 0; for (const k in documented) delete documented[k]; spawnCooldown = 3000; } };
}
DOOMROOMS_EOF
echo "  wrote: $LDD/src/lib/entities.js"

write_file "src/lib/entitySim.js"
cat > "$LDD/src/lib/entitySim.js" << 'DOOMROOMS_EOF'
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
DOOMROOMS_EOF
echo "  wrote: $LDD/src/lib/entitySim.js"

write_file "src/lib/world.js"
cat > "$LDD/src/lib/world.js" << 'DOOMROOMS_EOF'
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
DOOMROOMS_EOF
echo "  wrote: $LDD/src/lib/world.js"

write_file "src/lib/chunkManager.js"
cat > "$LDD/src/lib/chunkManager.js" << 'DOOMROOMS_EOF'
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
  // Dark rooms: ~16% of rooms have dead fluorescents (0 = lit .. 1 = pitch
  // black). Safe rooms are always lit. Mirrors world.js darkness().
  function darkness(gx, gy) {
    if (isSafeRoom(gx, gy)) return 0;
    const h = hash2(Math.floor(gx / B), Math.floor(gy / B), S ^ 0xDA12) % 100;
    if (h >= 16) return 0;
    return 0.7 + (h / 16) * 0.3;
  }

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
    zoneAt, isSafeRoom, darkness, almondsNear, takeItem,
    stats, serialize, load,
  };
}
DOOMROOMS_EOF
echo "  wrote: $LDD/src/lib/chunkManager.js"

write_file "src/components/game/GameEngine.jsx"
cat > "$LDD/src/components/game/GameEngine.jsx" << 'DOOMROOMS_EOF'
import React, { useEffect, useRef, useState } from 'react';
import { castRays, SCREEN_WIDTH, SCREEN_HEIGHT, renderMinimap } from '@/lib/raycaster';
import { createChunkManager } from '@/lib/chunkManager';
import { createEntitySim } from '@/lib/entitySim';
import { ENTITY_PARAMS } from '@/lib/entities';
import {
  initAudio, resumeAudio, setZoneAudio, updateSpatialAudio, setSanityAudio,
  playStepSound, playPickupSound, playSting, playRecordBeep, stopAudio,
  setMasterVolume, playGunSound,
} from '@/lib/audioEngine';
import HUD from './HUD';
import Camcorder from './Camcorder';
import GameOver from './GameOver';
import SettingsMenu from './SettingsMenu';

const ZONE_NAMES = ['LEVEL 0 \u2014 THE LOBBY', 'HABITABLE ZONE', 'PIPE DREAMS', 'ELECTRICAL STATION', 'ABANDONED OFFICE', 'THE TERROR HOTEL'];
const MOVE = 0.058, SPRINT = 0.095, TURN = 0.045, PSIZE = 0.26;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- sanity / health tuning ----
const SANITY_DRAIN = 1.5;     // %/sec while ANY monster is in your FOV
const SANITY_REGEN = 2.2;     // %/sec when none are in view (get away -> recover)
const HEALTH_DRAIN = 6;       // %/sec while sanity is at 0
const HEALTH_REGEN = 1.2;     // %/sec while sanity is comfortably high
const HEALTH_REGEN_ABOVE = 50;// sanity must exceed this for health to recover

// ---- weapon (pistol) ----
const GUN_DMG = 34;           // per shot; monsters are tanky (hp 120-240)
const GUN_COOLDOWN = 230;     // ms between shots (semi-auto)
const MAG_SIZE = 12;          // rounds per magazine
const START_RESERVE = 48;     // spare rounds at spawn
const RELOAD_MS = 1300;       // reload time
const AMMO_PICKUP = 18;       // rounds per ammo pickup (reuses almond pickups)

const DEFAULT_SETTINGS = { brightness: 1, volume: 0.8, mouseSens: 1, fov: 90, crosshair: true, invertY: false };

function spawnWorld() {
  const world = createChunkManager((Math.random() * 1e9) | 0, { loadRadius: 4, unloadRadius: 6, budgetMs: 2 });
  world.update(0, 0, 0, 0);
  let sx = 0, sy = 0;
  outer: for (let r = 0; r < 16; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { if (world.isOpen(dx, dy)) { sx = dx; sy = dy; break outer; } }
  world.update(sx, sy, 0, 0);
  return { world, sim: createEntitySim(world, { maxActive: 5 }), sx, sy };
}

export default function GameEngine({ onBackToTitle }) {
  const canvasRef = useRef(null);
  const gs = useRef(null);
  if (!gs.current) gs.current = {
    player: { x: 0.5, y: 0.5, angle: 0 }, world: null, sim: null, keys: {}, running: false,
    sanity: 100, health: 100, almonds: 0, battery: 100, flashlight: false, camcorder: false,
    showMinimap: false, stepTimer: 0, px: 0, py: 0, msg: '', msgUntil: 0,
    gunTimer: 0, muzzle: 0, hitFlash: 0, paused: false, settings: { ...DEFAULT_SETTINGS },
    mag: MAG_SIZE, reserve: START_RESERVE, reloading: 0, pitch: 0,
  };

  const [ui, setUi] = useState({ sanity: 100, health: 100, almonds: 0, battery: 100, mag: MAG_SIZE, reserve: START_RESERVE, reloading: false, documented: {}, zone: ZONE_NAMES[0], message: '' });
  const [flashlight, setFlashlight] = useState(false);
  const [camcorder, setCamcorder] = useState(false);
  const [, setShowMinimap] = useState(false);
  const [recInfo, setRecInfo] = useState(null);
  const [phase, setPhase] = useState('playing');
  const [paused, setPaused] = useState(false);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [deathCause, setDeathCause] = useState(null);
  const [gunKick, setGunKick] = useState(0);     // increments per shot to retrigger recoil anim
  const rafRef = useRef(null);
  const uiAccum = useRef(0);

  // init world + spawn once
  useEffect(() => {
    const { world, sim, sx, sy } = spawnWorld();
    const g = gs.current;
    g.world = world; g.sim = sim;
    g.player = { x: sx + 0.5, y: sy + 0.5, angle: Math.random() * 6.28 };
    g.px = g.player.x; g.py = g.player.y;
    g.sanity = 100; g.health = 100; g.almonds = 0; g.battery = 100;
  }, []);

  // fire the pistol (magazine ammo + reserve)
  const fire = () => {
    const g = gs.current;
    if (g.paused || !g.sim) return;
    const now = performance.now();
    if (g.reloading && now < g.reloading) return;          // mid-reload
    if (now - g.gunTimer < GUN_COOLDOWN) return;
    if (g.mag <= 0) {
      // auto-reload if you have spare rounds, else click-empty
      if (g.reserve > 0) reload();
      else { g.msg = 'NO AMMO'; g.msgUntil = now + 1000; playGunSound(false, true); }
      return;
    }
    g.gunTimer = now;
    g.mag -= 1;
    g.muzzle = now + 60;                                   // brief muzzle flash
    setGunKick((n) => n + 1);                              // retrigger viewmodel recoil
    const hitRec = g.sim.damageAlongAim(g.player, GUN_DMG);
    playGunSound(!!hitRec);
    if (hitRec) {
      g.hitFlash = now + 90;
      if (hitRec.killedNow) {
        g.msg = 'KILLED: ' + hitRec.type.toUpperCase();
        g.msgUntil = now + 1800;
        playSting(hitRec.type);
      }
    }
  };

  // reload: pull from reserve into the magazine
  const reload = () => {
    const g = gs.current;
    if (g.paused) return;
    const now = performance.now();
    if (g.reloading && now < g.reloading) return;
    if (g.mag >= MAG_SIZE || g.reserve <= 0) return;
    g.reloading = now + RELOAD_MS;
    g.msg = 'RELOADING'; g.msgUntil = now + RELOAD_MS;
    playRecordBeep(false);
    setTimeout(() => {
      const need = MAG_SIZE - g.mag;
      const take = Math.min(need, g.reserve);
      g.mag += take; g.reserve -= take; g.reloading = 0;
    }, RELOAD_MS);
  };

  // main loop
  useEffect(() => {
    if (phase !== 'playing') return;
    const g = gs.current;
    if (!g.world) return;
    g.running = true;
    let last = performance.now();

    const endGame = (cause) => { g.running = false; setDeathCause(cause); setPhase('over'); };

    const loop = (now) => {
      if (!g.running) return;
      const dt = Math.min(now - last, 50); last = now;

      // paused: keep rendering the frozen frame but skip simulation
      if (g.paused) { rafRef.current = requestAnimationFrame(loop); return; }

      const p = g.player, keys = g.keys, world = g.world;

      // ---- movement ----
      const spd = keys['shift'] ? SPRINT : MOVE;
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      const tryMove = (nx, ny) => {
        const m = PSIZE;
        if (!world.isWall(Math.floor(nx + m), Math.floor(p.y)) && !world.isWall(Math.floor(nx - m), Math.floor(p.y))) p.x = nx;
        if (!world.isWall(Math.floor(p.x), Math.floor(ny + m)) && !world.isWall(Math.floor(p.x), Math.floor(ny - m))) p.y = ny;
      };
      let moving = false;
      if (keys['w'] || keys['arrowup']) { tryMove(p.x + cos * spd, p.y + sin * spd); moving = true; }
      if (keys['s'] || keys['arrowdown']) { tryMove(p.x - cos * spd, p.y - sin * spd); moving = true; }
      const lx = Math.cos(p.angle - Math.PI / 2), ly = Math.sin(p.angle - Math.PI / 2);
      if (keys['a']) { tryMove(p.x + lx * spd, p.y + ly * spd); moving = true; }
      if (keys['d']) { tryMove(p.x - lx * spd, p.y - ly * spd); moving = true; }
      if (keys['arrowleft']) p.angle -= TURN;
      if (keys['arrowright']) p.angle += TURN;

      const vx = p.x - g.px, vy = p.y - g.py; g.px = p.x; g.py = p.y;
      if (moving) { g.stepTimer += dt; if (g.stepTimer > (keys['shift'] ? 260 : 360)) { playStepSound(); g.stepTimer = 0; } }

      // ---- stream + entities ----
      world.update(p.x, p.y, vx, vy);
      const recording = g.camcorder && g.battery > 0;
      g.sim.update(dt, p, { flashlight: g.flashlight, recording, moving, sanity: g.sanity }, {
        onKill: () => {},
        onAlert: () => {},
      });

      // ---- sanity: drains ONLY while a monster is in your FOV; regenerates
      //      on its own once nothing is visible. ----
      let monsterInView = false;
      for (const e of g.sim.physical) { if (e.visible) { monsterInView = true; break; } }
      const sec = dt / 1000;
      if (monsterInView) g.sanity -= SANITY_DRAIN * sec;
      else g.sanity += SANITY_REGEN * sec;
      g.sanity = clamp(g.sanity, 0, 100);

      // ---- health: drains ONLY when sanity has bottomed out; slowly recovers
      //      when sanity is comfortably high. ----
      if (g.sanity <= 0) g.health -= HEALTH_DRAIN * sec;
      else if (g.sanity > HEALTH_REGEN_ABOVE) g.health = Math.min(100, g.health + HEALTH_REGEN * sec);
      g.health = clamp(g.health, 0, 100);

      // ---- pickups ----
      for (const a of world.almondsNear(p.x, p.y, 4)) {
        if (Math.hypot(a.x - p.x, a.y - p.y) < 0.6) {
          world.takeItem(a.id); g.almonds++; g.reserve += AMMO_PICKUP;
          g.msg = 'SUPPLIES: +1 WATER, +' + AMMO_PICKUP + ' AMMO'; g.msgUntil = now + 2200; playPickupSound();
        }
      }
      // battery now only powers the camera (the gun is a real firearm).
      if (recording) g.battery = Math.max(0, g.battery - dt * 0.004);
      else g.battery = Math.min(100, g.battery + dt * 0.0016);

      if (g.health <= 0) { endGame('caught'); return; }

      // ---- audio + render ----
      const zone = world.zoneAt(Math.floor(p.x), Math.floor(p.y));
      setZoneAudio(zone);
      updateSpatialAudio(p, g.sim.physical, dt);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        castRays(ctx, world, p, zone, 100 - g.sanity, g.sim.physical, g.flashlight, recording, {
          muzzle: now < g.muzzle, hitFlash: now < g.hitFlash, fov: g.settings.fov, pitch: g.pitch || 0,
        });
        if (g.showMinimap) renderMinimap(ctx, world, p, g.sim.physical);
      }

      // ---- throttled UI sync ----
      uiAccum.current += dt;
      if (uiAccum.current > 120) {
        uiAccum.current = 0;
        setSanityAudio(g.sanity);
        setUi({ sanity: g.sanity, health: g.health, almonds: g.almonds, battery: g.battery, mag: g.mag, reserve: g.reserve, reloading: g.reloading > now, firing: now < g.muzzle, bobbing: moving, sprinting: moving && !!keys['shift'], documented: { ...g.sim.killed }, zone: ZONE_NAMES[zone] || 'THE BACKROOMS', message: now < g.msgUntil ? g.msg : '' });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { g.running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase]);

  // keyboard
  useEffect(() => {
    const g = gs.current;
    const down = (e) => {
      const k = e.key.toLowerCase();
      initAudio(); resumeAudio(); setMasterVolume(g.settings.volume);
      if (k === 'escape') { togglePause(); return; }
      if (g.paused) return;                    // ignore gameplay keys while paused
      g.keys[k] = true;
      if (k === 'm') { g.showMinimap = !g.showMinimap; setShowMinimap(g.showMinimap); }
      if (k === 'f') { g.flashlight = !g.flashlight; setFlashlight(g.flashlight); }
      if (k === 'c') { g.camcorder = !g.camcorder; setCamcorder(g.camcorder); playRecordBeep(g.camcorder); }
      if (k === 'e' && g.almonds > 0) { g.almonds--; g.sanity = Math.min(100, g.sanity + 35); g.msg = 'SANITY RESTORED'; g.msgUntil = performance.now() + 1800; playPickupSound(); }
      if (k === 'r') reload();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    };
    const up = (e) => { g.keys[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // mouse look + fire
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const g = gs.current;
    const mm = (e) => {
      if (document.pointerLockElement === canvas && !g.paused) {
        g.player.angle += e.movementX * 0.003 * g.settings.mouseSens;
        // vertical look: accumulate pitch (screen-row shift), clamped so you
        // can look up at the ceiling and down at the floor but not flip over.
        const inv = g.settings.invertY ? -1 : 1;
        g.pitch = Math.max(-150, Math.min(150, (g.pitch || 0) - e.movementY * 0.9 * g.settings.mouseSens * inv));
      }
    };
    const mdown = (e) => {
      if (g.paused) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
      if (e.button === 0) fire();
    };
    canvas.addEventListener('mousedown', mdown);
    document.addEventListener('mousemove', mm);
    return () => { canvas.removeEventListener('mousedown', mdown); document.removeEventListener('mousemove', mm); };
  }, [phase]);

  useEffect(() => () => stopAudio(), []);

  const togglePause = () => {
    const g = gs.current;
    g.paused = !g.paused;
    setPaused(g.paused);
    if (g.paused) { if (document.pointerLockElement) document.exitPointerLock(); }
    else { for (const k in g.keys) g.keys[k] = false; }   // clear stuck keys on resume
  };

  const changeSetting = (key, value) => {
    const g = gs.current;
    g.settings = { ...g.settings, [key]: value };
    setSettings(g.settings);
    if (key === 'volume') setMasterVolume(value);
  };

  const restart = () => {
    const g = gs.current;
    const { world, sim, sx, sy } = spawnWorld();
    g.world = world; g.sim = sim;
    g.player = { x: sx + 0.5, y: sy + 0.5, angle: Math.random() * 6.28 }; g.px = g.player.x; g.py = g.player.y;
    g.sanity = 100; g.health = 100; g.almonds = 0; g.battery = 100; g.msg = ''; g.msgUntil = 0;
    g.mag = MAG_SIZE; g.reserve = START_RESERVE; g.reloading = 0; g.pitch = 0;
    g.paused = false; setPaused(false);
    setDeathCause(null); setRecInfo(null); setPhase('playing');
  };

  // brightness multiplies the sanity colour filter
  const b = settings.brightness;
  const baseFilter = ui.sanity < 50 ? `saturate(${(0.3 + ui.sanity / 100).toFixed(2)}) contrast(1.15)` : '';
  const sanityFilter = `${baseFilter} brightness(${b.toFixed(2)})`.trim();

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#000' }}>
      <canvas ref={canvasRef} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} className="absolute"
        style={{ top: 0, left: 0, width: '100%', height: '100%', imageRendering: 'pixelated', cursor: phase === 'playing' && !paused ? 'none' : 'default', filter: sanityFilter, transition: 'filter 0.4s' }} />

      <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px)' }} />
      <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.75) 100%)' }} />
      {ui.sanity < 45 && (
        <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(120,0,0,0.45) 100%)', opacity: (45 - ui.sanity) / 45, animation: ui.sanity < 20 ? 'pulse-red 1.4s infinite' : 'none' }} />
      )}

      {/* crosshair */}
      {phase === 'playing' && !paused && settings.crosshair && (
        <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center">
          <div style={{ position: 'relative', width: 18, height: 18, opacity: 0.8 }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, width: 2, height: 6, marginLeft: -1, background: '#d8ffd8' }} />
            <div style={{ position: 'absolute', left: '50%', bottom: 0, width: 2, height: 6, marginLeft: -1, background: '#d8ffd8' }} />
            <div style={{ position: 'absolute', top: '50%', left: 0, height: 2, width: 6, marginTop: -1, background: '#d8ffd8' }} />
            <div style={{ position: 'absolute', top: '50%', right: 0, height: 2, width: 6, marginTop: -1, background: '#d8ffd8' }} />
          </div>
        </div>
      )}

      {/* pistol viewmodel — 3/4 angled FPS view: looking down the slide toward
          the crosshair (front sight at the far end, no bore facing you), hand
          barely visible at the bottom. Outer = bob; mid = reload; inner = recoil. */}
      {phase === 'playing' && !paused && (
        <div className={'absolute pointer-events-none z-20 ' + (ui.bobbing ? (ui.sprinting ? 'gun-bob-fast' : 'gun-bob') : 'gun-idle')}
          style={{ left: '50%', bottom: 0, width: 'min(320px, 32vw)', marginLeft: 'calc(min(320px, 32vw) / -2)' }}>
          <div className={ui.reloading ? 'gun-reload' : ''} style={{ width: '100%' }}>
            <div key={gunKick} className="gun-recoil" style={{ width: '100%' }}>
              <svg viewBox="0 0 400 260" shapeRendering="crispEdges" style={{ width: '100%', display: 'block', filter: 'drop-shadow(0 -3px 8px rgba(0,0,0,0.65))' }}>
                {/* slide receding toward crosshair (3/4) */}
                <polygon points="150,210 250,210 214,70 186,70" fill="#3c3c44" />
                <polygon points="150,210 186,70 180,72 142,210" fill="#4a4a53" />
                <polygon points="250,210 214,70 220,72 258,210" fill="#2a2a30" />
                {/* serrations near the rear */}
                <g stroke="#1a1a20" strokeWidth="3">
                  <line x1="158" y1="196" x2="242" y2="196" />
                  <line x1="160" y1="184" x2="240" y2="184" />
                  <line x1="162" y1="172" x2="238" y2="172" />
                </g>
                {/* front sight at the far end (toward crosshair) */}
                <rect x="194" y="58" width="12" height="14" fill="#101015" />
                <rect x="196" y="52" width="8" height="8" fill="#0a0a0d" />
                <polygon points="186,70 214,70 210,64 190,64" fill="#26262c" />
                {/* rear sight near the eye */}
                <rect x="170" y="206" width="60" height="10" fill="#22222a" />
                <rect x="180" y="207" width="8" height="8" fill="#08080b" />
                <rect x="212" y="207" width="8" height="8" fill="#08080b" />
                {/* hint of hand at the bottom */}
                <rect x="160" y="240" width="80" height="20" fill="#9a7f5e" />
                <g fill="#b0936c">
                  <rect x="172" y="232" width="14" height="14" rx="2" />
                  <rect x="190" y="230" width="14" height="16" rx="2" />
                  <rect x="208" y="232" width="14" height="14" rx="2" />
                </g>
                <polygon points="160,244 144,250 150,260 164,258" fill="#a88c68" />
                {/* muzzle flash at the front sight / far end */}
                {ui.firing && <circle cx="200" cy="62" r="22" fill="rgba(255,210,120,0.92)" />}
                {ui.firing && <circle cx="200" cy="62" r="11" fill="rgba(255,255,235,0.96)" />}
              </svg>
            </div>
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <HUD sanity={ui.sanity} health={ui.health} almonds={ui.almonds} documented={ui.documented} zoneName={ui.zone} flashlight={flashlight} camcorder={camcorder} message={ui.message} mag={ui.mag} reserve={ui.reserve} reloading={ui.reloading} />
      )}
      {phase === 'playing' && camcorder && <Camcorder battery={ui.battery} recInfo={recInfo} />}

      {phase === 'playing' && !paused && (
        <div className="absolute bottom-2 right-3 font-pixel pointer-events-none z-20" style={{ fontSize: '5px', color: '#302810', letterSpacing: '0.1em', lineHeight: 2 }}>
          WASD MOVE &middot; SHIFT RUN &middot; CLICK FIRE &middot; F LIGHT &middot; C CAMERA &middot; E DRINK &middot; M MAP &middot; ESC MENU
        </div>
      )}

      {phase === 'playing' && paused && (
        <SettingsMenu
          settings={settings}
          onChange={changeSetting}
          onResume={togglePause}
          onQuit={() => { stopAudio(); onBackToTitle && onBackToTitle(); }} />
      )}

      {phase === 'over' && (
        <GameOver
          deathText={deathCause === 'caught'
            ? 'Your body gave out. The rooms drank the last of your warmth and went on without you.'
            : 'Your mind came apart like wet wallpaper. You lost track of which corridor was which, and then of which one was you.'}
          statLabel="ENTITIES KILLED"
          statValue={Object.values(ui.documented).reduce((a, b) => a + b, 0)}
          onRestart={restart} />
      )}
    </div>
  );
}
DOOMROOMS_EOF
echo "  wrote: $LDD/src/components/game/GameEngine.jsx"

write_file "src/components/game/HUD.jsx"
cat > "$LDD/src/components/game/HUD.jsx" << 'DOOMROOMS_EOF'
import React from 'react';

const ENTITY_NAMES = { wanderer: 'Wanderer', watcher: 'Watcher', smiler: 'Smiler', hound: 'Hound' };

export default function HUD({ sanity, health, almonds, documented, zoneName, flashlight, camcorder, message, mag = 0, reserve = 0, reloading = false }) {
  const san = Math.min(100, Math.max(0, sanity));
  const hp = Math.min(100, Math.max(0, health));
  const sanCol = san > 66 ? '#3a8a00' : san > 33 ? '#e08000' : '#cc2200';
  const sanLabel = san > 80 ? 'LUCID' : san > 55 ? 'UNEASY' : san > 30 ? 'SLIPPING' : san > 12 ? 'UNRAVELING' : 'LOST';
  const docList = Object.keys(documented || {});

  return (
    <div className="absolute inset-0 pointer-events-none z-20 font-pixel" style={{ fontSize: '8px' }}>

      {/* Top-left: sanity + health */}
      <div className="absolute top-3 left-3" style={{ width: 190, maxWidth: '40vw' }}>
        <div className="flex items-center gap-1 mb-1">
          <span style={{ color: san < 40 ? '#cc2200' : '#c8b560', fontSize: 7, animation: san < 20 ? 'pulse-red 1s infinite' : 'none' }}>
            {san < 20 ? '\u{1F441}' : san < 50 ? '\u25C9' : '\u25CB'}
          </span>
          <span style={{ color: '#9a8c38', fontSize: 6, letterSpacing: '0.1em' }}>SANITY</span>
          <span style={{ color: sanCol, fontSize: 6, marginLeft: 'auto', letterSpacing: '0.05em' }}>{sanLabel}</span>
        </div>
        <div className="w-full" style={{ height: 10, border: '1px solid #504830', background: '#0a0900' }}>
          <div style={{ width: `${san}%`, height: '100%', background: sanCol, transition: 'width 0.2s, background 0.4s', boxShadow: san < 25 ? '0 0 6px #cc2200' : 'none' }} />
        </div>

        {/* Health */}
        <div className="flex items-center gap-1 mt-2 mb-1">
          <span style={{ color: '#a05050', fontSize: 7 }}>{'\u2665'}</span>
          <span style={{ color: '#7a4a4a', fontSize: 6, letterSpacing: '0.1em' }}>INTEGRITY</span>
          <span style={{ color: hp < 30 ? '#cc2200' : '#7a4a4a', fontSize: 6, marginLeft: 'auto' }}>{Math.round(hp)}</span>
        </div>
        <div className="w-full" style={{ height: 6, border: '1px solid #4a2828', background: '#0a0000' }}>
          <div style={{ width: `${hp}%`, height: '100%', background: hp < 30 ? '#cc2200' : '#8a2222', transition: 'width 0.2s' }} />
        </div>

        {/* Almond water */}
        <div className="flex items-center gap-1 mt-2" style={{ color: '#9fb0c0', fontSize: 7 }}>
          <span style={{ color: '#c8d8e8' }}>{'\u25C8'}</span>
          <span style={{ letterSpacing: '0.1em' }}>ALMOND WATER x{almonds}</span>
          <span style={{ color: '#4a5560', fontSize: 5, marginLeft: 6 }}>[E] DRINK</span>
        </div>
      </div>

      {/* Top-right: zone + field log */}
      <div className="absolute top-3 right-3 text-right">
        <div style={{ color: '#c8b560', fontSize: 8, letterSpacing: '0.15em', textShadow: '0 0 8px #c8b56088' }}>{zoneName}</div>
        <div style={{ color: '#504830', fontSize: 5, marginTop: 4, letterSpacing: '0.1em' }}>KILL LOG</div>
        {docList.length === 0 ? (
          <div style={{ color: '#3a3420', fontSize: 5, marginTop: 2 }}>— no kills —</div>
        ) : (
          docList.map((t) => (
            <div key={t} style={{ color: '#8a7e3e', fontSize: 6, marginTop: 2, letterSpacing: '0.05em' }}>
              {'\u2620'} {ENTITY_NAMES[t] || t} x{documented[t]}
            </div>
          ))
        )}
      </div>

      {/* Crosshair is drawn by GameEngine (respects the settings toggle). */}

      {/* Ammo readout (bottom-right, classic FPS placement) */}
      <div className="absolute" style={{ bottom: 18, right: 14, textAlign: 'right' }}>
        <div style={{ color: reloading ? '#e08000' : '#d8c870', fontSize: 18, letterSpacing: '0.08em', textShadow: '0 0 10px #00000099', fontFamily: 'monospace' }}>
          {reloading ? 'RELOADING' : `${mag} / ${reserve}`}
        </div>
        <div style={{ color: '#6b6440', fontSize: 6, letterSpacing: '0.15em', marginTop: 2 }}>PISTOL &middot; [R] RELOAD</div>
      </div>

      {/* Flashlight + camcorder indicators */}
      <div className="absolute bottom-8 right-3 text-right" style={{ fontSize: 6, letterSpacing: '0.15em', marginBottom: 26 }}>
        {flashlight && <div style={{ color: '#e8d870', textShadow: '0 0 8px #e8d87088' }}>{'\u25C9'} FLASHLIGHT [F]</div>}
        {camcorder && <div style={{ color: '#7CFC7C', marginTop: 3 }}>{'\u25C9'} CAMERA [C]</div>}
      </div>

      {/* Controls Legend */}
      <div
        className="absolute bottom-3 left-3"
        style={{
          fontSize: '6px',
          color: '#c8b560',
          background: 'rgba(0,0,0,0.55)',
          padding: '8px',
          border: '1px solid #504830',
          lineHeight: 1.8
        }}
      >
  <div>WASD - Move</div>
  <div>Mouse - Look</div>
  <div>Click - Fire</div>
  <div>R - Reload</div>
  <div>Shift - Sprint</div>
  <div>F - Flashlight</div>
  <div>C - Camcorder</div>
  <div>E - Drink Almond Water</div>
  <div>M - Minimap &middot; ESC - Menu</div>
</div>

      {/* Event message */}
      {message && (
        <div className="absolute bottom-16 left-0 right-0 text-center animate-fade-in-up"
          style={{ color: '#a89a3e', fontSize: 'clamp(6px,1.4vw,9px)', letterSpacing: '0.15em', textShadow: '0 0 10px #c8b56066' }}>
          {message}
        </div>
      )}
    </div>
  );
}
DOOMROOMS_EOF
echo "  wrote: $LDD/src/components/game/HUD.jsx"

write_file "src/components/game/SettingsMenu.jsx"
cat > "$LDD/src/components/game/SettingsMenu.jsx" << 'DOOMROOMS_EOF'
import React from 'react';

// Pause / settings overlay. Controlled by the parent: `settings` is the live
// values object, `onChange(key, value)` pushes a single change up, and
// `onResume` / `onQuit` handle the buttons. Pointer events are enabled here
// (unlike the HUD) so the sliders work.
const Row = ({ label, value, min, max, step, fmt, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0' }}>
    <div style={{ width: 150, color: '#d8d2b0', fontSize: 11, letterSpacing: '0.12em' }}>{label}</div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ flex: 1, accentColor: '#c8b85f', cursor: 'pointer' }}
    />
    <div style={{ width: 52, textAlign: 'right', color: '#c8b85f', fontSize: 11, fontFamily: 'monospace' }}>
      {fmt ? fmt(value) : value}
    </div>
  </div>
);

export default function SettingsMenu({ settings, onChange, onResume, onQuit }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(2px)' }}>
      <div className="font-pixel" style={{
        width: 'min(560px, 92vw)', padding: '28px 30px',
        background: 'linear-gradient(180deg, #1a1808, #0d0c06)',
        border: '1px solid #4a4420', boxShadow: '0 0 40px rgba(0,0,0,0.8)',
      }}>
        <div style={{ color: '#e8dca0', fontSize: 18, letterSpacing: '0.2em', marginBottom: 6 }}>PAUSED</div>
        <div style={{ color: '#6b6440', fontSize: 9, letterSpacing: '0.15em', marginBottom: 20 }}>SETTINGS</div>

        <Row label="BRIGHTNESS" value={settings.brightness} min={0.4} max={2} step={0.05}
          fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange('brightness', v)} />
        <Row label="MASTER VOLUME" value={settings.volume} min={0} max={1} step={0.02}
          fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange('volume', v)} />
        <Row label="MOUSE SENSITIVITY" value={settings.mouseSens} min={0.2} max={3} step={0.05}
          fmt={(v) => v.toFixed(2)} onChange={(v) => onChange('mouseSens', v)} />
        <Row label="FIELD OF VIEW" value={settings.fov} min={70} max={110} step={1}
          fmt={(v) => `${v}\u00b0`} onChange={(v) => onChange('fov', v)} />
        <Row label="CROSSHAIR" value={settings.crosshair ? 1 : 0} min={0} max={1} step={1}
          fmt={(v) => (v ? 'ON' : 'OFF')} onChange={(v) => onChange('crosshair', !!v)} />
        <Row label="INVERT LOOK Y" value={settings.invertY ? 1 : 0} min={0} max={1} step={1}
          fmt={(v) => (v ? 'ON' : 'OFF')} onChange={(v) => onChange('invertY', !!v)} />

        <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
          <button onClick={onResume} style={btn(true)}>RESUME</button>
          <button onClick={onQuit} style={btn(false)}>QUIT TO TITLE</button>
        </div>
        <div style={{ color: '#6b6440', fontSize: 8, letterSpacing: '0.12em', marginTop: 18, lineHeight: 1.8 }}>
          ESC RESUME &middot; WASD MOVE &middot; SHIFT RUN &middot; F LIGHT &middot; LEFT-CLICK FIRE &middot; C CAMERA &middot; E DRINK &middot; M MAP
        </div>
      </div>
    </div>
  );
}

function btn(primary) {
  return {
    flex: 1, padding: '12px 0', cursor: 'pointer',
    background: primary ? '#c8b85f' : 'transparent',
    color: primary ? '#1a1808' : '#c8b85f',
    border: '1px solid #c8b85f', fontSize: 11, letterSpacing: '0.18em',
    fontFamily: 'inherit',
  };
}
DOOMROOMS_EOF
echo "  wrote: $LDD/src/components/game/SettingsMenu.jsx"

write_file "src/index.css"
cat > "$LDD/src/index.css" << 'DOOMROOMS_EOF'
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 20 10% 4%;
    --foreground: 60 30% 80%;
    --card: 20 10% 6%;
    --card-foreground: 60 30% 80%;
    --popover: 20 10% 6%;
    --popover-foreground: 60 30% 80%;
    --primary: 52 55% 56%;
    --primary-foreground: 20 10% 4%;
    --secondary: 20 10% 10%;
    --secondary-foreground: 60 30% 80%;
    --muted: 20 10% 10%;
    --muted-foreground: 60 20% 50%;
    --accent: 52 55% 40%;
    --accent-foreground: 20 10% 4%;
    --destructive: 0 75% 45%;
    --destructive-foreground: 0 0% 98%;
    --border: 52 20% 20%;
    --input: 52 20% 20%;
    --ring: 52 55% 56%;
    --radius: 0px;
    --font-heading: 'Press Start 2P', monospace;
    --font-body: 'Press Start 2P', monospace;
    --font-display: 'Press Start 2P', monospace;
    --font-mono: 'Press Start 2P', monospace;

    --yellow-wall: #C8B560;
    --yellow-dark: #7A6E30;
    --yellow-mid: #A89A3E;
    --floor-color: #1a1608;
    --ceiling-color: #0a0a0a;
    --entity-red: #CC2200;
  }

  .dark {
    --background: 20 10% 4%;
    --foreground: 60 30% 80%;
    --card: 20 10% 6%;
    --card-foreground: 60 30% 80%;
    --popover: 20 10% 6%;
    --popover-foreground: 60 30% 80%;
    --primary: 52 55% 56%;
    --primary-foreground: 20 10% 4%;
    --secondary: 20 10% 10%;
    --secondary-foreground: 60 30% 80%;
    --muted: 20 10% 10%;
    --muted-foreground: 60 20% 50%;
    --accent: 52 55% 40%;
    --accent-foreground: 20 10% 4%;
    --destructive: 0 75% 45%;
    --destructive-foreground: 0 0% 98%;
    --border: 52 20% 20%;
    --input: 52 20% 20%;
    --ring: 52 55% 56%;
    --sidebar-background: 20 10% 4%;
    --sidebar-foreground: 60 30% 80%;
    --sidebar-primary: 52 55% 56%;
    --sidebar-primary-foreground: 20 10% 4%;
    --sidebar-accent: 20 10% 10%;
    --sidebar-accent-foreground: 60 30% 80%;
    --sidebar-border: 52 20% 20%;
    --sidebar-ring: 52 55% 56%;
  }
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground font-body;
    overflow: hidden;
    margin: 0;
    padding: 0;
  }
}

/* Pixel rendering */
canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

/* Scanline overlay */
.scanlines::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.18) 2px,
    rgba(0, 0, 0, 0.18) 4px
  );
  pointer-events: none;
  z-index: 10;
}

/* Vignette */
.vignette::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.85) 100%);
  pointer-events: none;
  z-index: 11;
}

/* Pixel font global */
.font-pixel {
  font-family: 'Press Start 2P', monospace;
}

/* Flicker animation */
@keyframes flicker {
  0%, 100% { opacity: 1; }
  10% { opacity: 0.85; }
  20% { opacity: 1; }
  50% { opacity: 0.9; }
  55% { opacity: 0.6; }
  56% { opacity: 1; }
  80% { opacity: 0.95; }
  85% { opacity: 0.7; }
  90% { opacity: 1; }
}

@keyframes glitch {
  0% { transform: translate(0); clip-path: none; }
  10% { transform: translate(-2px, 1px); clip-path: polygon(0 15%, 100% 15%, 100% 30%, 0 30%); }
  20% { transform: translate(2px, -1px); clip-path: none; }
  30% { transform: translate(0); }
  60% { transform: translate(1px, 0); clip-path: polygon(0 60%, 100% 60%, 100% 75%, 0 75%); }
  70% { transform: translate(-1px, 0); clip-path: none; }
  100% { transform: translate(0); }
}

@keyframes pulse-red {
  0%, 100% { text-shadow: 0 0 8px #CC2200, 0 0 20px #CC220066; }
  50% { text-shadow: 0 0 4px #CC2200; }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes screenDistort {
  0% { filter: none; }
  10% { filter: hue-rotate(90deg) saturate(3) brightness(1.5); transform: skewX(2deg); }
  11% { filter: none; transform: none; }
  40% { filter: none; }
  41% { filter: hue-rotate(180deg) saturate(5) brightness(0.7); transform: skewX(-1deg) translateX(3px); }
  42% { filter: none; transform: none; }
  100% { filter: none; }
}

.animate-flicker { animation: flicker 3s infinite; }
.animate-glitch { animation: glitch 2s infinite; }
.animate-pulse-red { animation: pulse-red 2s infinite; }
.animate-fade-in-up { animation: fadeInUp 0.5s ease forwards; }
.animate-blink { animation: blink 1s step-end infinite; }
.animate-screen-distort { animation: screenDistort 4s infinite; }

/* HUD dread bar */
.dread-bar-fill {
  transition: width 0.3s ease;
  background: linear-gradient(90deg, #3a8a00, #a0c020, #e0e000, #e08000, #cc2200);
}

/* Entity flash overlay */
@keyframes entityFlash {
  0% { opacity: 0; }
  10% { opacity: 0.8; }
  30% { opacity: 0.6; }
  50% { opacity: 0.9; }
  100% { opacity: 0; }
}
.entity-flash { animation: entityFlash 0.8s ease forwards; }

@keyframes gunRecoil {
  0%   { transform: translateY(0); }
  18%  { transform: translateY(18%) rotate(-2deg); }
  100% { transform: translateY(0); }
}
.gun-recoil { animation: gunRecoil 0.16s ease-out; }

/* weapon bob/sway — the gun "moves up and down" as you live and walk */
@keyframes gunIdle {
  0%,100% { transform: translateY(0) translateX(0); }
  50%     { transform: translateY(1.2%) translateX(0.4%); }
}
@keyframes gunBob {
  0%   { transform: translateY(0) translateX(-1.5%); }
  25%  { transform: translateY(3.5%) translateX(0); }
  50%  { transform: translateY(0) translateX(1.5%); }
  75%  { transform: translateY(3.5%) translateX(0); }
  100% { transform: translateY(0) translateX(-1.5%); }
}
@keyframes gunBobFast {
  0%   { transform: translateY(0) translateX(-2.5%) rotate(-0.5deg); }
  25%  { transform: translateY(5.5%) translateX(0) rotate(0deg); }
  50%  { transform: translateY(0) translateX(2.5%) rotate(0.5deg); }
  75%  { transform: translateY(5.5%) translateX(0) rotate(0deg); }
  100% { transform: translateY(0) translateX(-2.5%) rotate(-0.5deg); }
}
.gun-idle { animation: gunIdle 4s ease-in-out infinite; }
.gun-bob { animation: gunBob 0.7s ease-in-out infinite; }
.gun-bob-fast { animation: gunBobFast 0.5s ease-in-out infinite; }

/* reload: the weapon dips down out of view and comes back up */
@keyframes gunReload {
  0%   { transform: translateY(0) rotate(0deg); }
  25%  { transform: translateY(80%) rotate(-10deg); }
  70%  { transform: translateY(80%) rotate(-10deg); }
  100% { transform: translateY(0) rotate(0deg); }
}
.gun-reload { animation: gunReload 1.3s ease-in-out; }
DOOMROOMS_EOF
echo "  wrote: $LDD/src/index.css"

echo ""
echo "Done. All files updated."
echo "IMPORTANT next step (clears stale build cache so changes actually show):"
echo "  cd \"$LDD\"  &&  rm -rf node_modules/.vite dist  &&  npm run dev"
echo "Then HARD-REFRESH the browser: Ctrl+Shift+R"