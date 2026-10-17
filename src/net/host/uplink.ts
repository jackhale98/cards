import { prove, type SignedMove } from '../eventCrypto';
import { EVENT_PROTOCOL, type EventInMsg, type EventOutMsg } from '../eventProtocol';
import type { Host } from '../host';
import { cleanEventTable, cleanMove } from '../director/clean';
import { isValidCode, type Msg } from '../protocol';
import type { Transport } from '../transport';
import type { TableNews } from './event';

/** Unacknowledged news goes again this often. */
export const NEWS_AGAIN_MS = 4000;
/** A table's progress goes to the director at most this often. */
export const TILE_EVERY_MS = 2000;
/** While featured, its screen's view at most this often. */
export const VIEW_EVERY_MS = 700;
/** With nothing else to say for this long, it says it's still here (a quiet table's host may be asleep: see Desk.adopt). */
export const UPLINK_ALIVE_MS = 15_000;

/**
 * A tournament table's link to its director, from the phone hosting it: a second connection, to
 * the director's room. It proves which table it hosts (with its player's secret), takes the
 * table's seating, holds and changes, sends its news until each is acknowledged (a result is
 * never lost to a dropped connection), its progress, and its screen's view while featured, and
 * passes the director's signed moves on to the players at the table. The director also holds the
 * table's latest backup (sealed: the relay keeps its key), so that if this phone goes quiet it can
 * host the table itself and the game goes on.
 */
export class Uplink {
  /** Where this phone's own player goes next (signed for them: the app checks it, as any move). */
  onMove: (m: SignedMove) => void = () => {};
  /** The director won't have this link (the table has moved on, say). */
  onRefused: (why: string) => void = () => {};
  private director: string | null = null;
  /** The director has taken the link (after our proof). */
  private linked = false;
  private news: { id: number; news: TableNews }[] = [];
  private nextId = 1;
  private featured = false;
  private timers: ReturnType<typeof setTimeout | typeof setInterval>[] = [];
  private tileDue = 0;
  private viewDue = 0;
  private closed = false;
  /** The director won't have this link: no more asking. */
  private refused = false;
  /** The table's latest backup, for the director (sent when it's made, and again on linking up). */
  private backup: { blob: string; v: number; token: string } | null = null;
  /** When we last said anything to the director. */
  private spoke = 0;

  private transport!: Transport;

  constructor(
    /** One of the director's rooms (its code), joined as a guest. */
    private readonly open: (code: string) => Transport,
    code: string,
    private readonly host: Host,
    private readonly me: { cid: string; secret: string; round: number; table: number },
  ) {
    this.join(code);
    host.onTable = (n) => {
      this.news.push({ id: this.nextId++, news: n });
      this.flush();
    };
    host.onBroadcast = () => this.progress();
    host.backupTo((blob, v, token) => {
      this.backup = { blob, v, token };
      this.sendBackup();
    });
    // (news not yet acknowledged goes again, until it is; the link asked for again, until it's
    // made; and, with nothing else said for a while, a word that we're still here)
    this.timers.push(
      setInterval(() => {
        if (!this.linked && this.director && !this.refused) this.hello(this.director);
        this.flush();
        if (this.linked && this.director && Date.now() - this.spoke >= UPLINK_ALIVE_MS) this.say({ t: 'evAlive' });
      }, NEWS_AGAIN_MS),
    );
    // (a table taken over, or reloaded, after its game ended: the result again, in case it was lost)
    host.resendResult();
  }

  private join(code: string) {
    this.director = null;
    this.linked = false;
    this.transport = this.open(code);
    // (our relay vouches for the director; elsewhere it says it's here)
    this.transport.onPeerJoin = (peer) => {
      if (this.transport.vouch?.(peer)) this.hello(peer);
    };
    this.transport.onPeerLeave = (peer) => {
      if (peer !== this.director) return;
      this.director = null;
      this.linked = false;
    };
    this.transport.onMessage = (raw, from) => this.receive(raw, from);
  }

  /** The director: the room's host (our relay vouches for it), or, on networks that can't, whoever said it's here. */
  private isDirector(peer: string) {
    return this.transport.vouch?.(peer) ?? this.director === peer;
  }

  private hello(peer: string) {
    if (this.closed || this.transport.vouch?.(peer) === false) return;
    this.transport.send({ t: 'evLink', v: EVENT_PROTOCOL, cid: this.me.cid, round: this.me.round, table: this.me.table }, peer);
  }

  private receive(raw: Msg, from: string) {
    const msg = raw as EventOutMsg;
    if (this.closed || !msg || typeof msg !== 'object') return;
    if (msg.t === 'evHere') {
      if (this.transport.vouch?.(from) !== false && this.director === null) {
        this.director = from;
        this.hello(from);
      }
      return;
    }
    if (!this.isDirector(from)) return;
    switch (msg.t) {
      case 'evChallenge':
        if (typeof msg.n !== 'string' || msg.n.length > 64) return;
        this.transport.send({ t: 'evProve', mac: prove(this.me.secret, msg.n, 'table', this.me.round, this.me.table) }, from);
        return;
      case 'evWelcome':
        this.director = from;
        this.linked = true;
        // (its result again, game over: a director taking over may have missed it; a repeat is ignored)
        this.host.resendResult();
        this.flush();
        this.progress(true);
        this.sendBackup();
        return;
      case 'evSeat': {
        const t = cleanEventTable(msg.table);
        if (t && t.info.round === this.me.round && t.info.table === this.me.table) this.host.seatTable(t);
        return;
      }
      case 'evHold':
        return this.host.hold(!!msg.on);
      case 'evAdjust':
        if (msg.change && typeof msg.change === 'object') this.host.adjust(msg.change);
        return;
      case 'evStandIn':
        if (Number.isInteger(msg.seat)) this.host.standInFor(msg.seat);
        return;
      case 'evFeature':
        this.featured = !!msg.on;
        if (this.featured) this.progress(true);
        return;
      case 'evForward':
        if (!Array.isArray(msg.moves)) return;
        for (const x of msg.moves.slice(0, 32)) {
          const move = cleanMove(x?.move);
          if (move && typeof x.cid === 'string') this.host.tell(x.cid, { t: 'move', code: move.room, ...(move.host ? { host: true } : {}), ev: move });
        }
        return;
      case 'evAck':
        this.news = this.news.filter((n) => n.id !== msg.id);
        return;
      case 'evMove': {
        const move = cleanMove(msg.move);
        if (move) this.onMove(move);
        return;
      }
      case 'evRefused':
        this.refused = true;
        return this.onRefused(typeof msg.why === 'string' ? msg.why.slice(0, 120) : '');
      case 'evRoom':
        // (the director's first room is full: its link goes to another)
        if (typeof msg.code !== 'string' || !isValidCode(msg.code)) return;
        this.transport.leave();
        return this.join(msg.code);
    }
  }

  private say(msg: EventInMsg) {
    if (!this.director) return;
    this.spoke = Date.now();
    this.transport.send(msg, this.director);
  }

  /** Send the news the director hasn't acknowledged yet. */
  private flush() {
    if (!this.director || !this.linked) return;
    for (const n of this.news) this.say({ t: 'evNews', id: n.id, news: n.news });
  }

  private sendBackup() {
    if (this.backup && this.linked) this.say({ t: 'evTableBackup', ...this.backup });
  }

  /** The table's progress (and, featured, its screen's view): at most every so often. */
  private progress(now = false) {
    if (!this.director || this.closed) return;
    const t = Date.now();
    if (now || t >= this.tileDue) {
      const tile = this.host.tile();
      if (tile) this.say({ t: 'evTile', tile });
      this.tileDue = t + TILE_EVERY_MS;
    } else this.later(this.tileDue - t);
    if (this.featured && (now || t >= this.viewDue)) {
      this.say({ t: 'evView', view: this.host.viewFor(null) });
      this.viewDue = t + VIEW_EVERY_MS;
    } else if (this.featured) this.later(this.viewDue - t);
  }
  private pending: ReturnType<typeof setTimeout> | null = null;
  private later(ms: number) {
    if (this.pending) return;
    this.pending = setTimeout(
      () => {
        this.pending = null;
        this.progress();
      },
      Math.max(50, ms),
    );
  }

  close() {
    this.closed = true;
    this.host.backupTo(null);
    for (const t of this.timers) clearInterval(t);
    if (this.pending) clearTimeout(this.pending);
    this.transport.leave();
  }
}
