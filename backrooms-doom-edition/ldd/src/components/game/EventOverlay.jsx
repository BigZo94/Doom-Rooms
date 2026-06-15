import React, { useEffect, useState } from 'react';

export default function EventOverlay({ event, onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 500);
    }, event?.duration || 3000);
    return () => clearTimeout(timer);
  }, [event]);

  if (!event || !visible) return null;

  const isEntity = event.type === 'entity';
  const isWarning = event.type === 'warning';

  return (
    <div
      className="absolute inset-0 z-40 flex items-end justify-center pb-24 pointer-events-none"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.5s' }}
    >
      {/* Entity flash: red border flash */}
      {isEntity && (
        <div
          className="absolute inset-0 entity-flash pointer-events-none"
          style={{ border: '3px solid rgba(200,0,0,0.6)', boxShadow: 'inset 0 0 60px rgba(200,0,0,0.3)' }}
        />
      )}

      {/* Message box */}
      <div
        className="font-pixel text-center animate-fade-in-up px-4"
        style={{
          fontSize: 'clamp(5px, 1.2vw, 9px)',
          color: isEntity ? '#ff4422' : isWarning ? '#ffaa00' : '#c8b560',
          lineHeight: 2,
          letterSpacing: '0.1em',
          textShadow: isEntity
            ? '0 0 15px #ff440088'
            : '0 0 10px #c8b56066',
          maxWidth: '70%',
          background: 'rgba(0,0,0,0.75)',
          padding: '8px 16px',
          border: `1px solid ${isEntity ? '#cc220044' : '#c8b56022'}`,
        }}
      >
        {isEntity && <span style={{ color: '#cc2200' }}>⚠ </span>}
        {event.message}
      </div>
    </div>
  );
}