/**
 * Floating developer credit — visible on every page (menu, lobby, game).
 * Sits above all overlays (modals/HUD use z-50) but its wrapper is
 * pointer-events-none, so it can never block game input; only the link
 * itself is clickable. The link opens LinkedIn in a new tab.
 */
export function DevBadge() {
  return (
    <div className="pointer-events-none fixed bottom-2 left-1/2 z-[60] -translate-x-1/2 sm:bottom-3">
      <a
        href="https://www.linkedin.com/in/sahil-dudhal-1b11b925a/"
        target="_blank"
        rel="noopener noreferrer"
        className="dev-badge pointer-events-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold sm:text-xs"
        title="Connect with the developer on LinkedIn"
      >
        <span>Developed by</span>
        <span className="dev-badge-name font-bold">Sahil Dudhal</span>
        <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" fill="currentColor" aria-hidden="true">
          <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
        </svg>
      </a>
    </div>
  );
}
