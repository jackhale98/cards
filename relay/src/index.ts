import { DurableObject } from 'cloudflare:workers';

/**
 * Lamplight connection relay.
 *
 * Every table gets one Durable Object ("room"), found by name from the table code. Devices open a
 * WebSocket to `/room/<name>?peer=<id>`; the room tells each device who else is there and passes
 * small JSON envelopes between them:
 *
 *   device → relay   { "to": "<peer>"?, "d": <game message> }      (no `to` = everyone else)
 *                    { "to": "<peer>",  "s": <WebRTC signal> }
 *   relay → device   { "t": "welcome", "peers": ["<peer>", …] }    (on connect)
 *                    { "t": "join" | "leave", "peer": "<peer>" }
 *                    { "t": "msg", "from": "<peer>", "d" | "s": … }
 *
 * Devices use the signals to set up a direct WebRTC link and stop sending game traffic through
 * here once it's open; the relay only carries the game when a direct link can't be made.
 * Nothing is stored. The room uses WebSocket hibernation, so an idle table costs nothing, and a
 * plain "ping" text frame is answered with "pong" without waking it.
 */

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS?: string;
}

const MAX_PEERS = 24;
const MAX_MESSAGE = 512 * 1024;
const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const PEER_ID = /^[A-Za-z0-9_-]{4,40}$/;
/** Messages a device may send per second before extras are dropped. */
const RATE = 120;

function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return true; // not a browser (curl, tests)
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  return allowed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((rule) => {
      const r = new URL(rule.replace('*.', 'wildcard.'));
      if (r.protocol !== url.protocol) return false;
      return rule.includes('*.') ? url.hostname.endsWith(r.hostname.slice('wildcard'.length)) : url.hostname === r.hostname;
    });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('Lamplight relay\n', { headers: { 'content-type': 'text/plain' } });
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m || !ROOM_NAME.test(m[1])) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!originAllowed(req.headers.get('Origin'), env.ALLOWED_ORIGINS ?? ''))
      return new Response('Origin not allowed', { status: 403 });
    if (!PEER_ID.test(url.searchParams.get('peer') ?? '')) return new Response('Bad peer id', { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  peer: string;
  /** Rate limiting: the current one-second window and messages sent in it. */
  window: number;
  count: number;
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // keep-alives are answered by Cloudflare without waking the room
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private open(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private peerOf(ws: WebSocket): string {
    return (ws.deserializeAttachment() as Attachment).peer;
  }

  /** Peers with at least one open socket, apart from `except`. */
  private peers(except?: WebSocket): string[] {
    return [
      ...new Set(
        this.open()
          .filter((ws) => ws !== except)
          .map((ws) => this.peerOf(ws)),
      ),
    ];
  }

  private broadcast(text: string, except?: WebSocket) {
    for (const ws of this.open()) if (ws !== except) ws.send(text);
  }

  async fetch(req: Request): Promise<Response> {
    const peer = new URL(req.url).searchParams.get('peer')!;
    const [client, server] = Object.values(new WebSocketPair());
    // a device reconnecting (same peer id) replaces its old socket
    const old = this.ctx.getWebSockets(peer);
    if (!old.length && this.peers().length >= MAX_PEERS) return new Response('Table is full', { status: 503 });
    this.ctx.acceptWebSocket(server, [peer]);
    server.serializeAttachment({ peer, window: 0, count: 0 } satisfies Attachment);
    for (const ws of old) ws.close(4000, 'Replaced by a new connection');
    server.send(JSON.stringify({ t: 'welcome', peers: this.peers(server).filter((p) => p !== peer) }));
    if (!old.length) this.broadcast(JSON.stringify({ t: 'join', peer }), server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    const att = ws.deserializeAttachment() as Attachment;
    const now = Math.floor(Date.now() / 1000);
    if (att.window !== now) {
      att.window = now;
      att.count = 0;
    }
    if (++att.count > RATE) return;
    ws.serializeAttachment(att);
    let env: { to?: unknown; d?: unknown; s?: unknown };
    try {
      env = JSON.parse(data);
    } catch {
      return;
    }
    const out: Record<string, unknown> = { t: 'msg', from: att.peer };
    if (env.s !== undefined) out.s = env.s;
    else out.d = env.d;
    const text = JSON.stringify(out);
    if (typeof env.to === 'string') {
      for (const target of this.ctx.getWebSockets(env.to)) if (target.readyState === WebSocket.OPEN) target.send(text);
    } else this.broadcast(text, ws);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.gone(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws, 1011);
  }

  private gone(ws: WebSocket, code: number) {
    const peer = this.peerOf(ws);
    try {
      ws.close(code === 1000 || (code >= 3000 && code < 5000) ? code : 1000, 'Bye');
    } catch {
      /* already closed */
    }
    // only announce a leave if the device has no other (newer) connection
    const still = this.ctx.getWebSockets(peer).some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (!still) this.broadcast(JSON.stringify({ t: 'leave', peer }), ws);
  }
}
