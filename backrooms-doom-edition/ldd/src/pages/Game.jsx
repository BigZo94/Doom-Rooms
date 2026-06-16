import React, { useState } from 'react';
import TitleScreen from '@/components/game/TitleScreen';
import GameEngine from '@/components/game/GameEngine';

export default function Game() {
  const [started, setStarted] = useState(false);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: '#000', userSelect: 'none' }}
    >
      {!started ? (
        <TitleScreen onStart={() => setStarted(true)} />
      ) : (
        <GameEngine onBackToTitle={() => setStarted(false)} />
      )}
    </div>
  );
}