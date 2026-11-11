/** Player name + last room code, persisted in localStorage. */

const NAME_KEY = 'jsa:name';
const ROOM_KEY = 'jsa:room';

export function getUserName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveUserName(name: string): void {
  try {
    if (name) window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

/** Suggested display name (stable per browser) for the placeholder. */
export function suggestedName(): string {
  if (typeof window === 'undefined') return 'Player';
  try {
    let v = window.localStorage.getItem('jsa:suggest');
    if (!v) {
      v = `Recruit${Math.floor(100 + Math.random() * 900)}`;
      window.localStorage.setItem('jsa:suggest', v);
    }
    return v;
  } catch {
    return 'Recruit';
  }
}

export function getLastRoomCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

export function setLastRoomCode(code: string | null): void {
  try {
    if (code) window.localStorage.setItem(ROOM_KEY, code);
    else window.localStorage.removeItem(ROOM_KEY);
  } catch {
    /* storage unavailable */
  }
}
