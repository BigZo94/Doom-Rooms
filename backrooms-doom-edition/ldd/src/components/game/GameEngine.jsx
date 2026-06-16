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

const DEFAULT_SETTINGS = { brightness: 1, volume: 0.8, mouseSens: 1, fov: 90, crosshair: true };

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
    player: { x: 0.5, y: 0.5, angle: 0, pitch: 0 }, world: null, sim: null, keys: {}, running: false,
    sanity: 100, health: 100, almonds: 0, battery: 100, flashlight: false, camcorder: false,
    showMinimap: false, stepTimer: 0, px: 0, py: 0, msg: '', msgUntil: 0,
    gunTimer: 0, muzzle: 0, hitFlash: 0, paused: false, settings: { ...DEFAULT_SETTINGS },
    mag: MAG_SIZE, reserve: START_RESERVE, reloading: 0,
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
    g.player = { x: sx + 0.5, y: sy + 0.5, angle: Math.random() * 6.28, pitch: 0 };
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
          muzzle: now < g.muzzle, hitFlash: now < g.hitFlash, fov: g.settings.fov,
        });
        if (g.showMinimap) renderMinimap(ctx, world, p, g.sim.physical);
      }

      // ---- throttled UI sync ----
      uiAccum.current += dt;
      if (uiAccum.current > 120) {
        uiAccum.current = 0;
        setSanityAudio(g.sanity);
        setUi({ sanity: g.sanity, health: g.health, almonds: g.almonds, battery: g.battery, mag: g.mag, reserve: g.reserve, reloading: g.reloading > now, firing: now < g.muzzle, documented: { ...g.sim.killed }, zone: ZONE_NAMES[zone] || 'THE BACKROOMS', message: now < g.msgUntil ? g.msg : '' });
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
        // vertical look: clamp generously so you can crank up/down (raycaster y-shear)
        g.player.pitch = Math.max(-300, Math.min(300, (g.player.pitch || 0) - e.movementY * 1.1 * g.settings.mouseSens));
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
    g.player = { x: sx + 0.5, y: sy + 0.5, angle: Math.random() * 6.28, pitch: 0 }; g.px = g.player.x; g.py = g.player.y;
    g.sanity = 100; g.health = 100; g.almonds = 0; g.battery = 100; g.msg = ''; g.msgUntil = 0;
    g.mag = MAG_SIZE; g.reserve = START_RESERVE; g.reloading = 0;
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

      {/* pistol viewmodel — first-person, barrel pointing forward/up toward the
          crosshair (recoils on each shot via the gunKick key) */}
      {phase === 'playing' && !paused && (
        <div key={gunKick} className="absolute pointer-events-none z-20 gun-recoil"
          style={{ left: '50%', bottom: 0, width: 'min(300px, 46vw)', transform: 'translate(-50%, 6%)' }}>
          <svg viewBox="0 0 200 210" style={{ width: '100%', display: 'block', filter: 'drop-shadow(0 -3px 8px rgba(0,0,0,0.75))' }}>
            <g transform="rotate(-5 100 150)">
              {/* muzzle flash at the TOP (where the barrel points) when firing */}
              {ui.firing && <circle cx="100" cy="38" r="20" fill="rgba(255,230,150,0.85)" />}
              {ui.firing && <path d="M100 8 L108 36 L100 27 L92 36 Z M70 38 L97 44 L70 50 Z M130 38 L103 44 L130 50 Z M81 16 L98 38 L87 28 Z M119 16 L102 38 L113 28 Z" fill="rgba(255,245,205,0.92)" />}
              {/* barrel bore */}
              <ellipse cx="100" cy="44" rx="10" ry="4.5" fill="#0a0a0d" />
              {/* slide / barrel: foreshortened, widening toward the viewer */}
              <polygon points="89,44 111,44 122,150 78,150" fill="#2b2b31" />
              <polygon points="96,44 104,44 105,150 95,150" fill="#3c3c45" />
              {/* front + rear sights */}
              <rect x="96" y="35" width="8" height="10" rx="1" fill="#1b1b1f" />
              <rect x="86" y="144" width="28" height="9" rx="2" fill="#15151a" />
              <rect x="98" y="144" width="4" height="9" fill="#000" />
              {/* ejection port */}
              <rect x="103" y="80" width="11" height="20" rx="2" fill="#161619" />
              {/* frame / grip wedge down to the hands */}
              <polygon points="78,150 122,150 130,178 146,205 54,205 70,178" fill="#212126" />
              {/* trigger guard */}
              <path d="M90 156 q-14 12 2 26 l9 0 q-16 -10 -3 -26 z" fill="#19191e" />
              {/* hand wrapping the grip */}
              <path d="M56 205 q-3 -28 16 -36 l56 0 q19 8 16 36 z" fill="#7c6850" />
              <g fill="#6c5944">
                <rect x="60" y="176" width="80" height="8" rx="4" />
                <rect x="57" y="187" width="86" height="8" rx="4" />
                <rect x="60" y="197" width="80" height="7" rx="4" />
              </g>
              <path d="M126 172 q22 8 18 30 l-11 0 q3 -18 -13 -24 z" fill="#74604a" />
            </g>
          </svg>
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
