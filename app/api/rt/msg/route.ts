/**
 * Realtime channel (short-poll). One request does both directions:
 *   request:  { sid, msgs?: ClientMsg[], final?: boolean }
 *   response: { out: ServerMsg[] }
 *
 * Uplink messages are validated and rate-limited server-side; the downlink is
 * the session's buffered output, drained on every poll. Requests return
 * immediately (nothing is held open), so the platform keeps serving them from
 * the same warm instance where the session — and its room — lives.
 *
 * 503 when the session is unknown to this instance AND no shared store is
 * configured: the client backs off, keeps the batch, and retries.
 */
import type { NextRequest } from 'next/server';
import { getHub } from '../../../../server/networking/hub';
import type { ServerMsg } from '../../../../shared/types';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('bad body', { status: 400 });
  }
  const { sid, msg, msgs, final } = (body ?? {}) as {
    sid?: unknown;
    msg?: unknown;
    msgs?: unknown;
    final?: unknown;
  };
  if (typeof sid !== 'string' || sid.length < 3 || sid.length > 64 || !/^[\w-]+$/.test(sid)) {
    return new Response('bad sid', { status: 400 });
  }
  const hub = getHub();
  const list: unknown[] = Array.isArray(msgs) ? msgs : msg !== undefined ? [msg] : [];
  if (list.length > 24) {
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
  if (final === true) {
    hub.detachSession(sid);
    return Response.json({ out: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // Attach on first poll; every poll refreshes liveness and drains the buffer.
  const out = await hub.pollSession(sid, 24);
  if (out === null) {
    return new Response('no session — retry', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
    });
  }
  return Response.json({ out } as { out: ServerMsg[] }, { headers: { 'Cache-Control': 'no-store' } });
}
