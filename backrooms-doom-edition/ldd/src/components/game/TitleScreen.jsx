import React, { useEffect, useState } from 'react';
import { initAudio, resumeAudio } from '@/lib/audioEngine';

export default function TitleScreen({ onStart }) {
  const [blink, setBlink] = useState(true);
  const [glitch, setGlitch] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setBlink(b => !b), 600);
    const glitchInterval = setInterval(() => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 150);
    }, 4000 + Math.random() * 3000);
    return () => { clearInterval(interval); clearInterval(glitchInterval); };
  }, []);

  const handleStart = () => {
    initAudio();
    resumeAudio();
    onStart();
  };

  return (
    <div
      className="relative w-full h-full flex flex-col items-center justify-center scanlines vignette overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #0a0a00 0%, #0d0c00 40%, #111008 100%)' }}
    >
      {/* Background grid lines */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'linear-gradient(#c8b56020 1px, transparent 1px), linear-gradient(90deg, #c8b56020 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }} />

      {/* Corridor image simulation */}
      <div className="absolute inset-0 flex items-center justify-center opacity-20">
        <div style={{
          width: '100%', height: '100%',
          background: 'radial-gradient(ellipse 60% 80% at 50% 50%, #c8b56030 0%, transparent 70%)'
        }} />
      </div>

      {/* Title */}
      <div className={`relative z-20 text-center px-4 ${glitch ? 'animate-glitch' : ''}`}>
        <div
          className="font-pixel mb-2 tracking-widest"
          style={{
            fontSize: 'clamp(8px, 2.5vw, 18px)',
            color: '#c8b560',
            textShadow: '0 0 20px #c8b56099, 0 0 40px #c8b56044',
            letterSpacing: '0.3em',
          }}
        >
          YOU HAVE NOCLIPPED INTO
        </div>

        <div
          className="font-pixel mb-1"
          style={{
            fontSize: 'clamp(20px, 5vw, 52px)',
            color: '#e8d870',
            textShadow: '3px 3px 0 #7a6e00, 0 0 30px #c8b560aa, 0 0 60px #c8b56055',
            lineHeight: 1.2,
          }}
        >
          THE
        </div>
        <div
          className="font-pixel mb-6"
          style={{
            fontSize: 'clamp(20px, 5vw, 52px)',
            color: '#e8d870',
            textShadow: '3px 3px 0 #7a6e00, 0 0 30px #c8b560aa, 0 0 60px #c8b56055',
            lineHeight: 1.2,
          }}
        >
          BACKROOMS
        </div>

        <div
          className="font-pixel mb-10"
          style={{
            fontSize: 'clamp(6px, 1.5vw, 12px)',
            color: '#a89a3e',
            letterSpacing: '0.4em',
          }}
        >
          ░░ DOOM EDITION ░░
        </div>

        {/* Flavor text */}
        <div
          className="font-pixel mb-12 max-w-md mx-auto"
          style={{
            fontSize: 'clamp(4px, 1.2vw, 9px)',
            color: '#786e28',
            lineHeight: 2.2,
            letterSpacing: '0.05em',
          }}
        >
          {"THERE ARE AN ESTIMATED 600 MILLION\nSQ. MILES OF RANDOMLY GENERATED SPACE.\nGOOD LUCK."}
        </div>

        {/* Start prompt */}
        <button
          onClick={handleStart}
          className="font-pixel cursor-pointer border-2 px-8 py-4 transition-all duration-150 hover:scale-105 active:scale-95"
          style={{
            fontSize: 'clamp(6px, 1.5vw, 11px)',
            color: blink ? '#e8d870' : '#786e28',
            borderColor: blink ? '#c8b560' : '#786e28',
            background: 'transparent',
            boxShadow: blink ? '0 0 20px #c8b56055, inset 0 0 10px #c8b56022' : 'none',
            letterSpacing: '0.2em',
            transition: 'all 0.1s',
          }}
        >
          ▶  PRESS START  ◀
        </button>

        {/* Controls hint */}
        <div
          className="font-pixel mt-8"
          style={{
            fontSize: 'clamp(4px, 0.9vw, 7px)',
            color: '#504830',
            letterSpacing: '0.1em',
            lineHeight: 2,
          }}
        >
          WASD MOVE · SHIFT RUN · MOUSE LOOK · F LIGHT · C CAMERA · E DRINK · M MAP
        </div>
        <div
          className="font-pixel mt-3"
          style={{ fontSize: 'clamp(4px, 0.85vw, 6px)', color: '#6a5a28', letterSpacing: '0.1em', lineHeight: 1.9, maxWidth: '34rem' }}
        >
          DOCUMENT THE ENTITIES WITH YOUR CAMERA · DRINK ALMOND WATER TO HOLD ON TO YOUR MIND · THERE IS NO EXIT, ONLY DEEPER
        </div>
      </div>

      {/* Scanline overlay intensity */}
      <div className="absolute inset-0 pointer-events-none z-30" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.1) 3px, rgba(0,0,0,0.1) 4px)'
      }} />

      {/* Bottom horror text */}
      <div
        className="absolute bottom-4 left-0 right-0 text-center font-pixel animate-flicker"
        style={{ fontSize: 'clamp(4px, 0.8vw, 6px)', color: '#3a3010', letterSpacing: '0.2em' }}
      >
        IF YOU HEAR RUNNING BEHIND YOU — DO NOT TURN AROUND
      </div>
    </div>
  );
}