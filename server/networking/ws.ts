/**
 * WebSocket transport for the authoritative game server (self-hosted).
 * The same RoomManager powers both this transport and the SSE transport.
 */
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMsg } from '../../shared/types';
import { RoomManager, type ManagedConn } from '../rooms/manager';

export function attachWebSocketServer(httpServer: HttpServer, mgr: RoomManager): WebSocketServer {
  // noServer: upgrade routing is owned by handleUpgrade() below — attaching
  // the HTTP server directly here would register a second upgrade listener.
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const conn: ManagedConn = mgr.makeConn({
      id: mgr.nextConnId(),
      send: (msg: ServerMsg) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(msg));
          } catch {
            /* racing close */
          }
        }
      },
      close: () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
      roomId: null,
      playerId: null,
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(String(data));
        mgr.handleMessage(conn, parsed);
      } catch {
        conn.send({ t: 'error', code: 'bad_message', msg: 'Malformed message.' });
      }
    });

    ws.on('close', () => mgr.onConnClosed(conn));
    ws.on('error', () => mgr.onConnClosed(conn));
  });

  // heartbeat: terminate dead sockets after 45s of silence
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ext = client as WebSocket & { __alive?: boolean };
      if (ext.__alive === false) {
        ext.terminate();
        continue;
      }
      ext.__alive = false;
      ext.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));
  wss.on('connection', (ws: WebSocket) => {
    (ws as WebSocket & { __alive?: boolean }).__alive = true;
    ws.on('pong', () => {
      (ws as WebSocket & { __alive?: boolean }).__alive = true;
    });
  });

  return wss;
}

export function handleUpgrade(httpServer: HttpServer, wss: WebSocketServer): void {
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });
}
