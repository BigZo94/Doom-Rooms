import React, { useEffect, useRef, useState } from 'react';
import { castRays, SCREEN_WIDTH, SCREEN_HEIGHT, renderMinimap } from '@/lib/raycaster';
import { createChunkManager } from '@/lib/chunkManager';
import { createEntitySim } from '@/lib/entitySim';
import { ENTITY_PARAMS } from '@/lib/entities';
import {
  initAudio, resumeAudio, setZoneAudio, updateSpatialAudio, setSanityAudio,
  playStepSound, playPickupSound, playSting, playRecordBeep, stopAudio,
} from '@/lib/audioEngine';
import HUD from './HUD';
import Camcorder from './Camcorder';
import GameOver from './GameOver';

const ZONE_NAMES = ['LEVEL 0 \u2014 THE LOBBY', 'HABITABLE ZONE', 'PIPE DREAMS', 'ELECTRICAL STATION', 'ABANDONED OFFICE', 'THE TERROR HOTEL'];
const MOVE = 0.058, SPRINT = 0.095, TURN = 0.045, PSIZE = 0.26;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
  if (!gs.current) gs.current = { player: { x: 0.5, y: 0.5, angle: 0 }, world: null, sim: null, keys: {}, running: false, sanity: 100, health: 100, almonds: 0, battery: 100, flashlight: false, camcorder: false, showMinimap: false, stepTimer: 0, px: 0, py: 0, msg: '', msgUntil: 0 };

  const [ui, setUi] = useState({ sanity: 100, health: 100, almonds: 0, battery: 100, documented: {}, zone: ZONE_NAMES[0], message: '' });
  const [flashlight, setFlashlight] = useState(false);
  const [camcorder, setCamcorder] = useState(false);
  const [, setShowMinimap] = useState(false);
  const [recInfo, setRecInfo] = useState(null);
  const [phase, setPhase] = useState('playing');
  const [deathCause, setDeathCause] = useState(null);
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
        onContact: ({ health = 0, sanity = 0 }) => { g.health -= health; g.sanity -= sanity; },
        onDocument: (type) => { g.sanity = Math.min(100, g.sanity + 18); g.msg = 'DOCUMENTED: ' + type.toUpperCase(); g.msgUntil = now + 2600; playSting(type); },
        onAlert: () => {},
      });

      // ---- sanity dynamics, pickups, battery ----
      if (world.isSafeRoom(Math.floor(p.x), Math.floor(p.y))) g.sanity += 0.06 * dt / 16;
      for (const a of world.almondsNear(p.x, p.y, 4)) {
        if (Math.hypot(a.x - p.x, a.y - p.y) < 0.6) { world.takeItem(a.id); g.almonds++; g.msg = 'ALMOND WATER ACQUIRED'; g.msgUntil = now + 2000; playPickupSound(); }
      }
      if (recording) g.battery = Math.max(0, g.battery - dt * 0.004); else g.battery = Math.min(100, g.battery + dt * 0.0016);

      g.sanity = clamp(g.sanity, 0, 100); g.health = clamp(g.health, 0, 100);
      if (g.health <= 0) { endGame('caught'); return; }
      if (g.sanity <= 0) { endGame('lost'); return; }

      // ---- audio + render ----
      const zone = world.zoneAt(Math.floor(p.x), Math.floor(p.y));
      setZoneAudio(zone);
      updateSpatialAudio(p, g.sim.physical, dt);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        castRays(ctx, world, p, zone, 100 - g.sanity, g.sim.physical, g.flashlight);
        if (g.showMinimap) renderMinimap(ctx, world, p, g.sim.physical);
      }

      // ---- throttled UI sync ----
      uiAccum.current += dt;
      if (uiAccum.current > 120) {
        uiAccum.current = 0;
        setSanityAudio(g.sanity);
        let rt = null, best = 0;
        for (const e of g.sim.physical) { if ((e.capture || 0) > best) { best = e.capture; rt = e; } }
        setRecInfo(g.camcorder && rt ? { type: rt.type, progress: Math.min(1, rt.capture / (ENTITY_PARAMS[rt.type].record || 3)) } : null);
        setUi({ sanity: g.sanity, health: g.health, almonds: g.almonds, battery: g.battery, documented: { ...g.sim.documented }, zone: ZONE_NAMES[zone] || 'THE BACKROOMS', message: now < g.msgUntil ? g.msg : '' });
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
      g.keys[k] = true; initAudio(); resumeAudio();
      if (k === 'm') { g.showMinimap = !g.showMinimap; setShowMinimap(g.showMinimap); }
      if (k === 'f') { g.flashlight = !g.flashlight; setFlashlight(g.flashlight); }
      if (k === 'c') { g.camcorder = !g.camcorder; setCamcorder(g.camcorder); playRecordBeep(g.camcorder); }
      if (k === 'e' && g.almonds > 0) { g.almonds--; g.sanity = Math.min(100, g.sanity + 35); g.msg = 'SANITY RESTORED'; g.msgUntil = performance.now() + 1800; playPickupSound(); }
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    };
    const up = (e) => { g.keys[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // mouse look
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const mm = (e) => { if (document.pointerLockElement === canvas) gs.current.player.angle += e.movementX * 0.003; };
    const click = () => canvas.requestPointerLock();
    canvas.addEventListener('click', click); document.addEventListener('mousemove', mm);
    return () => { canvas.removeEventListener('click', click); document.removeEventListener('mousemove', mm); };
  }, [phase]);

  useEffect(() => () => stopAudio(), []);

  const restart = () => {
    const g = gs.current;
    const { world, sim, sx, sy } = spawnWorld();
    g.world = world; g.sim = sim;
    g.player = { x: sx + 0.5, y: sy + 0.5, angle: Math.random() * 6.28 }; g.px = g.player.x; g.py = g.player.y;
    g.sanity = 100; g.health = 100; g.almonds = 0; g.battery = 100; g.msg = ''; g.msgUntil = 0;
    setDeathCause(null); setRecInfo(null); setPhase('playing');
  };

  const sanityFilter = ui.sanity < 50 ? `saturate(${(0.3 + ui.sanity / 100).toFixed(2)}) contrast(1.15) brightness(0.95)` : 'none';

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#000' }}>
      <canvas ref={canvasRef} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} className="absolute"
        style={{ top: 0, left: 0, width: '100%', height: '100%', imageRendering: 'pixelated', cursor: phase === 'playing' ? 'none' : 'default', filter: sanityFilter, transition: 'filter 0.4s' }} />

      <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px)' }} />
      <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.75) 100%)' }} />
      {ui.sanity < 45 && (
        <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(120,0,0,0.45) 100%)', opacity: (45 - ui.sanity) / 45, animation: ui.sanity < 20 ? 'pulse-red 1.4s infinite' : 'none' }} />
      )}

      {phase === 'playing' && (
        <HUD sanity={ui.sanity} health={ui.health} almonds={ui.almonds} documented={ui.documented} zoneName={ui.zone} flashlight={flashlight} camcorder={camcorder} message={ui.message} />
      )}
      {phase === 'playing' && camcorder && <Camcorder battery={ui.battery} recInfo={recInfo} />}

      {phase === 'playing' && (
        <div className="absolute bottom-2 right-3 font-pixel pointer-events-none z-20" style={{ fontSize: '5px', color: '#302810', letterSpacing: '0.1em', lineHeight: 2 }}>
          WASD MOVE · SHIFT RUN · MOUSE LOOK · F LIGHT · C CAMERA · E DRINK · M MAP
        </div>
      )}

      {phase === 'over' && (
        <GameOver
          deathText={deathCause === 'caught'
            ? 'Something reached you in the dark. The hum swallowed the sound, and the rooms went on without you.'
            : 'Your mind came apart like wet wallpaper. You lost track of which corridor was which, and then of which one was you.'}
          statLabel="ENTITIES DOCUMENTED"
          statValue={Object.values(ui.documented).reduce((a, b) => a + b, 0)}
          onRestart={restart} />
      )}
    </div>
  );
}
