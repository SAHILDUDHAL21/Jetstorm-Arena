'use client';

/**
 * Twin-stick touch controls. The left stick moves and climbs (push up to
 * jet), a dedicated button jumps; the right stick aims and auto-fires.
 * Three action buttons handle grenade / melee / reload. All targets ≥44px.
 */
import { useEffect, useRef } from 'react';
import { inputState } from '@/game/input/InputState';
import { loadSettings } from '@/lib/client/settings';

const BASE = 116; // joystick base diameter (px)
const KNOB = 46;  // knob diameter (px) — ≥44px touch target
const RADIUS = (BASE - KNOB) / 2;

/** Stick sensitivity, refreshed whenever the controls mount. */
let SENS = 1;

function Stick({
  label, onVector,
}: { label: string; onVector: (x: number, y: number, active: boolean) => void }) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const pointerId = useRef<number | null>(null);

  const setKnob = (dx: number, dy: number) => {
    const k = knobRef.current;
    if (k) k.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const handle = (e: React.PointerEvent) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const mag = Math.hypot(dx, dy);
    if (mag > RADIUS) {
      dx = (dx / mag) * RADIUS;
      dy = (dy / mag) * RADIUS;
    }
    setKnob(dx, dy);
    onVector(dx / RADIUS, dy / RADIUS, true);
  };

  const release = () => {
    pointerId.current = null;
    setKnob(0, 0);
    onVector(0, 0, false);
  };

  return (
    <div
      ref={baseRef}
      className="relative rounded-full select-none"
      style={{
        width: BASE,
        height: BASE,
        touchAction: 'none',
        background: 'radial-gradient(circle, #2b1d0dcc, #221709bb)',
        border: '1px solid var(--line)',
      }}
      onPointerDown={(e) => {
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        handle(e);
      }}
      onPointerMove={(e) => {
        if (pointerId.current !== e.pointerId) return;
        handle(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div
        ref={knobRef}
        className="absolute rounded-full flex items-center justify-center text-[10px] font-black tracking-wider"
        style={{
          width: KNOB,
          height: KNOB,
          left: (BASE - KNOB) / 2,
          top: (BASE - KNOB) / 2,
          background: 'linear-gradient(180deg,#8a6a2a,#5c4318)',
          border: '1px solid #ffbe5c55',
          color: 'var(--ink-dim)',
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ActionButton({
  label, hint, onPress, color,
}: { label: string; hint: string; onPress: () => void; color?: string }) {
  return (
    <button
      className="flex items-center justify-center rounded-full font-black select-none active:scale-95 transition-transform"
      style={{
        width: 52,
        height: 52,
        fontSize: 18,
        touchAction: 'none',
        background: 'linear-gradient(180deg,#332413cc,#24180899)',
        border: `1px solid ${color ?? 'var(--line)'}`,
        color: color ?? 'var(--ink)',
      }}
      title={hint}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
    >
      {label}
    </button>
  );
}

export function MobileControls() {
  useEffect(() => {
    inputState.desktop = false;
    SENS = loadSettings().aimSensitivity;
    return () => {
      inputState.desktop = true;
      inputState.mx = 0;
      inputState.jump = false;
      inputState.jet = false;
      inputState.fire = false;
      inputState.queueGrenade = 0;
      inputState.queueMelee = 0;
      inputState.queueReload = 0;
    };
  }, []);

  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      {/* left cluster: move stick + jump */}
      <div className="absolute bottom-4 left-4 flex items-end gap-3 pointer-events-auto">
        <Stick
          label="MOVE"
          onVector={(x, y) => {
            inputState.mx = Math.max(-1, Math.min(1, x * SENS));
            inputState.jet = y < -0.55;
          }}
        />
        <button
          className="rounded-full font-black select-none active:scale-95 transition-transform"
          style={{
            width: 58,
            height: 58,
            fontSize: 12,
            touchAction: 'none',
            background: 'linear-gradient(180deg,#2a5a3acc,#1d403099)',
            border: '1px solid #37d67a66',
            color: '#b8ffd0',
          }}
          onPointerDown={(e) => { e.preventDefault(); inputState.jump = true; }}
          onPointerUp={() => { inputState.jump = false; }}
          onPointerCancel={() => { inputState.jump = false; }}
          onPointerLeave={() => { inputState.jump = false; }}
        >
          JUMP
        </button>
      </div>

      {/* right cluster: aim stick + actions */}
      <div className="absolute bottom-4 right-4 flex items-end gap-3 pointer-events-auto">
        <div className="flex flex-col gap-2 mb-1">
          <ActionButton
            label="💣" hint="Grenade (G)" color="#ffd23c66"
            onPress={() => { inputState.queueGrenade++; }}
          />
          <ActionButton
            label="✊" hint="Melee (F)"
            onPress={() => { inputState.queueMelee++; }}
          />
          <ActionButton
            label="⟳" hint="Reload (R)" color="#ffbe5c66"
            onPress={() => { inputState.queueReload++; }}
          />
        </div>
        <Stick
          label="AIM"
          onVector={(x, y, active) => {
            if (active && x * x + y * y > 0.02) {
              inputState.aimX = x;
              inputState.aimY = y;
              inputState.fire = x * x + y * y > 0.16;
            } else {
              inputState.fire = false;
            }
          }}
        />
      </div>
    </div>
  );
}
