'use client';

/** Settings modal — sliders persist to localStorage and apply live to audio. */
import { useEffect, useState } from 'react';
import { audio } from '@/game/systems/AudioSystem';
import {
  defaultSettings, loadSettings, saveSettings, type GameSettings,
} from '@/lib/client/settings';

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex items-center gap-4 py-2.5">
      <div className="w-40 shrink-0">
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-xs" style={{ color: 'var(--ink-dim)' }}>{hint}</div>}
      </div>
      <div className="flex-1 flex items-center gap-3">{children}</div>
    </label>
  );
}

function Slider({
  value, onChange, disabled,
}: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-cyan-400"
      />
      <span className="w-10 text-right text-sm tabular-nums" style={{ color: 'var(--ink-dim)' }}>
        {Math.round(value * 100)}%
      </span>
    </>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<GameSettings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setS(loadSettings());
    setLoaded(true);
  }, []);

  const apply = (next: GameSettings) => {
    setS(next);
    if (loaded) saveSettings(next);
    audio.setSettings(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Settings</h2>
          <button className="btn btn-ghost px-3 py-1.5" onClick={onClose}>Close</button>
        </div>

        <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
          <Row label="Mute all">
            <input
              type="checkbox"
              checked={s.muted}
              onChange={(e) => apply({ ...s, muted: e.target.checked })}
              className="h-5 w-5 accent-cyan-400"
            />
          </Row>
          <Row label="Master volume">
            <Slider value={s.master} disabled={s.muted} onChange={(v) => apply({ ...s, master: v })} />
          </Row>
          <Row label="Effects">
            <Slider value={s.sfx} disabled={s.muted} onChange={(v) => apply({ ...s, sfx: v })} />
          </Row>
          <Row label="Music">
            <Slider value={s.music} disabled={s.muted} onChange={(v) => apply({ ...s, music: v })} />
          </Row>
          <Row label="Screen shake" hint="Camera kick on explosions & shots">
            <Slider value={s.screenShake} onChange={(v) => apply({ ...s, screenShake: v })} />
          </Row>
          <Row label="Joystick sensitivity" hint="Mobile aim/move response">
            <Slider value={s.aimSensitivity} onChange={(v) => apply({ ...s, aimSensitivity: Math.max(0.5, Math.min(2, v)) })} />
          </Row>
          <Row label="Graphics quality" hint="Particle density">
            <select
              className="field max-w-40"
              value={s.quality}
              onChange={(e) => apply({ ...s, quality: e.target.value as GameSettings['quality'] })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Row>
          <Row label="Show FPS">
            <input
              type="checkbox"
              checked={s.showFps}
              onChange={(e) => apply({ ...s, showFps: e.target.checked })}
              className="h-5 w-5 accent-cyan-400"
            />
          </Row>
        </div>

        <p className="mt-4 text-xs" style={{ color: 'var(--ink-dim)' }}>
          Settings are stored in your browser and apply instantly.
        </p>
      </div>
    </div>
  );
}
