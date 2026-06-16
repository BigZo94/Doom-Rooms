import React, { useEffect, useState } from 'react';

export default function ExitFound({ onConfirm }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setTimeout(() => setShow(true), 100);
  }, []);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center font-pixel"
      style={{
        background: 'rgba(0, 20, 5, 0.92)',
        opacity: show ? 1 : 0,
        transition: 'opacity 0.8s ease',
      }}
    >
      <div className="absolute inset-0" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,80,0.02) 3px, rgba(0,255,80,0.02) 4px)'
      }} />

      <div className="relative z-10 text-center max-w-md px-8">
        <div
          className="animate-flicker mb-4"
          style={{
            fontSize: 'clamp(6px, 1.5vw, 10px)',
            color: '#00cc44',
            letterSpacing: '0.3em',
          }}
        >
          ░░░ EXIT DETECTED ░░░
        </div>

        <div
          style={{
            fontSize: 'clamp(24px, 5vw, 48px)',
            color: '#00ff66',
            textShadow: '3px 3px 0 #004422, 0 0 30px #00ff6688',
            marginBottom: 24,
          }}
        >
          DESCEND?
        </div>

        <div
          style={{
            fontSize: 'clamp(5px, 1.1vw, 8px)',
            color: '#00884422',
            letterSpacing: '0.1em',
            marginBottom: 32,
            color: '#337744',
            lineHeight: 2,
          }}
        >
          THE NEXT LEVEL IS DEEPER.<br />
          THE HAZE IS THICKER.<br />
          SOMETHING IS CLOSER.
        </div>

        <button
          onClick={onConfirm}
          className="font-pixel cursor-pointer border-2 px-8 py-4 transition-all duration-150 hover:scale-105 active:scale-95"
          style={{
            fontSize: 'clamp(6px, 1.3vw, 9px)',
            color: '#00cc44',
            borderColor: '#004422',
            background: 'transparent',
            letterSpacing: '0.2em',
          }}
        >
          ▶  GO DEEPER  ◀
        </button>
      </div>
    </div>
  );
}