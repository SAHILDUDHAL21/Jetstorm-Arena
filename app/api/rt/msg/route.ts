/**
 * Realtime uplink. Batches of validated client messages (inputs, actions).
 * Every message passes server-side validation and per-session rate limits;
 * the client can never write game state directly.
 *
 * 503 when the session is unknown to this instance AND no shared store is
 * configured: the SSE stream registered it on another serverless instance,
 * so retrying until a request lands there is the only option.
 */
import type { NextRequest } from 'next/server';
import { getHub } from '../../../../server/networking/hub';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('bad body', { status: 400 });
  }
  const { sid, msg, msgs } = (body ?? {}) as { sid?: unknown; msg?: unknown; msgs?: unknown };
  if (typeof sid !== 'string' || sid.length < 3 || sid.length > 64 || !/^[\w-]+$/.test(sid)) {
    return new Response('bad sid', { status: 400 });
  }
  const hub = getHub();
  const list: unknown[] = Array.isArray(msgs) ? msgs : msg !== undefined ? [msg] : [];
  if (list.length === 0 || list.length > 24) {
    return new Response('bad batch', { status: 400 });
  }
  for (const m of list) {
    const handled = await hub.handleUplink(sid, m);
    if (!handled) {
      return new Response('no session — retry', {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
      });
    }
  }
  return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
}
