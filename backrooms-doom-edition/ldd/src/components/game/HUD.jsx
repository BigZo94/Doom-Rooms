import React from 'react';

const ENTITY_NAMES = { wanderer: 'Wanderer', watcher: 'Watcher', smiler: 'Smiler', hound: 'Hound' };

export default function HUD({ sanity, health, almonds, documented, zoneName, flashlight, camcorder, message }) {
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
        <div style={{ color: '#504830', fontSize: 5, marginTop: 4, letterSpacing: '0.1em' }}>FIELD LOG</div>
        {docList.length === 0 ? (
          <div style={{ color: '#3a3420', fontSize: 5, marginTop: 2 }}>— nothing documented —</div>
        ) : (
          docList.map((t) => (
            <div key={t} style={{ color: '#8a7e3e', fontSize: 6, marginTop: 2, letterSpacing: '0.05em' }}>
              {'\u2713'} {ENTITY_NAMES[t] || t} x{documented[t]}
            </div>
          ))
        )}
      </div>

      {/* Crosshair (hidden while camcorder reticle is up) */}
      {!camcorder && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={{ position: 'relative', width: 12, height: 12 }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(200,181,96,0.45)', transform: 'translateY(-50%)' }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(200,181,96,0.45)', transform: 'translateX(-50%)' }} />
          </div>
        </div>
      )}

      {/* Flashlight + camcorder indicators */}
      <div className="absolute bottom-8 right-3 text-right" style={{ fontSize: 6, letterSpacing: '0.15em' }}>
        {flashlight && <div style={{ color: '#e8d870', textShadow: '0 0 8px #e8d87088' }}>{'\u25C9'} FLASHLIGHT [F]</div>}
        {camcorder && <div style={{ color: '#7CFC7C', marginTop: 3 }}>{'\u25C9'} CAMERA [C]</div>}
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
