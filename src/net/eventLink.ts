import type { EventPersonal, EventPublic } from '../engine/events';
import { checkMove, prove, type SignedMove } from './eventCrypto';
import { BOARD_SHOWS, EVENT_PROTOCOL, MAX_COPY, type BoardBody, type BoardShow, type EventOutMsg, type EventPerson, type TableTile } from './eventProtocol';
import { apply } from './patch';
import { cleanMove } from './director/clean';
import { isValidCode, type Avatar, type Msg, type View } from './protocol';
import type { Transport } from './transport';

/** Hellos go again this often until the director answers. */
export const EVENT_HELLO_MS = 3000;

/** Who this phone is in a tournament: its id, name and look, and its secret (kept on the phone). */
export interface EventIdentity {
  code: string;
  cid: string;
  name: string;
  avatar?: Avatar;
  secret: string;
  /** Signed up already (so it comes back with a challenge rather than signing up again). */
  joined?: boolean;
}

/** Is this move (passed on by a table's host, or straight from the director) really ours, from our director? */
export const isOurMove = (id: EventIdentity, m: unknown): m is SignedMove => {
  const move = cleanMove(m);
  return !!move && move.event === id.code && checkMove(id.secret, move);
};

/**
 * A phone's (or a screen's) connection to a tournament's director: signing up, coming back to find
 * its table, and the event as everyone may see it. Moves are checked with this phone's secret
 * before anything follows them. A phone keeps it all tournament: at a table it goes quiet (no
 * board, just where to go next), so its next move never depends on the table's host.
 */
export class EventLink {
  you: EventPersonal | null = null;
  board: {
    board: EventPublic;
    people: EventPerson[];
    tiles: { table: number; tile: TableTile | null }[];
    live: { table: number; view: View } | null;
    show: BoardShow;
  } | null = null;
  refused: { why: string; reload?: boolean } | null = null;
  /** A standby: the director's latest copy of the tournament (sealed). */
  backup: { blob: string; at: number } | null = null;
  /** When the director was last heard from. */
  heard = Date.now();
  onChange: () => void = () => {};
  onMove: (m: SignedMove) => void = () => {};
  private transport!: Transport;
  private director: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  /** At a table: no board, only moves. */
  private quiet = false;
  /** The board as it came, and its version (the next may be a patch on it). */
  private got: { v: number; body: BoardBody } | null = null;

  constructor(
    private readonly open: (code: string) => Transport,
    readonly id: EventIdentity,
    /** A screen showing the event, rather than a player (`standby`: a standby director, with its link's token). */
    private readonly screen: boolean | { standby: string } = false,
  ) {
    this.join(id.code);
  }

  /** Hello again every so often until the director answers (a lost hello, or the director not here yet): a timer only until then. */
  private retry() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      if (this.welcomed || this.refused || this.closed) {
        clearInterval(this.timer!);
        this.timer = null;
      } else this.hello();
    }, EVENT_HELLO_MS);
  }

  /** At a table (on), or back at the event (off): a quiet link hears only where to go next. */
  setQuiet(on: boolean) {
    if (this.quiet === on) return;
    this.quiet = on;
    if (this.director && this.welcomed && !this.screen) this.transport.send({ t: 'evQuiet', on }, this.director);
  }

  /** The director's room this link is in (the event's own, or another it was sent on to). */
  get room() {
    return this.code;
  }
  private code = '';

  /** This link's own id in the director's room (tests). */
  get selfId() {
    return this.transport.selfId;
  }

  private join(code: string) {
    this.director = null;
    this.welcomed = false;
    this.got = null;
    this.code = code;
    this.transport = this.open(code);
    this.retry();
    // (our relay vouches for the director; elsewhere it says it's here, and only then do we say who we are)
    this.transport.onPeerJoin = (peer) => {
      if (this.transport.vouch?.(peer)) this.found(peer);
    };
    this.transport.onPeerLeave = (peer) => {
      if (peer !== this.director) return;
      // (the director gone: a new one, or the same back, is greeted again when it's here; its boards start afresh)
      this.director = null;
      this.welcomed = false;
      this.got = null;
      this.retry();
    };
    this.transport.onMessage = (raw, from) => this.receive(raw, from);
  }

  /** The director: its room's host (our relay vouches for it), or, where it can't, whoever said it's here. */
  private isDirector(peer: string) {
    return this.transport.vouch?.(peer) ?? this.director === peer;
  }

  private found(peer: string) {
    this.director = peer;
    this.hello();
  }
  private welcomed = false;

  private hello() {
    const peer = this.director;
    if (this.closed || !peer) return;
    const msg = this.screen
      ? typeof this.screen === 'object'
        ? ({ t: 'evStandby', v: EVENT_PROTOCOL, token: this.screen.standby } as const)
        : ({ t: 'evScreen', v: EVENT_PROTOCOL } as const)
      : this.id.joined
        ? ({ t: 'evBack', v: EVENT_PROTOCOL, cid: this.id.cid, ...(this.quiet ? { quiet: true } : {}) } as const)
        : ({ t: 'evJoin', v: EVENT_PROTOCOL, cid: this.id.cid, name: this.id.name, avatar: this.id.avatar, secret: this.id.secret } as const);
    this.transport.send(msg, peer);
  }

  private receive(raw: Msg, from: string) {
    const msg = raw as EventOutMsg;
    if (this.closed || !msg || typeof msg !== 'object') return;
    if (msg.t === 'evHere') {
      if (this.transport.vouch?.(from) !== false && this.director === null) this.found(from);
      return;
    }
    if (!this.isDirector(from)) return;
    this.heard = Date.now();
    switch (msg.t) {
      case 'evChallenge':
        if (typeof msg.n !== 'string' || msg.n.length > 64) return;
        return this.transport.send({ t: 'evProve', mac: prove(this.id.secret, msg.n, 'me') }, from);
      case 'evBackup':
        if (typeof this.screen !== 'object' || typeof msg.blob !== 'string' || msg.blob.length > MAX_COPY || !Number.isFinite(msg.at)) return;
        this.backup = { blob: msg.blob, at: msg.at };
        return this.onChange();
      case 'evAlive':
        return;
      case 'evWelcome':
        this.welcomed = true;
        this.id.joined = true;
        this.you = msg.you;
        this.refused = null;
        return this.onChange();
      case 'evYou':
        this.you = msg.you;
        return this.onChange();
      case 'evBoard': {
        // (a screen is welcomed by the board itself)
        this.welcomed = true;
        const { t: _t, v, ...body } = msg;
        this.got = typeof v === 'number' ? { v, body } : null;
        this.showBoard(body);
        return this.onChange();
      }
      case 'evBoardPatch': {
        // (on the board we have: if it doesn't fit, as after a board lost on the way, the whole one again)
        const next = this.got && msg.base === this.got.v && typeof msg.v === 'number' ? apply(this.got.body, msg.ops) : null;
        if (!next || typeof next !== 'object') {
          this.got = null;
          return this.transport.send({ t: 'evResync' }, from);
        }
        this.got = { v: msg.v, body: next };
        this.showBoard(next);
        return this.onChange();
      }
      case 'evMove':
        if (isOurMove(this.id, msg.move)) this.onMove(cleanMove(msg.move)!);
        return;
      case 'evRefused':
        this.refused = { why: typeof msg.why === 'string' ? msg.why.slice(0, 120) : 'Refused', ...(msg.reload ? { reload: true } : {}) };
        return this.onChange();
      case 'evRoom':
        if (typeof msg.code !== 'string' || !isValidCode(msg.code)) return;
        this.transport.leave();
        return this.join(msg.code);
    }
  }

  private showBoard(b: BoardBody) {
    this.board = {
      board: b.board,
      people: Array.isArray(b.people) ? b.people : [],
      tiles: Array.isArray(b.tiles) ? b.tiles : [],
      live: b.live ?? null,
      show: BOARD_SHOWS.includes(b.show!) ? b.show! : 'turn',
    };
  }

  /** Partnership games: who we'd like to partner (null: nobody). */
  partner(cid: string | null) {
    if (this.director) this.transport.send({ t: 'evPartner', with: cid }, this.director);
  }

  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.transport.leave();
  }
}
