import { DurableObject } from 'cloudflare:workers';

/**
 * Lamplight connection relay.
 *
 * Every table gets one Durable Object ("room"), found by name from the table code. Devices open a
 * WebSocket to `/room/<name>?peer=<id>&secret=<secret>`; the room tells each device who else is
 * there and passes small JSON envelopes between them:
 *
 *   device → relay   { "to": "<peer>"?, "d": <game message> }      (no `to` = everyone else)
 *                    { "to": "<peer>",  "s": <WebRTC signal> }
 *                    { "k": "deposit", "key": "<backup key>", "gate": "<sha-256 of the takeover token>"? }
 *                                                                   (host only, see below)
 *                    { "k": "takeover", "host": "<new host key>", "token": "<takeover token>"? }
 *   relay → device   { "t": "welcome", "v": 2, "peers": ["<peer>", …], "host": "<peer>"? }   (on connect)
 *                    { "t": "taken" }                               (then closed: see below)
 *                    { "t": "join" | "leave", "peer": "<peer>" }
 *                    { "t": "msg", "from": "<peer>", "h": 1?, "d" | "s": … }
 *                    { "t": "takeover", "key": "<backup key>" } | { "t": "takeover", "error": "…" }
 *
 * Who's who can't be faked: a peer id belongs to the socket that first used it with its secret (a
 * reconnect must bring the same secret to replace it), `from` is filled in here, and `h: 1` marks
 * messages from the host's socket, so devices know which peer really is the host.
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
 * Only players can: the host also leaves a hash of a token it gives the players with their
 * backups, and a takeover must bring the token.
 */

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  REPORTS: DurableObjectNamespace<Reports>;
  ALLOWED_ORIGINS?: string;
  /** Secret: opens the error summary at /reports?key=… (unset: the page is off). */
  REPORTS_KEY?: string;
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
const SECRET = /^[A-Za-z0-9_-]{8,64}$/;
const GATE = /^[0-9a-f]{64}$/;
/** An unused room forgets everything after this. */
const FORGET_MS = 24 * 3600_000;
/** Messages a device may send per second before extras are dropped. */
const RATE = 120;
/** Bytes a device may send per second before extras are dropped (a few full views of a big game). */
const BYTE_RATE = 1024 * 1024;

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

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
    if (url.pathname === '/report') return receiveReport(req, env);
    if (url.pathname === '/reports') return showReports(url, env);
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m || !ROOM_NAME.test(m[1])) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!originAllowed(req.headers.get('Origin'), env.ALLOWED_ORIGINS ?? '')) return new Response('Origin not allowed', { status: 403 });
    if (!PEER_ID.test(url.searchParams.get('peer') ?? '')) return new Response('Bad peer id', { status: 400 });
    const secret = url.searchParams.get('secret');
    if (secret !== null && !SECRET.test(secret)) return new Response('Bad secret', { status: 400 });
    const host = url.searchParams.get('host');
    if (host !== null && !HOST_KEY.test(host)) return new Response('Bad host key', { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  peer: string;
  /** Proves a reconnect is the same device (only it can replace this socket). */
  secret?: string;
  /** The host's claim key, on the host's socket. */
  host?: string;
  /** Rate limiting: the current one-second window and messages sent in it. */
  window: number;
  count: number;
  bytes?: number;
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
    const secret = url.searchParams.get('secret') ?? undefined;
    // a peer id is taken: only the device that holds it (its secret) may reconnect under it
    const old = this.ctx.getWebSockets(peer);
    if (old.some((ws) => (ws.deserializeAttachment() as Attachment).secret !== secret)) return new Response('Peer id in use', { status: 409 });
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
    // a device reconnecting (same peer id and secret) replaces its old socket
    if (!old.length && this.peers().length >= MAX_PEERS) return new Response('Table is full', { status: 503 });
    this.ctx.acceptWebSocket(server, [peer]);
    server.serializeAttachment({ peer, secret, host, window: 0, count: 0 } satisfies Attachment);
    await this.ctx.storage.setAlarm(Date.now() + FORGET_MS);
    for (const ws of old) ws.close(4000, 'Replaced by a new connection');
    const hostPeer = this.open().find((ws) => ws !== server && (ws.deserializeAttachment() as Attachment).host);
    server.send(
      JSON.stringify({
        t: 'welcome',
        // (protocol version: 2 adds peer secrets, host marks and takeover tokens)
        v: 2,
        peers: this.peers(server).filter((p) => p !== peer),
        ...(hostPeer ? { host: this.peerOf(hostPeer) } : {}),
      }),
    );
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
      att.bytes = 0;
    }
    att.bytes = (att.bytes ?? 0) + data.length;
    if (++att.count > RATE || att.bytes > BYTE_RATE) return ws.serializeAttachment(att);
    ws.serializeAttachment(att);
    let env: { to?: unknown; d?: unknown; s?: unknown; k?: unknown; key?: unknown; host?: unknown; gate?: unknown; token?: unknown };
    try {
      env = JSON.parse(data);
    } catch {
      return;
    }
    if (env.k === 'deposit') return this.deposit(ws, att, env.key, env.gate);
    if (env.k === 'takeover') return this.takeover(ws, env.host, env.token);
    const out: Record<string, unknown> = { t: 'msg', from: att.peer };
    if (att.host) out.h = 1;
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
  private async deposit(ws: WebSocket, att: Attachment, key: unknown, gate: unknown) {
    if (!att.host || typeof key !== 'string' || !BACKUP_KEY.test(key)) return;
    att.alive = Date.now();
    if (att.escrow !== key) {
      const claim = await this.ctx.storage.get<{ key: string; seen: number }>('host');
      if (claim?.key !== att.host) return;
      await this.ctx.storage.put('escrow', key);
      if (typeof gate === 'string' && GATE.test(gate)) await this.ctx.storage.put('gate', gate);
      else await this.ctx.storage.delete('gate');
      att.escrow = key;
    }
    ws.serializeAttachment(att);
  }

  /** A player asks to take over a table whose host has gone: hand over the key and the code. */
  private async takeover(ws: WebSocket, host: unknown, token: unknown) {
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
    // only a player at the table (who was given the token with their backups) may take over
    const gate = await this.ctx.storage.get<string>('gate');
    if (gate && (typeof token !== 'string' || token.length > 128 || (await sha256(token)) !== gate)) return reply({ error: 'not-a-player' });
    // one takeover per backup key: whoever asks second is told someone beat them to it
    await this.ctx.storage.delete('escrow');
    await this.ctx.storage.delete('gate');
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

// ---- anonymous error reports ------------------------------------------------------------------

/**
 * The app sends a short report when something breaks in a browser, or the host's rules engine hits
 * an error it shouldn't: the message, where in the code, the game and phase, the browser and the
 * app version. Never cards, names or table codes. Reports are kept in one small SQLite-backed
 * object, the same error counted rather than stored again; /reports?key=<REPORTS_KEY> lists them.
 */
export interface ErrorReport {
  kind: string;
  msg: string;
  stack: string;
  game: string;
  phase: string;
  action: string;
  ua: string;
  v: string;
}

const clip = (x: unknown, n: number) => (typeof x === 'string' ? x : '').slice(0, n);

/** Reports per address per minute (kept per Worker instance: a speed bump, not a wall). */
const REPORTS_PER_MINUTE = 20;
const reportCounts = new Map<string, { minute: number; n: number }>();
function tooMany(req: Request): boolean {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const minute = Math.floor(Date.now() / 60_000);
  const c = reportCounts.get(ip);
  if (!c || c.minute !== minute) {
    if (reportCounts.size > 10_000) reportCounts.clear();
    reportCounts.set(ip, { minute, n: 1 });
    return false;
  }
  return ++c.n > REPORTS_PER_MINUTE;
}

/** Compare secrets without leaking how much of them matched through timing. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function receiveReport(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin');
  const cors = {
    'access-control-allow-origin': origin && originAllowed(origin, env.ALLOWED_ORIGINS ?? '') ? origin : 'null',
    'access-control-allow-methods': 'POST',
    'access-control-allow-headers': 'content-type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('POST a report', { status: 405, headers: cors });
  if (!originAllowed(origin, env.ALLOWED_ORIGINS ?? '')) return new Response('Origin not allowed', { status: 403, headers: cors });
  if (tooMany(req)) return new Response('Slow down', { status: 429, headers: cors });
  const text = await req.text();
  if (text.length > 8192) return new Response('Too long', { status: 413, headers: cors });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response('Not JSON', { status: 400, headers: cors });
  }
  const r: ErrorReport = {
    kind: clip(body.kind, 20),
    msg: clip(body.msg, 300),
    stack: clip(body.stack, 1500),
    game: clip(body.game, 40),
    phase: clip(body.phase, 40),
    action: clip(body.action, 40),
    ua: clip(body.ua, 200),
    v: clip(body.v, 20),
  };
  if (!r.msg) return new Response('No message', { status: 400, headers: cors });
  await env.REPORTS.get(env.REPORTS.idFromName('all')).add(r);
  return new Response(null, { status: 204, headers: cors });
}

async function showReports(url: URL, env: Env): Promise<Response> {
  const key = url.searchParams.get('key') ?? '';
  if (!env.REPORTS_KEY || !sameSecret(key, env.REPORTS_KEY)) return new Response('Not found', { status: 404 });
  const rows = await env.REPORTS.get(env.REPORTS.idFromName('all')).list();
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Lamplight errors</title>
<style>body{font:14px system-ui;margin:16px;background:#0f1a16;color:#eee}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #345;padding:6px;vertical-align:top;text-align:left}pre{white-space:pre-wrap;margin:4px 0 0;color:#9ab;font-size:12px}
.n{font-weight:700;color:#e9c46a}</style>
<h1>Lamplight errors</h1><p>${rows.length} distinct, newest first. Counts are reports received (each browser sends at most a few).</p>
<table><tr><th>#</th><th>Last seen</th><th>What</th><th>Where</th></tr>
${rows
  .map(
    (r) => `<tr><td class="n">${r.count}</td><td>${when(r.last)}<br><small>first ${when(r.first)}</small></td>
<td><b>${esc(r.kind)}</b>: ${esc(r.msg)}<pre>${esc(r.stack)}</pre></td>
<td>${esc(r.game)} ${esc(r.phase)} ${esc(r.action)}<br><small>${esc(r.ua)}<br>v ${esc(r.v)}</small></td></tr>`,
  )
  .join('')}
</table>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** All error reports, in one SQLite-backed object: one row per distinct error, with a count. */
export class Reports extends DurableObject<Env> {
  /** At most this many distinct errors are kept (the least recently seen go first). */
  static readonly KEEP = 500;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS errors (
      sig TEXT PRIMARY KEY, kind TEXT, msg TEXT, stack TEXT, game TEXT, phase TEXT, action TEXT,
      ua TEXT, v TEXT, count INTEGER, first INTEGER, last INTEGER)`);
  }

  add(r: ErrorReport) {
    // the same error: same message and first line of the stack, in the same game
    const sig = [r.kind, r.msg, r.stack.split('\n')[0] ?? '', r.game].join('|');
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO errors (sig, kind, msg, stack, game, phase, action, ua, v, count, first, last)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(sig) DO UPDATE SET count = count + 1, last = excluded.last, phase = excluded.phase,
         action = excluded.action, ua = excluded.ua, v = excluded.v, stack = excluded.stack`,
      sig,
      r.kind,
      r.msg,
      r.stack,
      r.game,
      r.phase,
      r.action,
      r.ua,
      r.v,
      now,
      now,
    );
    this.ctx.storage.sql.exec(`DELETE FROM errors WHERE sig NOT IN (SELECT sig FROM errors ORDER BY last DESC LIMIT ${Reports.KEEP})`);
  }

  list() {
    return this.ctx.storage.sql
      .exec<{
        kind: string;
        msg: string;
        stack: string;
        game: string;
        phase: string;
        action: string;
        ua: string;
        v: string;
        count: number;
        first: number;
        last: number;
      }>('SELECT kind, msg, stack, game, phase, action, ua, v, count, first, last FROM errors ORDER BY last DESC LIMIT 200')
      .toArray();
  }
}
