/** Wordmark for Jetstorm Arena — pure CSS/SVG, no font downloads. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col items-center select-none">
      <div
        className="title-glow font-black tracking-widest"
        style={{
          fontSize: compact ? '1.6rem' : '3.4rem',
          lineHeight: 1.05,
          background: 'linear-gradient(180deg, #fff3d6 20%, #ffbe5c 65%, #a86a17 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        JETSTORM
      </div>
      <div
        className="font-bold tracking-[0.55em] text-center"
        style={{
          fontSize: compact ? '0.6rem' : '0.95rem',
          color: 'var(--accent-2)',
          textShadow: '0 0 14px #ffd23c66',
          marginRight: '-0.55em',
        }}
      >
        ARENA
      </div>
    </div>
  );
}
