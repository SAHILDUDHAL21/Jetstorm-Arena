/**
 * Validation of every inbound client message. The server never trusts the
 * browser: names, codes, chat, input frames and rates are all checked here.
 */
import * as C from '../../shared/constants';
import { isWeaponId } from '../../shared/weapons';
import { MAP_IDS } from '../../shared/maps';
import type { MapId } from '../../shared/maps';
import { INPUT_GRENADE, INPUT_MELEE, INPUT_RELOAD } from '../../shared/types';
import type { ClientMsg, ErrorCode, InputFrame } from '../../shared/types';

export function sanitizeText(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  // strip control characters; collapse whitespace
  const cleaned = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > maxLen) return null;
  return cleaned;
}

export function validateName(v: unknown): string | null {
  const name = sanitizeText(v, 16);
  if (!name) return null;
  if (name.length < 1 || name.length > 16) return null;
  return name;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function validateCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;
  return code;
}

const MAX_FRAMES_PER_MSG = 8; // client sends at 30Hz batching ≤ 3 frames

export function validateInputFrames(v: unknown): InputFrame[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FRAMES_PER_MSG) return null;
  const out: InputFrame[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) return null;
    const f = raw as Record<string, unknown>;
    const seq = f.seq;
    const mx = f.mx;
    const ax = f.ax;
    const ay = f.ay;
    const fl = f.fl;
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0 || seq > 4e12) return null;
    if (mx !== -1 && mx !== 0 && mx !== 1) return null;
    if (typeof ax !== 'number' || !Number.isFinite(ax) || Math.abs(ax) > 1000) return null;
    if (typeof ay !== 'number' || !Number.isFinite(ay) || Math.abs(ay) > 1000) return null;
    if (typeof fl !== 'number' || !Number.isFinite(fl) || fl < 0 || fl > 63) return null;
    // mask to valid bits only
    const valid = INPUT_GRENADE | INPUT_MELEE | INPUT_RELOAD | 63;
    out.push({ seq, fl: fl & valid, mx, ax, ay });
  }
  return out;
}

export interface ParseResult {
  ok: boolean;
  msg?: ClientMsg;
  error?: ErrorCode;
}

/** Parse + validate a raw client payload. Returns a normalized message. */
export function parseClientMsg(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'bad_message' };
  const m = raw as Record<string, unknown>;
  const t = m.t;
  switch (t) {
    case 'hello':
    case 'create':
    case 'quick': {
      const name = validateName(m.name);
      if (!name) return { ok: false, error: 'bad_name' };
      const token = typeof m.token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(m.token) ? m.token : undefined;
      // Optional host map choice (create only); unknown values fall back to random.
      const mapId = (m as { mapId?: unknown }).mapId;
      const validMap = t === 'create' && typeof mapId === 'string' && (MAP_IDS as readonly string[]).includes(mapId)
        ? (mapId as MapId)
        : undefined;
      return { ok: true, msg: { t, name, token, ...(validMap ? { mapId: validMap } : {}) } as ClientMsg };
    }
    case 'join': {
      const name = validateName(m.name);
      const code = validateCode(m.code);
      if (!name) return { ok: false, error: 'bad_name' };
      if (!code) return { ok: false, error: 'bad_code' };
      const token = typeof m.token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(m.token) ? m.token : undefined;
      return { ok: true, msg: { t: 'join', code, name, token } };
    }
    case 'leave':
      return { ok: true, msg: { t: 'leave' } };
    case 'ready': {
      if (typeof m.ready !== 'boolean') return { ok: false, error: 'bad_message' };
      return { ok: true, msg: { t: 'ready', ready: m.ready } };
    }
    case 'start':
    case 'rematch':
    case 'lobby':
      return { ok: true, msg: { t } };
    case 'input': {
      const frames = validateInputFrames(m.frames);
      if (!frames) return { ok: false, error: 'bad_message' };
      return { ok: true, msg: { t: 'input', frames } };
    }
    case 'switch': {
      if (!isWeaponId(m.w)) return { ok: false, error: 'bad_message' };
      return { ok: true, msg: { t: 'switch', w: m.w } };
    }
    case 'chat': {
      const text = sanitizeText(m.text, 120);
      if (!text) return { ok: false, error: 'bad_message' };
      return { ok: true, msg: { t: 'chat', text } };
    }
    case 'ping': {
      if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return { ok: false, error: 'bad_message' };
      return { ok: true, msg: { t: 'ping', ts: m.ts } };
    }
    default:
      return { ok: false, error: 'bad_message' };
  }
}

export function errorText(code: ErrorCode): string {
  switch (code) {
    case 'bad_name': return 'Invalid player name (1–16 characters).';
    case 'bad_code': return 'Invalid room code.';
    case 'room_not_found': return 'Room not found.';
    case 'room_full': return 'Room full.';
    case 'match_started': return 'Match already started.';
    case 'bad_token': return 'Session expired. Please rejoin.';
    case 'rate_limited': return 'Too many messages — slow down.';
    case 'bad_message': return 'Malformed message.';
    case 'not_host': return 'Only the host can do that.';
    case 'already_in_room': return 'Already in a room.';
    default: return 'Server unavailable.';
  }
}

export const LIMITS = {
  maxPlayers: C.MAX_PLAYERS,
  chatMaxLen: 120,
};
