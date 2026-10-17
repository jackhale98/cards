import type { EventPersonal, EventPublic } from '../engine/events';
import { checkMove, prove, type SignedMove } from './eventCrypto';
import { BOARD_SHOWS, EVENT_PROTOCOL, type BoardShow, type EventOutMsg, type EventPerson, type TableTile } from './eventProtocol';
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
 * before anything follows them. Used while signing up and between tables; at a table the phone
 * is just a player there, and its moves come through the table's host.
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
  onChange: () => void = () => {};
  onMove: (m: SignedMove) => void = () => {};
  private transport!: Transport;
  private director: string | null = null;
  private timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly open: (code: string) => Transport,
    readonly id: EventIdentity,
    /** A screen showing the event, rather than a player. */
    private readonly screen = false,
  ) {
    this.join(id.code);
    // (until the director answers: a lost hello, or the director not here yet)
    this.timer = setInterval(() => {
      if (!this.welcomed && !this.refused) this.hello();
    }, EVENT_HELLO_MS);
  }

  private join(code: string) {
    this.director = null;
    this.welcomed = false;
    this.transport = this.open(code);
    // (our relay vouches for the director; elsewhere it says it's here, and only then do we say who we are)
    this.transport.onPeerJoin = (peer) => {
      if (this.transport.vouch?.(peer)) this.found(peer);
    };
    this.transport.onPeerLeave = (peer) => {
      if (peer === this.director) this.director = null;
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
      ? ({ t: 'evScreen', v: EVENT_PROTOCOL } as const)
      : this.id.joined
        ? ({ t: 'evBack', v: EVENT_PROTOCOL, cid: this.id.cid } as const)
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
    switch (msg.t) {
      case 'evChallenge':
        if (typeof msg.n !== 'string' || msg.n.length > 64) return;
        return this.transport.send({ t: 'evProve', mac: prove(this.id.secret, msg.n, 'me') }, from);
      case 'evWelcome':
        this.welcomed = true;
        this.id.joined = true;
        this.you = msg.you;
        this.refused = null;
        return this.onChange();
      case 'evYou':
        this.you = msg.you;
        return this.onChange();
      case 'evBoard':
        // (a screen is welcomed by the board itself)
        this.welcomed = true;
        this.board = {
          board: msg.board,
          people: Array.isArray(msg.people) ? msg.people : [],
          tiles: Array.isArray(msg.tiles) ? msg.tiles : [],
          live: msg.live ?? null,
          show: BOARD_SHOWS.includes(msg.show!) ? msg.show! : 'turn',
        };
        return this.onChange();
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

  /** Partnership games: who we'd like to partner (null: nobody). */
  partner(cid: string | null) {
    if (this.director) this.transport.send({ t: 'evPartner', with: cid }, this.director);
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.transport.leave();
  }
}
