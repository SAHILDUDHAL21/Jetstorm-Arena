'use client';

/** In-match chat overlay. Opens on Enter (desktop) or the HUD chat button. */
import { useEffect, useRef, useState } from 'react';
import { getNet } from '@/lib/client/net';
import { inputState } from '@/game/input/InputState';
import { useBus } from './useBus';

export function ChatOverlay() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useBus('ui', (u) => {
    if (u.action === 'chat-open') setOpen(true);
  });

  useEffect(() => {
    if (open) {
      inputState.chatOpen = true;
      inputRef.current?.focus();
    } else {
      inputState.chatOpen = false;
    }
    return () => {
      inputState.chatOpen = false;
    };
  }, [open]);

  const close = () => {
    setDraft('');
    setOpen(false);
  };

  const send = () => {
    const text = draft.trim().slice(0, 120);
    if (text) getNet().chat(text);
    close();
  };

  if (!open) return null;
  return (
    <div className="absolute inset-x-0 bottom-24 z-40 flex justify-center px-4">
      <div className="panel w-full max-w-md px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wider font-bold mb-1.5" style={{ color: 'var(--ink-dim)' }}>
          Match chat — Enter to send, Esc to cancel
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="field py-2"
            maxLength={120}
            placeholder="Message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
              else if (e.key === 'Escape') close();
              e.stopPropagation();
            }}
          />
          <button className="btn px-3 py-2" onClick={send} disabled={!draft.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}
