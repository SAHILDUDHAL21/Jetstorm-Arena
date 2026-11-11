/**
 * Custom Next.js + WebSocket game server (local development & self-hosting).
 *
 *   npm run dev    → next dev + authoritative game server on /ws
 *   npm run start  → production build + game server
 *
 * On Vercel, the SSE transport (app/api/rt/*) is used instead and this file
 * is not involved. Both share the identical RoomManager simulation.
 */
import http from 'http';
import path from 'path';
import nextFactory from 'next';
import { RoomManager } from './rooms/manager';
import { attachWebSocketServer } from './networking/ws';

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);

async function main() {
  const app = nextFactory({ dev: isDev, dir: path.resolve(__dirname, isDev ? '../..' : '../..') });
  await app.prepare();

  const mgr = new RoomManager();
  const nextUpgrade = app.getUpgradeHandler();
  const httpServer: http.Server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: mgr.rooms.size }));
      return;
    }
    const handle = app.getRequestHandler();
    handle(req, res);
  });

  // Game WebSocket owns the /ws path; every other upgrade (e.g. Next dev HMR
  // at /_next/hmr) is forwarded to Next's own upgrade handler so the dev
  // overlay and hot reload keep working when the game server hosts Next.
  const wss = attachWebSocketServer(httpServer, mgr);
  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      nextUpgrade(req, socket, head);
    }
  });

  // 30 Hz authoritative tick
  const tick = setInterval(() => mgr.tick(), 1000 / 30);
  tick.unref?.();

  httpServer.listen(port, () => {
    console.log(`> Jetstorm Arena listening on http://localhost:${port}`);
    console.log(`> Game WebSocket endpoint: ws://localhost:${port}/ws (${isDev ? 'dev' : 'production'})`);
  });

  const shutdown = () => {
    clearInterval(tick);
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
