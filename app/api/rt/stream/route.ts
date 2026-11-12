/**
 * Realtime downlink (SSE). One long-lived stream per player session.
 * The authoritative room simulation runs server-side exactly as with the
 * WebSocket transport; this endpoint streams room state + snapshots to the
 * browser and never trusts client input (see /api/rt/msg).
 *
 * Node runtime; `maxDuration` is the hosting plan's hard ceiling — Vercel
 * kills functions that exceed it ("Task timed out after …"). To keep that
 * from ever happening, the stream rotates itself shortly before the limit:
 * it closes cleanly, EventSource reconnects via the `retry` hint, and the
 * player reclaims the slot with the stored session token (disconnect grace
 * is 30 s, reconnect takes well under a second).
 */
import type { NextRequest } from 'next/server';
import { getHub } from '../../../../server/networking/hub';

export const maxDuration = 300;

/** Close cleanly before maxDuration so the platform never kills the task. */
const ROTATE_MS = 270_000;

export async function GET(request: NextRequest) {
  const sid = request.nextUrl.searchParams.get('sid');
  if (!sid || sid.length < 3 || sid.length > 64 || !/^[\w-]+$/.test(sid)) {
    return new Response('bad sid', { status: 400 });
  }
  const hub = getHub();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let rotate: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };
      // SSE headers + reconnect hint + initial ping
      write('retry: 500\n\n');
      write(': ok\n\n');
      hub.attachStream(sid, write, () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      heartbeat = setInterval(() => {
        try {
          if (!hub.isSessionLive(sid)) {
            if (heartbeat) clearInterval(heartbeat);
            try {
              controller.close();
            } catch {
              /* noop */
            }
            return;
          }
          write(`: ka ${Date.now()}\n\n`);
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 15000);
      // Scheduled rotation. controller.close() does not fire cancel(), so the
      // session survives and its membership is carried to the next stream.
      rotate = setTimeout(() => {
        try {
          controller.close();
        } catch {
          /* noop */
        }
      }, ROTATE_MS);
    },
    cancel() {
      if (rotate) clearTimeout(rotate);
      if (heartbeat) clearInterval(heartbeat);
      hub.detachStream(sid);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
