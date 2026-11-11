/** Client settings persisted in localStorage. */
export interface GameSettings {
  master: number; // 0..1
  sfx: number; // 0..1
  music: number; // 0..1
  muted: boolean;
  quality: 'low' | 'medium' | 'high';
  screenShake: number; // 0..1
  aimSensitivity: number; // 0.5..2 (mobile joystick)
  showFps: boolean;
}

const KEY = 'jsa:settings';

export const defaultSettings: GameSettings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  muted: false,
  quality: 'high',
  screenShake: 1,
  aimSensitivity: 1,
  showFps: false,
};

export function loadSettings(): GameSettings {
  if (typeof window === 'undefined') return { ...defaultSettings };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
