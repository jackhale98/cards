import { addEntrant, currentRound, personalView, type TableRound } from '../../engine/events';
import { isSecret, prove, same, signMove, type SignedMove } from '../eventCrypto';
import { EVENT_PROTOCOL, type EventInMsg, type EventOutMsg } from '../eventProtocol';
import type { Director } from '../director';
import type { EventSeat } from '../host/event';
import { cleanAvatar, makeRoomCode, type Msg } from '../protocol';
import type { Transport } from '../transport';
import type { Registry } from './registry';
import { RemoteTable, type RemoteDesk } from './remote';

/**
 * The director's desk: its rooms, where phones sign up (and come back to find their table),
 * screens show the event, and the phones hosting tables link up. One room (the event's code) to
 * start with; when it fills, newcomers are sent on to another (the relay seats 24 a room). The
 * desk decides who hosts each table, signs everyone's moves, and gets each move to its player:
 * straight, if they're here; else through the host of the table they're at.
 */

/** People in one of the director's rooms, at most (the relay seats 24: room for the director, and a screen or two). */
export const ROOM_PEERS = 20;
/** A table whose host hasn't linked up after this long is handed to another of its players. */
export const LINK_WAIT_MS = 60_000;
/** A round's tables stay reachable this long after the next is seated (moves still reaching their players). */
const RETIRE_MS = 120_000;
/** The screens hear of changes at most this often. */
const BOARD_EVERY_MS = 500;

type Want = { kind: 'back' } | { kind: 'link'; round: number; table: number };
interface Peer {
  kind: 'new' | 'player' | 'screen' | 'table';
  cid?: string;
  nonce?: string;
  want?: Want;
  table?: RemoteTable;
  /** The last personal view sent (sent again only when it changes). */
  you?: string;
}
interface Room {
  code: string;
  transport: Transport;
  peers: Map<string, Peer>;
}

export interface DeskSaved {
  rooms: string[];
  tables: Record<number, { room: string; hostCid: string; tried: string[] }>;
}

export class Desk implements RemoteDesk {
  private rooms = new Map<string, Room>();
  private remotes = new Map<number, RemoteTable>();
  private retired = new Set<RemoteTable>();
  /** Each player's latest move (sent again when they come back asking where to go). */
  private latest = new Map<string, SignedMove>();
  private boardTimer: ReturnType<typeof setTimeout> | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private featured: number | null = null;
  private closed = false;

  constructor(
    private readonly o: {
      code: string;
      registry: Registry;
      director: () => Director;
      /** One of the director's rooms, as its host. */
      open: (code: string) => Transport;
      saved?: DeskSaved;
    },
  ) {
    this.openRoom(o.code);
    for (const code of o.saved?.rooms ?? []) if (code !== o.code) this.openRoom(code);
  }

  private get event() {
    return this.o.director().event;
  }

  // ---- rooms ------------------------------------------------------------------------------

  private openRoom(code: string): Room {
    const room: Room = { code, transport: this.o.open(code), peers: new Map() };
    this.rooms.set(code, room);
    room.transport.onPeerJoin = (peer) => {
      room.peers.set(peer, room.peers.get(peer) ?? { kind: 'new' });
      this.send(room, peer, { t: 'evHere' });
    };
    room.transport.onPeerLeave = (peer) => {
      room.peers.get(peer)?.table?.detach();
      room.peers.delete(peer);
    };
    room.transport.onMessage = (raw, from) => this.receive(room, from, raw);
    return room;
  }

  /** A room with space for one more (a new one, when they're all full). */
  private roomWithSpace(): Room {
    for (const r of this.rooms.values()) if (r.peers.size < ROOM_PEERS) return r;
    return this.openRoom(makeRoomCode());
  }

  private send(room: Room, peer: string, msg: EventOutMsg) {
    room.transport.send(msg, peer);
  }

  // ---- incoming -----------------------------------------------------------------------------

  private receive(room: Room, peer: string, raw: Msg) {
    if (this.closed) return;
    const msg = raw as EventInMsg;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    const p = room.peers.get(peer) ?? { kind: 'new' as const };
    room.peers.set(peer, p);
    const hello = msg.t === 'evJoin' || msg.t === 'evBack' || msg.t === 'evLink' || msg.t === 'evScreen';
    if (hello) {
      if (msg.v !== EVENT_PROTOCOL)
        return this.send(room, peer, { t: 'evRefused', why: 'This tournament runs on another version of Lamplight: reload the page', reload: true });
      // (this room is full: on to one with space)
      if (p.kind === 'new' && room.peers.size > ROOM_PEERS) {
        const other = this.roomWithSpace();
        if (other !== room) {
          room.peers.delete(peer);
          return this.send(room, peer, { t: 'evRoom', code: other.code });
        }
      }
    }
    switch (msg.t) {
      case 'evJoin':
        return this.join(room, peer, p, msg);
      case 'evBack':
        if (typeof msg.cid !== 'string' || !this.o.registry.secretOf(msg.cid))
          return this.send(room, peer, { t: 'evRefused', why: 'You’re not signed up for this tournament' });
        return this.challenge(room, peer, p, msg.cid, { kind: 'back' });
      case 'evLink':
        if (typeof msg.cid !== 'string' || !this.o.registry.secretOf(msg.cid) || !Number.isInteger(msg.round) || !Number.isInteger(msg.table)) return;
        return this.challenge(room, peer, p, msg.cid, { kind: 'link', round: msg.round, table: msg.table });
      case 'evProve':
        return this.proved(room, peer, p, msg.mac);
      case 'evScreen':
        p.kind = 'screen';
        return this.sendBoard(room, peer);
      case 'evPartner':
        if (p.kind !== 'player' || !p.cid || this.event.phase !== 'registering') return;
        this.o.registry.setPartner(p.cid, typeof msg.with === 'string' ? msg.with : null);
        return this.changed();
      case 'evNews':
        if (p.kind !== 'table' || !p.table || !Number.isInteger(msg.id) || !msg.news || typeof msg.news !== 'object') return;
        p.table.onNews(msg.news);
        return this.send(room, peer, { t: 'evAck', id: msg.id });
      case 'evTile':
        if (p.kind !== 'table' || !p.table || !msg.tile || typeof msg.tile !== 'object') return;
        p.table.tile = msg.tile;
        return this.boardSoon();
      case 'evView':
        if (p.kind !== 'table' || !p.table?.featured || !msg.view || typeof msg.view !== 'object') return;
        p.table.live = msg.view;
        return this.boardSoon();
    }
  }

  /** Signing up: first time (`new`), again from the same phone (`same`), or refused. */
  private join(room: Room, peer: string, p: Peer, msg: Extract<EventInMsg, { t: 'evJoin' }>) {
    const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 20) : '';
    if (typeof msg.cid !== 'string' || !msg.cid || msg.cid.length > 64 || !name || !isSecret(msg.secret)) return;
    const known = this.o.registry.secretOf(msg.cid);
    if (!known && this.event.phase !== 'registering') return this.send(room, peer, { t: 'evRefused', why: 'This tournament has started' });
    const got = this.o.registry.add({ id: msg.cid, name, avatar: cleanAvatar(msg.avatar), secret: msg.secret });
    if (got === 'taken') return this.send(room, peer, { t: 'evRefused', why: 'You signed up on another phone' });
    this.welcome(room, peer, p, msg.cid);
    this.changed();
  }

  private challenge(room: Room, peer: string, p: Peer, cid: string, want: Want) {
    p.cid = cid;
    p.want = want;
    p.nonce = makeRoomCode() + makeRoomCode() + makeRoomCode();
    this.send(room, peer, { t: 'evChallenge', n: p.nonce });
  }

  private proved(room: Room, peer: string, p: Peer, mac: unknown) {
    const secret = p.cid ? this.o.registry.secretOf(p.cid) : undefined;
    const want = p.want;
    const nonce = p.nonce;
    delete p.nonce;
    delete p.want;
    if (!secret || !want || !nonce || typeof mac !== 'string') return;
    const what = want.kind === 'back' ? ['me'] : ['table', want.round, want.table];
    if (!same(mac, prove(secret, nonce, ...what))) return this.send(room, peer, { t: 'evRefused', why: 'That isn’t the phone that signed up' });
    if (want.kind === 'back') return this.welcome(room, peer, p, p.cid!);
    // a table's host: one of its players, at that table this round (whoever hosts it now: a takeover keeps the link)
    const t = this.remotes.get(want.table);
    if (!t || t.round !== want.round || !t.members.includes(p.cid!)) return this.send(room, peer, { t: 'evRefused', why: 'That table has moved on' });
    p.kind = 'table';
    p.table = t;
    t.attach(room.transport, peer);
    this.send(room, peer, { t: 'evWelcome', you: personalView(this.event, p.cid!) });
  }

  /** In: where they stand, the board, and their latest move if they've one to make. */
  private welcome(room: Room, peer: string, p: Peer, cid: string) {
    p.kind = 'player';
    p.cid = cid;
    const you = personalView(this.event, cid);
    p.you = JSON.stringify(you);
    this.send(room, peer, { t: 'evWelcome', you });
    this.sendBoard(room, peer);
    const move = this.latest.get(cid);
    if (move && move.round === currentRound(this.event)?.n) this.send(room, peer, { t: 'evMove', move });
  }

  // ---- the event ----------------------------------------------------------------------------

  /** The draw and the first round, from everyone signed up. Null: started; else why not. */
  start(): string | null {
    const e = this.event;
    if (e.phase !== 'registering') return 'Already started';
    const perSide = e.config.sides[0]?.length ?? 1;
    e.entrants = [];
    for (const x of this.o.registry.entrants(perSide, e)) addEntrant(e, x);
    if (!this.o.director().start()) return 'At least two to start';
    return null;
  }

  /** A link to a table hosted by one of its players (`saved`: as it was, the director coming back). */
  remote(round: number, t: TableRound): RemoteTable {
    const r = new RemoteTable(this, round, t.seats, t.table, round === currentRound(this.event)?.n ? this.o.saved?.tables[t.table] : undefined);
    // (last round's table of this number stays reachable: moves reach its players through it)
    const last = this.remotes.get(t.table);
    if (last) this.retired.add(last);
    this.remotes.set(t.table, r);
    return r;
  }

  /**
   * Who hosts a table, in a new room, and everyone's move there. The host is one of its players who
   * hasn't been asked before (a phone that never linked up is passed over).
   */
  place(t: RemoteTable) {
    const seating = t.seating;
    if (!seating) return;
    const people = seating.seats.filter((s): s is EventSeat => !!s && 'key' in s).map((s) => s.id);
    const host = people.find((c) => !t.tried.includes(c)) ?? people[0];
    if (!host) return;
    t.tried.push(host);
    t.room = makeRoomCode();
    t.hostCid = host;
    t.placedAt = Date.now();
    t.link = null;
    for (const cid of people) {
      const secret = this.o.registry.secretOf(cid);
      if (secret) this.deliver(cid, signMove(secret, { event: this.o.code, round: t.round, table: t.table, room: t.room, host: cid === host }));
    }
    // (a host that never links up: the table goes to another of its players)
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!t.link && this.remotes.get(t.table) === t && !this.closed) this.place(t);
    }, LINK_WAIT_MS);
    this.timers.add(timer);
  }

  /**
   * Get a move to its player: straight, if they're in one of these rooms; else through the host of
   * their table; else when they ask. A round's moves go together, once every table is seated, and
   * the tables' hosts hear their own last: a host follows its move at once, closing its table, so
   * the moves it passes on to its players must be on their way first.
   */
  private deliver(cid: string, move: SignedMove) {
    this.latest.set(cid, move);
    if (!this.outbox.length) queueMicrotask(() => this.flush());
    this.outbox.push([cid, move]);
  }
  private outbox: [string, SignedMove][] = [];
  private flush() {
    const moves = this.outbox;
    this.outbox = [];
    const hosts: (() => void)[] = [];
    const forwards = new Map<RemoteTable, { cid: string; move: SignedMove }[]>();
    next: for (const [cid, move] of moves) {
      for (const room of this.rooms.values())
        for (const [peer, p] of room.peers) {
          if (p.kind === 'player' && p.cid === cid) {
            this.send(room, peer, { t: 'evMove', move });
            continue next;
          }
          // (a table's host hears its own move on its link)
          if (p.kind === 'table' && p.cid === cid) {
            hosts.push(() => this.send(room, peer, { t: 'evMove', move }));
            continue next;
          }
        }
      for (const t of [...this.retired, ...this.remotes.values()])
        if (t.link && t.members.includes(cid)) {
          forwards.set(t, [...(forwards.get(t) ?? []), { cid, move }]);
          continue next;
        }
    }
    for (const [t, list] of forwards) t.send({ t: 'evForward', moves: list });
    for (const send of hosts) send();
  }

  retire(t: RemoteTable) {
    if (this.remotes.get(t.table) === t) this.remotes.delete(t.table);
    this.retired.add(t);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.retired.delete(t);
    }, RETIRE_MS);
    this.timers.add(timer);
  }

  /** Feature a table live on the screens (null: none). */
  feature(table: number | null) {
    if (this.featured === table) return;
    if (this.featured != null) this.remotes.get(this.featured)?.feature(false);
    this.featured = table;
    if (table != null) this.remotes.get(table)?.feature(true);
    this.boardSoon();
  }

  // ---- out to the screens and phones -------------------------------------------------------

  /** Something changed: the screens (soon), and anyone whose own place changed (now). */
  changed() {
    for (const room of this.rooms.values())
      for (const [peer, p] of room.peers) {
        if (p.kind !== 'player' || !p.cid) continue;
        const you = personalView(this.event, p.cid);
        const json = JSON.stringify(you);
        if (json !== p.you) {
          p.you = json;
          this.send(room, peer, { t: 'evYou', you });
        }
      }
    this.boardSoon();
  }

  private boardSoon() {
    if (this.boardTimer || this.closed) return;
    this.boardTimer = setTimeout(() => {
      this.boardTimer = null;
      for (const room of this.rooms.values())
        for (const [peer, p] of room.peers) if (p.kind === 'screen' || (p.kind === 'player' && this.event.phase === 'registering')) this.sendBoard(room, peer);
    }, BOARD_EVERY_MS);
  }

  private sendBoard(room: Room, peer: string) {
    const d = this.o.director();
    const live = this.featured != null ? (d.link(this.featured)?.view() ?? null) : null;
    this.send(room, peer, { t: 'evBoard', board: d.view, people: this.o.registry.people(), live: live ? { table: this.featured!, view: live } : null });
  }

  /** The progress of each table this round (for the tiles). */
  tiles() {
    return new Map([...this.remotes].map(([n, t]) => [n, { tile: t.tile, linked: !!t.link, room: t.room, host: t.hostCid }]));
  }

  saved(): DeskSaved {
    return {
      rooms: [...this.rooms.keys()],
      tables: Object.fromEntries(
        [...this.remotes].filter(([, t]) => t.room && t.hostCid).map(([n, t]) => [n, { room: t.room!, hostCid: t.hostCid!, tried: [...t.tried] }]),
      ),
    };
  }

  close() {
    this.closed = true;
    if (this.boardTimer) clearTimeout(this.boardTimer);
    for (const t of this.timers) clearTimeout(t);
    for (const r of this.rooms.values()) r.transport.leave();
  }
}
