/**
 * Realtime downlink (SSE). One long-lived stream per player session.
 * The authoritative room simulation runs server-side exactly as with the
 * WebSocket transport; this endpoint streams room state + snapshots to the
 * browser and never trusts client input (see /api/rt/msg).
 *
 * Node runtime; `maxDuration` keeps the stream alive as long as the hosting
 * plan allows. EventSource auto-reconnects; players reclaim their slot with
 * the stored session token (disconnect grace is 30 s).
 */
import type { NextRequest } from 'next/server';
import { getHub } from '../../../../server/networking/hub';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const sid = request.nextUrl.searchParams.get('sid');
  if (!sid || sid.length < 3 || sid.length > 64 || !/^[\w-]+$/.test(sid)) {
    return new Response('bad sid', { status: 400 });
  }
  const hub = getHub();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

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
    },
    cancel() {
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
