'use client';

/** How-to-play modal: controls, objective, pickups. */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="panel w-full max-w-2xl p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">How to play</h2>
          <button className="btn px-3 py-1.5" onClick={onClose}>Close</button>
        </div>

        <section className="mb-5">
          <h3 className="panel-title mb-2">Objective</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
            Free-for-all arena combat for up to 4 players. First to <b className="text-cyan-300">10 kills</b> —
            or highest score when the <b className="text-cyan-300">5 minute</b> timer ends — wins. You
            respawn 3 seconds after dying. The server runs the authoritative simulation: every hit,
            kill and pickup is decided by it.
          </p>
        </section>

        <section className="mb-5">
          <h3 className="panel-title mb-2">Controls (desktop)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <Key k="A / D  or  ← →" v="Move" />
            <Key k="Mouse" v="Aim" />
            <Key k="Left click" v="Fire" />
            <Key k="W / ↑ / Space" v="Jump · hold Space to jetpack (uses fuel)" />
            <Key k="R" v="Reload" />
            <Key k="G" v="Throw grenade (2s fuse)" />
            <Key k="F / V" v="Melee swipe" />
            <Key k="Q / E  or  1–6" v="Switch weapons" />
            <Key k="Tab (hold)" v="Scoreboard" />
            <Key k="Enter" v="Chat" />
          </div>
        </section>

        <section className="mb-5">
          <h3 className="panel-title mb-2">Controls (mobile)</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
            Twin-stick: the left stick moves and boosts, the right stick aims and fires.
            Buttons for grenade, melee and reload sit around the right stick.
          </p>
        </section>

        <section>
          <h3 className="panel-title mb-2">Pickups</h3>
          <ul className="text-sm space-y-1" style={{ color: 'var(--ink-dim)' }}>
            <li><span className="text-emerald-300 font-semibold">Health pack</span> — restores 50 HP.</li>
            <li><span className="text-amber-300 font-semibold">Ammo crate</span> — refills reserve ammo for your current weapon.</li>
            <li><span className="text-fuchsia-300 font-semibold">Weapon crate</span> — grants a random weapon: SMG, rifle, shotgun, sniper or rocket launcher.</li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--ink-dim)' }}>
            Everyone starts with a pistol. Crates respawn on a timer — grab them before your rivals do.
          </p>
        </section>
      </div>
    </div>
  );
}

function Key({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="shrink-0 font-mono text-xs px-2 py-0.5 rounded"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--accent)' }}
      >
        {k}
      </span>
      <span style={{ color: 'var(--ink-dim)' }}>{v}</span>
    </div>
  );
}
