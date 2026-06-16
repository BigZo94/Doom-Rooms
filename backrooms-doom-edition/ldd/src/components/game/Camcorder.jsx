import React, { useEffect, useState } from 'react';

// Found-footage camcorder overlay. Renders over the canvas while recording:
// night-vision tint, viewfinder, REC + timecode, battery, focus reticle and a
// live capture bar for whatever entity is currently being documented.
export default function Camcorder({ battery, recInfo }) {
  const [tc, setTc] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTc((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(tc / 60)).padStart(2, '0');
  const ss = String(tc % 60).padStart(2, '0');
  const batCol = battery > 40 ? '#7CFC7C' : battery > 15 ? '#e0c020' : '#cc2200';

  const Bracket = ({ style }) => (
    <div style={{ position: 'absolute', width: 26, height: 26, border: '2px solid rgba(180,255,180,0.5)', ...style }} />
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-30 font-pixel" style={{ overflow: 'hidden' }}>
      {/* night-vision green wash */}
      <div className="absolute inset-0" style={{ background: 'rgba(20,90,20,0.16)', mixBlendMode: 'screen' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,20,0,0.55) 100%)' }} />
      {/* heavy interlace lines */}
      <div className="absolute inset-0" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 3px)',
      }} />
      {/* rolling tracking band */}
      <div className="absolute" style={{ left: 0, right: 0, top: `${(tc * 13) % 100}%`, height: 3, background: 'rgba(180,255,180,0.06)' }} />

      {/* viewfinder brackets */}
      <Bracket style={{ top: 16, left: 16, borderRight: 'none', borderBottom: 'none' }} />
      <Bracket style={{ top: 16, right: 16, borderLeft: 'none', borderBottom: 'none' }} />
      <Bracket style={{ bottom: 16, left: 16, borderRight: 'none', borderTop: 'none' }} />
      <Bracket style={{ bottom: 16, right: 16, borderLeft: 'none', borderTop: 'none' }} />

      {/* REC + timecode */}
      <div className="absolute flex items-center gap-2" style={{ top: 18, left: 52 }}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff2200', boxShadow: '0 0 8px #ff2200', animation: 'blink 1s step-end infinite' }} />
        <span style={{ color: '#ff5040', fontSize: 9, letterSpacing: '0.25em' }}>REC</span>
        <span style={{ color: 'rgba(190,255,190,0.85)', fontSize: 8, fontFamily: 'monospace', marginLeft: 6 }}>{mm}:{ss}:00</span>
      </div>

      {/* battery */}
      <div className="absolute flex items-center gap-1" style={{ top: 18, right: 52 }}>
        <span style={{ color: 'rgba(190,255,190,0.7)', fontSize: 7, letterSpacing: '0.1em' }}>BATT</span>
        <div style={{ width: 28, height: 9, border: '1px solid rgba(190,255,190,0.6)', padding: 1 }}>
          <div style={{ width: `${battery}%`, height: '100%', background: batCol }} />
        </div>
      </div>

      {/* focus reticle */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div style={{ position: 'relative', width: 54, height: 54, animation: 'pulse-red 2s infinite' }}>
          <div style={{ position: 'absolute', top: 0, left: '50%', width: 1, height: 10, background: 'rgba(190,255,190,0.7)', transform: 'translateX(-50%)' }} />
          <div style={{ position: 'absolute', bottom: 0, left: '50%', width: 1, height: 10, background: 'rgba(190,255,190,0.7)', transform: 'translateX(-50%)' }} />
          <div style={{ position: 'absolute', left: 0, top: '50%', height: 1, width: 10, background: 'rgba(190,255,190,0.7)', transform: 'translateY(-50%)' }} />
          <div style={{ position: 'absolute', right: 0, top: '50%', height: 1, width: 10, background: 'rgba(190,255,190,0.7)', transform: 'translateY(-50%)' }} />
        </div>
      </div>

      {/* capture progress for the entity being documented */}
      {recInfo && (
        <div className="absolute left-0 right-0 text-center" style={{ bottom: 54 }}>
          <div style={{ color: '#aef0ae', fontSize: 7, letterSpacing: '0.2em', marginBottom: 4 }}>
            DOCUMENTING: {String(recInfo.type).toUpperCase()}
          </div>
          <div style={{ width: '40%', maxWidth: 240, height: 6, margin: '0 auto', border: '1px solid rgba(190,255,190,0.6)' }}>
            <div style={{ width: `${Math.round(recInfo.progress * 100)}%`, height: '100%', background: '#7CFC7C', transition: 'width 0.1s' }} />
          </div>
        </div>
      )}

      {/* mode label */}
      <div className="absolute" style={{ bottom: 18, left: 52, color: 'rgba(190,255,190,0.6)', fontSize: 6, letterSpacing: '0.15em' }}>
        NIGHT VISION · ENTITY CAPTURE
      </div>
    </div>
  );
}
