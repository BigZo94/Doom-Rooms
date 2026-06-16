import React, { useEffect, useState } from 'react';

export default function LevelTransition({ levelData, aiDescription, onComplete }) {
  const [phase, setPhase] = useState('fade-in'); // fade-in, show, fade-out
  const [displayedText, setDisplayedText] = useState('');
  const fullText = aiDescription || levelData?.description || '';
  const isLoading = !aiDescription;

  useEffect(() => {
    if (!aiDescription) return; // wait for AI text
    setPhase('fade-in');
    setDisplayedText('');

    const fadeInTimer = setTimeout(() => {
      setPhase('show');
      // Typewriter effect
      let i = 0;
      const typeInterval = setInterval(() => {
        if (i < fullText.length) {
          setDisplayedText(fullText.slice(0, i + 1));
          i++;
        } else {
          clearInterval(typeInterval);
        }
      }, 30);

      // Don't return from a useEffect callback
    }, 300);

    const totalDuration = 300 + fullText.length * 30 + 2200;
    const completeTimer = setTimeout(() => {
      setPhase('fade-out');
      setTimeout(onComplete, 800);
    }, totalDuration);

    return () => {
      clearTimeout(fadeInTimer);
      clearTimeout(completeTimer);
    };
  }, [aiDescription]);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center font-pixel"
      style={{
        background: 'rgba(0,0,0,0.97)',
        opacity: phase === 'fade-out' ? 0 : 1,
        transition: 'opacity 1s ease',
      }}
    >
      {/* Scanlines on transition */}
      <div className="absolute inset-0" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(200,181,96,0.03) 3px, rgba(200,181,96,0.03) 4px)'
      }} />

      <div className="relative z-10 text-center max-w-2xl px-8">
        {/* Level name */}
        <div
          style={{
            fontSize: 'clamp(8px, 2.5vw, 18px)',
            color: '#c8b560',
            letterSpacing: '0.3em',
            textShadow: '0 0 20px #c8b56088',
            marginBottom: 8,
          }}
        >
          ENTERING
        </div>
        <div
          className="animate-flicker"
          style={{
            fontSize: 'clamp(16px, 4vw, 38px)',
            color: '#e8d870',
            textShadow: '3px 3px 0 #7a6e00, 0 0 30px #c8b560aa',
            marginBottom: 4,
          }}
        >
          {levelData?.name}
        </div>
        <div
          style={{
            fontSize: 'clamp(6px, 1.5vw, 11px)',
            color: '#a89a3e',
            letterSpacing: '0.2em',
            marginBottom: 32,
          }}
        >
          ─── {levelData?.subtitle} ───
        </div>

        {/* AI description typewriter */}
        <div
          style={{
            fontSize: 'clamp(5px, 1.2vw, 9px)',
            color: '#786e28',
            lineHeight: 2.2,
            letterSpacing: '0.08em',
            minHeight: '80px',
          }}
        >
          {isLoading ? (
            <span className="animate-flicker" style={{ color: '#504830' }}>SCANNING LEVEL DATA<span className="animate-blink" style={{ color: '#c8b560' }}>█</span></span>
          ) : (
            <>
              {displayedText}
              {displayedText.length < fullText.length && (
                <span className="animate-blink" style={{ color: '#c8b560' }}>█</span>
              )}
            </>
          )}
        </div>

        {/* Bottom hint */}
        <div
          className="animate-flicker"
          style={{
            marginTop: 32,
            fontSize: 'clamp(4px, 0.9vw, 7px)',
            color: '#3a3010',
            letterSpacing: '0.15em',
          }}
        >
          FIND THE EXIT. DO NOT LOSE YOUR MIND.
        </div>
      </div>
    </div>
  );
}