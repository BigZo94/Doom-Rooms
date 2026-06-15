import React, { useEffect, useState } from 'react';

export default function GameOver({ deathText, statLabel = 'LEVELS SURVIVED', statValue = 0, onRestart }) {
  const [show, setShow] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const fullText = deathText || 'Your mind fractured like old wallpaper. The hum absorbed what was left of you. You became part of the Backrooms.';

  useEffect(() => {
    setTimeout(() => setShow(true), 500);
    let i = 0;
    const typeInterval = setInterval(() => {
      if (i < fullText.length) {
        setDisplayedText(fullText.slice(0, i + 1));
        i++;
      } else {
        clearInterval(typeInterval);
      }
    }, 35);
    return () => clearInterval(typeInterval);
  }, []);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center font-pixel"
      style={{
        background: 'radial-gradient(ellipse at center, #1a0000 0%, #000000 100%)',
        opacity: show ? 1 : 0,
        transition: 'opacity 1.5s ease',
      }}
    >
      {/* Scanlines */}
      <div className="absolute inset-0" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(200,0,0,0.04) 2px, rgba(200,0,0,0.04) 4px)'
      }} />

      <div className="relative z-10 text-center max-w-xl px-8">
        {/* YOU DIED */}
        <div
          className="animate-glitch mb-2"
          style={{
            fontSize: 'clamp(28px, 7vw, 72px)',
            color: '#cc2200',
            textShadow: '4px 4px 0 #660000, 0 0 30px #cc220099',
          }}
        >
          YOU DIED
        </div>

        <div
          style={{
            fontSize: 'clamp(6px, 1.5vw, 10px)',
            color: '#660000',
            letterSpacing: '0.4em',
            marginBottom: 32,
          }}
        >
          YOUR MIND BELONGS TO THE BACKROOMS NOW
        </div>

        {/* Stats */}
        <div
          style={{
            fontSize: 'clamp(5px, 1.2vw, 8px)',
            color: '#503010',
            letterSpacing: '0.1em',
            marginBottom: 24,
          }}
        >
          {statLabel}: {statValue}
        </div>

        {/* Death description */}
        <div
          style={{
            fontSize: 'clamp(5px, 1.1vw, 8px)',
            color: '#7a3020',
            lineHeight: 2.2,
            letterSpacing: '0.08em',
            minHeight: '80px',
            marginBottom: 40,
            padding: '12px 16px',
            border: '1px solid #330000',
            background: 'rgba(30,0,0,0.5)',
          }}
        >
          {displayedText}
          {displayedText.length < fullText.length && (
            <span className="animate-blink" style={{ color: '#cc2200' }}>█</span>
          )}
        </div>

        {/* Restart */}
        <button
          onClick={onRestart}
          className="font-pixel cursor-pointer border-2 px-8 py-4 transition-all duration-150 hover:scale-105 active:scale-95"
          style={{
            fontSize: 'clamp(6px, 1.3vw, 9px)',
            color: '#cc2200',
            borderColor: '#660000',
            background: 'transparent',
            letterSpacing: '0.2em',
          }}
        >
          ▶  TRY AGAIN  ◀
        </button>
      </div>
    </div>
  );
}