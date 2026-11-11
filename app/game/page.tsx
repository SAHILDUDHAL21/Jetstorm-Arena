'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

// The Phaser engine must never be evaluated during server prerender.
const GameClient = dynamic(
  () => import('@/components/game/GameClient').then((m) => m.GameClient),
  { ssr: false },
);

function GameInner() {
  const code = (useSearchParams().get('code') ?? '').toUpperCase();
  return <GameClient code={code} />;
}

export default function GamePage() {
  return (
    <main className="h-dvh">
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center">
            <div className="text-lg pulse font-bold" style={{ color: 'var(--accent)' }}>Preparing arena…</div>
          </div>
        }
      >
        <GameInner />
      </Suspense>
    </main>
  );
}
