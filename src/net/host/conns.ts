import type { ClientMsg, HostMsg, View } from '../protocol';
import { diff } from '../patch';
import { DEAD_AFTER_MS, FRAMES_PER_SECOND, HEARTBEAT_MS, HELLO_GAP_MS, IDENTITIES_PER_MINUTE, PING_AFTER_MS, RTT_EVERY_MS } from './limits';
import { pingsMoved, VERSION_PATHS } from './wire';

type Hello = Extract<ClientMsg, { t: 'hello' }>;

/**
 * The host's connections: who each one is, whether it's still there (and how quick), and what it
 * was last sent. A person can reach the host over several networks at once (the relay, and the
 * backup networks after it dropped): their views go on one of them, and patches only on the one
 * their last whole view came on. Everything here is about connections, never the game.
 */
export class Conns {
  /**
   * transport peer id → client id. Table screens are `screen:<cid>` and people the host won't seat
   * under the id they asked for (no key, or the wrong one) watch as `watch:<peer>`, so neither can
   * act for a seat.
   */
  readonly peers = new Map<string, string>();
  /** The connections that are table screens. */
  readonly displays = new Set<string>();
  /** peer → last round-trip time and when we last heard from it */
  private health = new Map<string, { rtt: number | null; seen: number }>();
  /** The connection each person's views go on (see route). */
  private routes = new Map<string, string>();
  /** The last view each connection was sent, and when each last asked for a whole one. */
  private sentViews = new Map<string, View>();
  private syncedAt = new Map<string, number>();
  /** When each connection was last sent anything, last pinged, and the latency lights it was last told. */
  private sentAt = new Map<string, number>();
  private pingedAt = new Map<string, number>();
  private toldPings = new Map<string, (number | null)[]>();
  /** The latency lights the host's own screen was last told. */
  private sentPings: (number | null)[] = [];
  private lastBeat = Date.now();
  /** Hello pacing (see pace). */
  private helloPace = new Map<string, { last: number; pending: Hello | null; timer: ReturnType<typeof setTimeout> | null; ids: number[] }>();
  /** Replay frames and files asked for, a few a second per connection at most. */
  private framesAsked = new Map<string, { second: number; n: number }>();

  constructor(private readonly send: (msg: HostMsg, peer: string) => void) {}

  /** Heard from `peer` (any message: it's there). */
  heard(peer: string) {
    const h = this.health.get(peer);
    if (h) h.seen = Date.now();
  }

  /** Its answer to a ping: the round trip. */
  pong(peer: string, ts: unknown) {
    const h = this.health.get(peer);
    if (h && typeof ts === 'number') h.rtt = Math.max(0, Math.round(performance.now() - ts));
  }

  /** Start watching `peer`'s health (keeping its round trip if it had one). */
  watch(peer: string) {
    this.health.set(peer, { rtt: this.health.get(peer)?.rtt ?? null, seen: Date.now() });
  }

  /** A hello asks for the table afresh: the next view to `peer` goes whole. */
  afresh(peer: string) {
    this.sentViews.delete(peer);
  }

  /**
   * Hellos, rate-limited per connection: every hello re-sends the whole table, so a connection
   * saying hello over and over (a bug, or on purpose) could swamp the host. One is handled at
   * once; any more within HELLO_GAP_MS wait, and only the latest of them is handled. A connection
   * hopping between client ids is cut off after a few.
   */
  pace(peer: string, msg: Hello, greet: (msg: Hello) => void) {
    const now = Date.now();
    let p = this.helloPace.get(peer);
    if (!p) this.helloPace.set(peer, (p = { last: 0, pending: null, timer: null, ids: [] }));
    const prev = this.peers.get(peer);
    if (prev !== undefined && prev !== msg.cid && prev !== `screen:${msg.cid}` && !prev.startsWith('watch:')) {
      p.ids = p.ids.filter((t) => now - t < 60_000);
      if (p.ids.length >= IDENTITIES_PER_MINUTE) return;
      p.ids.push(now);
    }
    if (now - p.last >= HELLO_GAP_MS && !p.timer) {
      p.last = now;
      return greet(msg);
    }
    p.pending = msg;
    p.timer ??= setTimeout(
      () => {
        const q = this.helloPace.get(peer);
        if (!q) return;
        q.timer = null;
        const latest = q.pending;
        q.pending = null;
        q.last = Date.now();
        if (latest) greet(latest);
      },
      HELLO_GAP_MS - (now - p.last),
    );
  }

  /** A replay frame or a file asked for: within the rate (a few a second per connection)? */
  mayAsk(peer: string): boolean {
    const second = Math.floor(Date.now() / 1000);
    const c = this.framesAsked.get(peer);
    if (c?.second === second && ++c.n > FRAMES_PER_SECOND) return false;
    if (c?.second !== second) this.framesAsked.set(peer, { second, n: 1 });
    return true;
  }

  /** A connection has gone for good: drop its pacing (and any hello still waiting) and what it was sent. */
  forget(peer: string) {
    this.framesAsked.delete(peer);
    this.sentViews.delete(peer);
    this.syncedAt.delete(peer);
    const p = this.helloPace.get(peer);
    if (p?.timer) clearTimeout(p.timer);
    this.helloPace.delete(peer);
  }

  /** Every connection we've paced (to forget them all on closing). */
  get known() {
    return [...this.helloPace.keys()];
  }

  /** A connection has left: it's no one now. Returns who it was. */
  drop(peer: string): string | undefined {
    const cid = this.peers.get(peer);
    this.peers.delete(peer);
    this.health.delete(peer);
    this.displays.delete(peer);
    this.sentAt.delete(peer);
    this.pingedAt.delete(peer);
    this.toldPings.delete(peer);
    if (cid !== undefined && !this.reaches(cid)) this.routes.delete(cid);
    return cid;
  }

  /** Some connection is `cid`. */
  reaches(cid: string): boolean {
    return [...this.peers.values()].includes(cid);
  }

  /** Best round-trip time for each seat over any of its connections (host itself = 0). */
  pings(seats: { id: string; host?: boolean; bot?: boolean }[]): (number | null)[] {
    return seats.map((seat) => {
      if (seat.host) return 0;
      if (seat.bot) return null;
      let best: number | null = null;
      for (const [peer, cid] of this.peers) {
        const rtt = cid === seat.id ? this.health.get(peer)?.rtt : null;
        if (rtt != null && (best == null || rtt < best)) best = rtt;
      }
      return best;
    });
  }

  /**
   * The heartbeat: ping whoever has been quiet; a peer we haven't heard from in a while has gone
   * (`gone`: faster than WebRTC notices). `exact`: the lobby, where the numbers show, so a round
   * trip moving by 25 ms is news; at the table only a light changing colour is. `onPings`: the
   * host's own screen, told of every change.
   */
  beat(seats: { id: string; host?: boolean; bot?: boolean }[], exact: boolean, gone: (peer: string) => void, onPings: (pings: (number | null)[]) => void) {
    const now = Date.now();
    // our own page was asleep (a phone locked, a tab in the background): nobody could be heard
    // meanwhile, so everyone gets a fresh chance to answer rather than all being dropped at once
    if (now - this.lastBeat > HEARTBEAT_MS * 3) for (const h of this.health.values()) h.seen = Math.max(h.seen, now);
    this.lastBeat = now;
    const pings = this.pings(seats);
    for (const [peer, h] of this.health) {
      if (now - h.seen > DEAD_AFTER_MS) {
        gone(peer);
        continue;
      }
      // someone who has been talking (moves, answers) and been sent something lately needs no ping
      const sent = this.sentAt.get(peer) ?? 0;
      const pinged = this.pingedAt.get(peer) ?? 0;
      if (h.rtt != null && now - h.seen < PING_AFTER_MS && now - sent < PING_AFTER_MS && now - pinged < RTT_EVERY_MS) continue;
      // the latency lights ride along when they've changed for this connection
      const told = this.toldPings.get(peer);
      const fresh = !told || pingsMoved(told, pings, exact);
      if (fresh) this.toldPings.set(peer, pings);
      this.pingedAt.set(peer, now);
      this.sentAt.set(peer, now);
      this.send({ t: 'ping', ts: performance.now(), ...(fresh ? { pings } : {}) }, peer);
    }
    // (the host's own screen hears of every change: that costs nothing)
    const now2 = this.pings(seats);
    if (pingsMoved(this.sentPings, now2, true)) {
      this.sentPings = now2;
      onPings(now2);
    }
  }

  /**
   * The connection a person's views go on, when several networks reach them (as after the relay
   * dropped and the backup networks opened): the one in use while it answers, else the one heard
   * from last. Everything twice would be twice the data. A new one starts with a whole view: the
   * player takes patches only from the connection their last whole view came on.
   */
  route(cid: string): string | undefined {
    const now = Date.now();
    const seen = (p: string) => this.health.get(p)?.seen ?? 0;
    const conns = [...this.peers].filter(([, c]) => c === cid).map(([p]) => p);
    const cur = this.routes.get(cid);
    if (cur && conns.includes(cur) && now - seen(cur) < PING_AFTER_MS + HEARTBEAT_MS * 2) return cur;
    const best = conns.reduce<string | undefined>((a, p) => (!a || seen(p) > seen(a) ? p : a), undefined);
    if (best && best !== cur) this.sentViews.delete(best);
    if (best) this.routes.set(cid, best);
    else this.routes.delete(cid);
    return best;
  }

  /**
   * A view to one connection: only what changed since the last one it had, when that's smaller (a
   * move changes a few dozen bytes of a view of several kilobytes, which matters to players on a
   * phone's data); otherwise the whole view. False when nothing they can see has changed.
   * (`view` is a copy, as sent: a view shares the lobby and game with the host, which change in
   * place, and the next patch is worked out against it. `size`: its length as JSON.)
   */
  sendView(peer: string, view: View, size = JSON.stringify(view).length): boolean {
    const prev = this.sentViews.get(peer);
    if (prev && prev.hid === view.hid && view.v > prev.v) {
      // (the version number is the patch's own `v`: the player sets it, it isn't sent twice more)
      const ops = diff(prev, view).filter((op) => !(op[0] === 's' && VERSION_PATHS.has(op[1].join('.')) && op[2] === view.v));
      // nothing they can see has changed (a phone saying hello again, someone else's move that's
      // hidden from them): send nothing (the next patch still fits what they have)
      if (!ops.length) return false;
      this.sentViews.set(peer, view);
      this.sentAt.set(peer, Date.now());
      if (JSON.stringify(ops).length < size * 0.6) {
        this.send({ t: 'patch', hid: view.hid, base: prev.v, v: view.v, ops }, peer);
        return true;
      }
    }
    this.sentViews.set(peer, view);
    this.sentAt.set(peer, Date.now());
    this.send({ t: 'view', view }, peer);
    return true;
  }

  /**
   * A player's patch didn't fit: they're due the whole view again (once a second at most, per
   * connection), and listening on this one, so their views go here from now on. Who they are, or
   * undefined when it's too soon.
   */
  resync(peer: string): string | undefined {
    const cid = this.peers.get(peer);
    const last = this.syncedAt.get(peer) ?? 0;
    if (cid === undefined || Date.now() - last < 1000) return undefined;
    this.routes.set(cid, peer);
    this.syncedAt.set(peer, Date.now());
    this.sentViews.delete(peer);
    return cid;
  }
}
