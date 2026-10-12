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
 *                    { "k": "deposit", "key": "<backup key>" }       (host only, see below)
 *                    { "k": "takeover", "host": "<new host key>" }
 *   relay → device   { "t": "welcome", "peers": ["<peer>", …] }    (on connect)
 *                    { "t": "taken" }                               (then closed: see below)
 *                    { "t": "join" | "leave", "peer": "<peer>" }
 *                    { "t": "msg", "from": "<peer>", "d" | "s": … }
 *                    { "t": "takeover", "key": "<backup key>" } | { "t": "takeover", "error": "…" }
 *
 * Devices use the signals to set up a direct WebRTC link and stop sending game traffic through
 * here once it's open; the relay only carries the game when a direct link can't be made.
 * The room uses WebSocket hibernation, so an idle table costs nothing, and a
 * plain "ping" text frame is answered with "pong" without waking it.
 *
 * The host connects with `&host=<secret>`, which claims the table code. Another host (a different
 * secret) on the same code gets `taken` and is closed, so it can pick a new code: the claim holds
 * while its host is connected and for a while after (a refresh, a phone asleep). A room nobody has
 * used for a day forgets its claim.
 *
 * Host handoff: the host sends every player an encrypted backup of the game, and deposits only the
 * key here (so the relay never sees a card, and no player can open a backup while the host is
 * around). Once the host has been gone for TAKEOVER_AFTER_MS, the first device to ask for a
 * takeover gets the key and the host's claim on the code, opens its backup and hosts from there.
 */

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS?: string;
}

const MAX_PEERS = 24;
const MAX_MESSAGE = 512 * 1024;
const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const PEER_ID = /^[A-Za-z0-9_-]{4,40}$/;
const HOST_KEY = /^[A-Za-z0-9_-]{8,64}$/;
/** How long a host's claim on its code outlasts its connection. */
const HOST_GRACE_MS = 30 * 60_000;
/** How long the host must have been gone before another device may take over its table. */
const TAKEOVER_AFTER_MS = 20_000;
/** A host socket that hasn't sent its heartbeat for this long counts as gone (a phone asleep). */
const HOST_SILENT_MS = 40_000;
const BACKUP_KEY = /^[A-Za-z0-9_-]{16,64}$/;
/** An unused room forgets everything after this. */
const FORGET_MS = 24 * 3600_000;
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
    const host = url.searchParams.get('host');
    if (host !== null && !HOST_KEY.test(host)) return new Response('Bad host key', { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  peer: string;
  /** The host's claim key, on the host's socket. */
  host?: string;
  /** Rate limiting: the current one-second window and messages sent in it. */
  window: number;
  count: number;
  /** Hosting: when we last heard the host's heartbeat (its deposit, repeated), and the key it left. */
  alive?: number;
  escrow?: string;
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
    const url = new URL(req.url);
    const peer = url.searchParams.get('peer')!;
    const host = url.searchParams.get('host') ?? undefined;
    const [client, server] = Object.values(new WebSocketPair());
    if (host) {
      // one host per code: a different host is told the code is taken
      const claim = await this.ctx.storage.get<{ key: string; seen: number }>('host');
      const otherHost = this.open().some((ws) => {
        const a = ws.deserializeAttachment() as Attachment;
        return a.host && a.host !== host;
      });
      if (otherHost || (claim && claim.key !== host && Date.now() - claim.seen < HOST_GRACE_MS)) {
        server.accept();
        server.send(JSON.stringify({ t: 'taken' }));
        server.close(4009, 'Table code in use');
        return new Response(null, { status: 101, webSocket: client });
      }
      await this.ctx.storage.put('host', { key: host, seen: Date.now() });
    }
    // a device reconnecting (same peer id) replaces its old socket
    const old = this.ctx.getWebSockets(peer);
    if (!old.length && this.peers().length >= MAX_PEERS) return new Response('Table is full', { status: 503 });
    this.ctx.acceptWebSocket(server, [peer]);
    server.serializeAttachment({ peer, host, window: 0, count: 0 } satisfies Attachment);
    await this.ctx.storage.setAlarm(Date.now() + FORGET_MS);
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
    let env: { to?: unknown; d?: unknown; s?: unknown; k?: unknown; key?: unknown; host?: unknown };
    try {
      env = JSON.parse(data);
    } catch {
      return;
    }
    if (env.k === 'deposit') return this.deposit(ws, att, env.key);
    if (env.k === 'takeover') return this.takeover(ws, env.host);
    const out: Record<string, unknown> = { t: 'msg', from: att.peer };
    if (env.s !== undefined) out.s = env.s;
    else out.d = env.d;
    const text = JSON.stringify(out);
    if (typeof env.to === 'string') {
      for (const target of this.ctx.getWebSockets(env.to)) if (target.readyState === WebSocket.OPEN) target.send(text);
    } else this.broadcast(text, ws);
  }

  /**
   * The host leaves the key to its backups with us, and repeats it every so often as a heartbeat
   * (a phone asleep can leave its socket looking open long after it stopped answering).
   */
  private async deposit(ws: WebSocket, att: Attachment, key: unknown) {
    if (!att.host || typeof key !== 'string' || !BACKUP_KEY.test(key)) return;
    att.alive = Date.now();
    if (att.escrow !== key) {
      const claim = await this.ctx.storage.get<{ key: string; seen: number }>('host');
      if (claim?.key !== att.host) return;
      await this.ctx.storage.put('escrow', key);
      att.escrow = key;
    }
    ws.serializeAttachment(att);
  }

  /** A player asks to take over a table whose host has gone: hand over the key and the code. */
  private async takeover(ws: WebSocket, host: unknown) {
    const reply = (m: { key?: string; error?: string }) => ws.send(JSON.stringify({ t: 'takeover', ...m }));
    if (typeof host !== 'string' || !HOST_KEY.test(host)) return reply({ error: 'bad-request' });
    const hostHere = this.open().some((s) => {
      const a = s.deserializeAttachment() as Attachment;
      return a.host && (a.alive == null || Date.now() - a.alive < HOST_SILENT_MS);
    });
    const claim = await this.ctx.storage.get<{ key: string; seen: number }>('host');
    const key = await this.ctx.storage.get<string>('escrow');
    if (hostHere) return reply({ error: 'host-here' });
    if (!key) return reply({ error: 'no-backup' });
    if (claim && Date.now() - claim.seen < TAKEOVER_AFTER_MS) return reply({ error: 'too-soon' });
    // one takeover per backup key: whoever asks second is told someone beat them to it
    await this.ctx.storage.delete('escrow');
    await this.ctx.storage.put('host', { key: host, seen: Date.now() });
    reply({ key });
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.gone(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws, 1011);
  }

  /** Nobody has connected for a day: forget the host's claim. */
  async alarm() {
    if (this.open().length) await this.ctx.storage.setAlarm(Date.now() + FORGET_MS);
    else await this.ctx.storage.deleteAll();
  }

  private gone(ws: WebSocket, code: number) {
    const peer = this.peerOf(ws);
    // the host's claim runs from when it was last connected
    const host = (ws.deserializeAttachment() as Attachment).host;
    if (host) void this.ctx.storage.put('host', { key: host, seen: Date.now() });
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
