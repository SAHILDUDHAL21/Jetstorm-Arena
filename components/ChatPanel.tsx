'use client';

/** Chat panel used in the lobby and the in-game overlay. */
import { useEffect, useRef, useState } from 'react';
import { addNetListener, getNet } from '@/lib/client/net';

export interface ChatLine {
  id: number;
  from: string;
  text: string;
  sys?: boolean;
}

let lineId = 1;

export function ChatPanel({ compact = false }: { compact?: boolean }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const off = addNetListener({
      onChat: (from, text, sys) => {
        setLines((prev) => [...prev.slice(-60), { id: lineId++, from, text, sys }]);
      },
      onNotice: (text) => {
        setLines((prev) => [...prev.slice(-60), { id: lineId++, from: '', text, sys: true }]);
      },
    });
    return off;
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const send = () => {
    const text = draft.trim().slice(0, 120);
    if (!text) return;
    setDraft('');
    getNet().chat(text);
  };

  return (
    <div className="flex flex-col min-h-0">
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto space-y-1 pr-1 ${compact ? 'max-h-28' : 'h-44'}`}
      >
        {lines.length === 0 && (
          <p className="text-xs italic" style={{ color: 'var(--ink-dim)' }}>
            No messages yet.
          </p>
        )}
        {lines.map((l) => (
          <div key={l.id} className="text-sm leading-snug break-words">
            {l.sys ? (
              <span className="italic" style={{ color: 'var(--ink-dim)' }}>{l.text}</span>
            ) : (
              <>
                <b style={{ color: 'var(--accent)' }}>{l.from}</b>
                <span className="mx-1" style={{ color: 'var(--ink-dim)' }}>›</span>
                <span>{l.text}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="field py-2"
          placeholder="Say something…"
          maxLength={120}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button className="btn px-3 py-2" onClick={send} disabled={!draft.trim()}>Send</button>
      </div>
    </div>
  );
}
