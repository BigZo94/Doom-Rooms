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
        <Row label="FIELD OF VIEW" value={settings.fov} min={60} max={100} step={1}
          fmt={(v) => `${v}\u00b0`} onChange={(v) => onChange('fov', v)} />
        <Row label="CROSSHAIR" value={settings.crosshair ? 1 : 0} min={0} max={1} step={1}
          fmt={(v) => (v ? 'ON' : 'OFF')} onChange={(v) => onChange('crosshair', !!v)} />

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
