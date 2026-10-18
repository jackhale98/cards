import { addEntrant, currentRound, isDuplicate, personalView, showable, startProblem, type Round, type TableRound } from '../../engine/events';
import { open } from '../backup';
import type { HostSnapshot } from '../host';
import { isSecret, prove, same, signMove, type SignedMove } from '../eventCrypto';
import { EVENT_PROTOCOL, MAX_COPY, type BoardShow, type EventInMsg, type EventOutMsg } from '../eventProtocol';
import type { Director } from '../director';
import type { EventSeat } from '../host/event';
import { cleanAvatar, makeRoomCode, type Msg } from '../protocol';
import type { Transport } from '../transport';
import type { Registry } from './registry';
import { RemoteTable, type RemoteDesk } from './remote';
import { ALIVE_EVERY_MS, type Escrow } from './standby';

/**
 * The director's desk: its rooms, where phones sign up (and come back to find their table),
 * screens show the event, and the phones hosting tables link up. One room (the event's code) to
 * start with; when it fills, newcomers are sent on to another (the relay seats 24 a room). The
 * desk decides who hosts each table, signs everyone's moves, and gets each move to its player:
 * straight, if they're here; else through the host of the table they're at. A table whose host's
 * phone goes quiet is taken over and hosted here, from the backup its host kept sending.
 */

/** People in one of the director's rooms, at most (the relay seats 24: room for the director, and a screen or two). */
export const ROOM_PEERS = 20;
/** A table whose host hasn't linked up after this long is handed to another of its players. */
export const LINK_WAIT_MS = 60_000;
/** A round's tables stay reachable this long after the next is seated (moves still reaching their players). */
const RETIRE_MS = 120_000;
/** The screens hear of changes at most this often. */
const BOARD_EVERY_MS = 500;
/** Showing the tables live, the screens move on to the next one this often. */
export const LIVE_TURN_MS = 15_000;
/**
 * A table whose host has said nothing for this long (its link says it's still here every 15
 * seconds) is taken over here: about when the relay would let a player take it over.
 */
export const TABLE_QUIET_MS = 45_000;
/** While tables are played on phones, the desk looks for a quiet one this often… */
const QUIET_CHECK_MS = 5000;
/** …and, failing to take one over (its host is still there, as the relay sees it), tries again after this long. */
const ADOPT_AGAIN_MS = 15_000;

type Want = { kind: 'back' } | { kind: 'link'; round: number; table: number };
interface Peer {
  kind: 'new' | 'player' | 'screen' | 'standby' | 'table';
  cid?: string;
  nonce?: string;
  want?: Want;
  table?: RemoteTable;
  /** The last personal view sent (sent again only when it changes). */
  you?: string;
  /** A phone waiting here: the last board sent it (likewise). */
  board?: string;
  /** A phone at a table: it hears where to go next, but not the board. */
  quiet?: boolean;
}
interface Room {
  code: string;
  transport: Transport;
  peers: Map<string, Peer>;
}

export interface DeskSaved {
  rooms: string[];
  /** Each table on a phone: its round, its room and who hosts it (who was asked before). */
  tables: Record<number, { round: number; room: string; hostCid: string; tried: string[] }>;
  show?: BoardShow;
}

export class Desk implements RemoteDesk {
  private rooms = new Map<string, Room>();
  private remotes = new Map<number, RemoteTable>();
  private retired = new Set<RemoteTable>();
  private boardTimer: ReturnType<typeof setTimeout> | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /** What the screens show (the director's choice). */
  show: BoardShow = 'turn';
  /** The table the director asked the screens to show (null: none). */
  pinned: number | null = null;
  /** The table being shown live now: the pinned one, or, showing the tables live, each in turn. */
  featured: number | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly o: {
      code: string;
      registry: Registry;
      director: () => Director;
      /** One of the director's rooms, as its host. */
      open: (code: string) => Transport;
      saved?: DeskSaved;
      /** Something changed at the desk (someone signed up, a table's progress). */
      onChange?: () => void;
      /** A standby's copies: sealed with `key`, which goes to the relay in each room; its link carries `token`. */
      backup?: { key: string; token: string; escrow: Escrow };
      /** A standby has linked up (and wants a copy). */
      onStandby?: () => void;
      /** The relay's escrow, and this director's claim on rooms there (`open` makes them with it): a quiet table is taken over with them. */
      takeover?: { escrow: Escrow; hostKey: string };
    },
  ) {
    this.openRoom(o.code);
    for (const code of o.saved?.rooms ?? []) if (code !== o.code) this.openRoom(code);
    if (o.saved?.show) this.setShow(o.saved.show);
  }

  private get event() {
    return this.o.director().event;
  }

  // ---- rooms ------------------------------------------------------------------------------

  private openRoom(code: string): Room {
    const room: Room = { code, transport: this.o.open(code), peers: new Map() };
    this.rooms.set(code, room);
    if (this.o.backup) this.o.backup.escrow.deposit(code, room.transport, this.o.backup.key, this.o.backup.token);
    room.transport.onPeerJoin = (peer) => {
      room.peers.set(peer, room.peers.get(peer) ?? { kind: 'new' });
      this.send(room, peer, { t: 'evHere' });
    };
    room.transport.onPeerLeave = (peer) => {
      const p = room.peers.get(peer);
      p?.table?.detach();
      room.peers.delete(peer);
      // (a phone gone: the director's screen says so)
      if (p?.kind === 'player' || p?.kind === 'table') this.o.onChange?.();
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

  /**
   * The room of a table hosted here, which people play in: as its host, with the standby's key
   * left in it (a standby taking over hosts the table there).
   */
  tableRoom(code: string): Transport {
    const t = this.o.open(code);
    if (this.o.backup) this.o.backup.escrow.deposit(code, t, this.o.backup.key, this.o.backup.token);
    return t;
  }

  // ---- incoming -----------------------------------------------------------------------------

  private receive(room: Room, peer: string, raw: Msg) {
    if (this.closed) return;
    const msg = raw as EventInMsg;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    const p = room.peers.get(peer) ?? { kind: 'new' as const };
    room.peers.set(peer, p);
    if (p.kind === 'table' && p.table) p.table.heardAt = Date.now();
    const hello = msg.t === 'evJoin' || msg.t === 'evBack' || msg.t === 'evLink' || msg.t === 'evScreen' || msg.t === 'evStandby';
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
        p.quiet = msg.quiet === true;
        return this.challenge(room, peer, p, msg.cid, { kind: 'back' });
      case 'evLink':
        if (typeof msg.cid !== 'string' || !this.o.registry.secretOf(msg.cid) || !Number.isInteger(msg.round) || !Number.isInteger(msg.table)) return;
        return this.challenge(room, peer, p, msg.cid, { kind: 'link', round: msg.round, table: msg.table });
      case 'evProve':
        return this.proved(room, peer, p, msg.mac);
      case 'evScreen':
        p.kind = 'screen';
        return this.sendBoard(room, peer);
      case 'evQuiet':
        if (p.kind !== 'player') return;
        p.quiet = msg.on === true;
        delete p.board;
        if (!p.quiet) this.sendPhoneBoard(room, peer, p, this.phoneBoard());
        return;
      case 'evStandby':
        if (!this.o.backup || typeof msg.token !== 'string' || !same(msg.token, this.o.backup.token))
          return this.send(room, peer, { t: 'evRefused', why: 'That standby link isn’t this tournament’s' });
        p.kind = 'standby';
        this.sendBoard(room, peer);
        if (this.copy) this.send(room, peer, { t: 'evBackup', ...this.copy });
        this.alive();
        this.o.onStandby?.();
        return;
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
      case 'evTableBackup':
        if (p.kind !== 'table' || !p.table || typeof msg.blob !== 'string' || msg.blob.length > MAX_COPY || !Number.isInteger(msg.v)) return;
        if (typeof msg.token !== 'string' || !msg.token || msg.token.length > 128) return;
        p.table.backup = { blob: msg.blob, v: msg.v, token: msg.token };
        return;
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
    // (a hello again before the answer, as a phone says hello on finding us and again until it's
    // in: the same question, so its answer to either one does. A new question would make its
    // answer to the first look wrong)
    const again = p.nonce && p.cid === cid && JSON.stringify(p.want) === JSON.stringify(want);
    p.cid = cid;
    p.want = want;
    if (!again) p.nonce = makeRoomCode() + makeRoomCode() + makeRoomCode();
    this.send(room, peer, { t: 'evChallenge', n: p.nonce! });
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
    if (!t || t.round !== want.round || !t.members.includes(p.cid!)) {
      // (hosted here now, its host's phone having gone quiet: that phone is back at it as a player, as the table itself tells it)
      const here = this.o.director().link(want.table);
      const adopted = here && !(here instanceof RemoteTable) && here.room && here.round === want.round;
      return this.send(room, peer, { t: 'evRefused', why: adopted ? '' : 'That table has moved on' });
    }
    p.kind = 'table';
    p.table = t;
    t.attach(room.transport, peer);
    this.watchTables();
    this.send(room, peer, { t: 'evWelcome', you: personalView(this.event, p.cid!) });
  }

  /** In: where they stand, the board, and their latest move if they've one to make. */
  private welcome(room: Room, peer: string, p: Peer, cid: string) {
    p.kind = 'player';
    p.cid = cid;
    const you = personalView(this.event, cid);
    p.you = JSON.stringify(you);
    this.send(room, peer, { t: 'evWelcome', you });
    this.o.onChange?.();
    delete p.board;
    if (!p.quiet) this.sendPhoneBoard(room, peer, p, this.phoneBoard());
    const move = this.moveFor(cid);
    if (move) this.send(room, peer, { t: 'evMove', move });
  }

  /**
   * Where someone is to be now, signed for them: their table this round (once it's placed), or the
   * event's own room (a bye, knocked out, or the event over). Worked out afresh each time (the
   * signature is the same every time), so the director knows after a reload or a takeover too.
   */
  private moveFor(cid: string): SignedMove | null {
    const secret = this.o.registry.secretOf(cid);
    const r = currentRound(this.event);
    if (!secret || !r) return null;
    // (poker: someone knocked out is still in their table's seats until it's next re-seated)
    const chips = this.event.mtt?.chips;
    const t =
      this.event.phase === 'done'
        ? undefined
        : r.tables.find((x) => x.seats.some((s) => s.member === cid && (!chips || (s.entrant != null && chips[s.entrant] > 0))));
    if (!t) return signMove(secret, { event: this.o.code, round: r.n, table: 0, room: this.o.code, host: false });
    // (on a phone, or hosted here; a table carried on is in the round its game began)
    const link = this.o.director().link(t.table);
    const round = t.carried ?? r.n;
    if (!link?.room || link.round !== round) return null;
    return signMove(secret, { event: this.o.code, round, table: t.table, room: link.room, host: link instanceof RemoteTable && link.hostCid === cid });
  }

  // ---- the event ----------------------------------------------------------------------------

  /** The draw and the first round, from everyone signed up. Null: started; else why not. */
  start(): string | null {
    const e = this.event;
    if (e.phase !== 'registering') return 'Already started';
    const perSide = e.config.sides[0]?.length ?? 1;
    e.entrants = [];
    for (const x of this.o.registry.entrants(perSide, e, e.config.format === 'teams')) addEntrant(e, x);
    const why = startProblem(e);
    if (why || !this.o.director().start()) return why ?? 'At least two to start';
    return null;
  }

  /** A link to a table hosted by one of its players (`saved`: as it was, the director coming back). */
  remote(round: number, t: TableRound): RemoteTable {
    // (back after a reload or a takeover: the round's table where it was; a later round's is placed afresh)
    const saved = this.o.saved?.tables[t.table];
    const r = new RemoteTable(this, round, t.seats, t.table, saved?.round === round ? saved : undefined);
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
    // (a host that never links up: the table goes to another of its players. One that linked up and
    // then dropped is playing there: it's taken over here if it stays quiet, see adopt)
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (t.heardAt < t.placedAt && this.remotes.get(t.table) === t && !this.closed) this.place(t);
    }, LINK_WAIT_MS);
    this.timers.add(timer);
  }

  // ---- a table whose host's phone goes quiet ------------------------------------------------

  private quietTimer: ReturnType<typeof setInterval> | null = null;

  /** While tables are played on phones (and this desk can take one over): look for a quiet one every so often. */
  private watchTables() {
    if (this.quietTimer || this.closed || !this.o.takeover) return;
    this.quietTimer = setInterval(() => this.lookForQuiet(), QUIET_CHECK_MS);
  }

  private lookForQuiet() {
    const r = currentRound(this.event);
    const playing = [...this.remotes.values()].filter((t) => t.round === r?.n && !r.tables.find((x) => x.table === t.table)?.result);
    if (!playing.length || this.closed) {
      clearInterval(this.quietTimer!);
      this.quietTimer = null;
      return;
    }
    const now = Date.now();
    for (const t of playing) if (t.backup && !t.adopting && now >= t.tryAfter && now - Math.max(t.heardAt, t.placedAt) >= TABLE_QUIET_MS) void this.adopt(t);
  }

  /**
   * Take over a table whose host's phone has gone quiet (asleep in a pocket, say, or out of
   * battery), as one of its players could: the relay hands over the key to the latest backup once
   * the host has been gone a while. The table is hosted here from then on, in the same room, so its
   * players' phones find it again by themselves; the host's phone, back, sits at it as a player.
   */
  private async adopt(t: RemoteTable) {
    const how = this.o.takeover;
    const backup = t.backup;
    if (!how || !backup || !t.room) return;
    t.adopting = true;
    try {
      const got = await how.escrow.takeover(t.room, how.hostKey, backup.token);
      if (!got.key) {
        // (a player at the table took it over first, or will: its new host links up with a backup of its own)
        if ((got.error === 'no-backup' || got.error === 'not-a-player') && t.backup === backup) t.backup = null;
        return;
      }
      const snap = await open<HostSnapshot>(backup.blob, got.key);
      if (this.closed || this.remotes.get(t.table) !== t) return;
      this.o.director().hostHere(t.table, snap, t.room);
    } catch (e) {
      console.warn('Couldn’t take the table over', e);
    } finally {
      t.adopting = false;
      t.tryAfter = Date.now() + ADOPT_AGAIN_MS;
    }
  }

  /**
   * Get a move to its player: straight, if they're in one of these rooms; else through the host of
   * their table; else when they ask. A round's moves go together, once every table is seated, and
   * the tables' hosts hear their own last: a host follows its move at once, closing its table, so
   * the moves it passes on to its players must be on their way first.
   */
  private deliver(cid: string, move: SignedMove) {
    if (!this.outbox.length) queueMicrotask(() => this.flush());
    this.outbox.push([cid, move]);
  }
  private outbox: [string, SignedMove][] = [];
  private flush() {
    const moves = this.outbox;
    this.outbox = [];
    const hosts: (() => void)[] = [];
    const forwards = new Map<RemoteTable, { cid: string; move: SignedMove }[]>();
    // (each way it might reach them: straight, on the phone's own link; and, in case that link has
    // gone quiet, through the host of the table they're at, or on the host's own link. A phone
    // takes a move once.)
    for (const [cid, move] of moves) {
      for (const room of this.rooms.values())
        for (const [peer, p] of room.peers) {
          if (p.kind === 'player' && p.cid === cid) this.send(room, peer, { t: 'evMove', move });
          else if (p.kind === 'table' && p.cid === cid) hosts.push(() => this.send(room, peer, { t: 'evMove', move }));
        }
      const at = [...this.retired, ...this.remotes.values()].find((t) => t.link && t.members.includes(cid) && t.hostCid !== cid);
      if (at) forwards.set(at, [...(forwards.get(at) ?? []), { cid, move }]);
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

  /**
   * A round is seated: everyone without a table in it (a bye, knocked out, or the event over: null)
   * goes to the event's own room to wait, with the standings to look at.
   */
  round(r: Round | null) {
    // (the round's tables are new: what the screens show live starts again, but for one carried on)
    if (!r?.tables.some((t) => t.carried && t.table === this.pinned)) this.pinned = null;
    if (!r?.tables.some((t) => t.carried && t.table === this.featured)) this.featured = null;
    this.featureNext();
    const seated = new Set(r?.tables.flatMap((t) => t.seats.map((s) => s.member)) ?? []);
    const n = r?.n ?? currentRound(this.event)?.n ?? 1;
    // (the people at a table hosted here go to its room; a table on a phone sends its own when it's placed)
    for (const t of r?.tables ?? []) {
      const link = this.o.director().link(t.table);
      // (a table carried on: its players are there already)
      if (!link?.room || link instanceof RemoteTable || t.carried) continue;
      for (const s of t.seats) {
        const secret = s.member ? this.o.registry.secretOf(s.member) : undefined;
        if (secret) this.deliver(s.member!, signMove(secret, { event: this.o.code, round: n, table: t.table, room: link.room, host: false }));
      }
    }
    for (const m of this.o.registry.members.values())
      if (!m.bot && !seated.has(m.id)) this.deliver(m.id, signMove(m.secret, { event: this.o.code, round: n, table: 0, room: this.o.code, host: false }));
  }

  /** Multi-table poker: these people are out; to the event's room, to watch the rest of it. */
  out(members: string[]) {
    const n = currentRound(this.event)?.n ?? 1;
    for (const cid of members) {
      const secret = this.o.registry.secretOf(cid);
      if (secret) this.deliver(cid, signMove(secret, { event: this.o.code, round: n, table: 0, room: this.o.code, host: false }));
    }
  }

  /** Show a table live on the screens, whatever else they're showing (null: none). */
  feature(table: number | null) {
    this.pinned = table;
    this.featureNext();
  }

  /** What the screens show: in turn, the tables, the standings, the bracket, or the tables live, one after another. */
  setShow(show: BoardShow) {
    this.show = show;
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
    // (a timer only while the screens turn through the tables)
    if (show === 'live' && !this.closed) this.liveTimer = setInterval(() => this.featureNext(true), LIVE_TURN_MS);
    this.featureNext();
    this.boardSoon();
  }

  /**
   * The table to show live now (`turn`: time to move on to the next one still playing). In
   * duplicate, only a table on a board every other table has played (see showable): the room
   * would see how it goes.
   */
  private featureNext(turn = false) {
    let next = this.pinned != null && showable(this.event, this.pinned) ? this.pinned : null;
    if (next == null && this.show === 'live') {
      const playing = (currentRound(this.event)?.tables ?? []).filter((t) => !t.result && showable(this.event, t.table)).map((t) => t.table);
      const at = this.featured != null ? playing.indexOf(this.featured) : -1;
      next = at >= 0 && !turn ? this.featured : (playing.find((t) => t > (this.featured ?? 0)) ?? playing[0] ?? null);
      if (this.event.phase === 'done' && this.liveTimer) {
        clearInterval(this.liveTimer);
        this.liveTimer = null;
      }
    }
    if (next === this.featured) return;
    if (this.featured != null) this.remotes.get(this.featured)?.feature(false);
    this.featured = next;
    if (next != null) this.remotes.get(next)?.feature(true);
    this.boardSoon();
  }

  /** Something changed at a table hosted here: the screens, if they show it live or its tile changed. */
  viewed(table: number) {
    const tile = JSON.stringify(this.o.director().link(table)?.progress() ?? null);
    if (this.featured === table || tile !== this.lastTiles.get(table)) this.boardSoon();
    this.lastTiles.set(table, tile);
  }
  private lastTiles = new Map<number, string>();

  // ---- out to the screens and phones -------------------------------------------------------

  /** Something changed: the screens (soon), and anyone whose own place changed (now). */
  changed() {
    // (the table shown live may have finished, or a new round begun)
    this.featureNext();
    this.o.onChange?.();
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
      this.o.onChange?.();
      const phones = this.phoneBoard();
      for (const room of this.rooms.values())
        for (const [peer, p] of room.peers) {
          if (p.kind === 'screen' || p.kind === 'standby') this.sendBoard(room, peer);
          // (the phones waiting here: signing up, a bye, knocked out, or the event over)
          else if (p.kind === 'player' && !p.quiet) this.sendPhoneBoard(room, peer, p, phones);
        }
    }, BOARD_EVERY_MS);
  }

  /** What a phone waiting here shows: the event and who's in it (not the tables' progress, nor a table live). */
  private phoneBoard() {
    const msg: EventOutMsg = { t: 'evBoard', board: this.o.director().view, people: this.o.registry.people() };
    return { msg, json: JSON.stringify(msg) };
  }
  /** …sent to a phone when it has changed. */
  private sendPhoneBoard(room: Room, peer: string, p: Peer, b: { msg: EventOutMsg; json: string }) {
    if (p.board === b.json) return;
    p.board = b.json;
    this.send(room, peer, b.msg);
  }

  private sendBoard(room: Room, peer: string) {
    const d = this.o.director();
    const live = this.featured != null && showable(this.event, this.featured) ? (d.link(this.featured)?.view() ?? null) : null;
    this.send(room, peer, {
      t: 'evBoard',
      board: d.view,
      people: this.o.registry.people(),
      tiles: [...this.tiles()].map(([table, t]) => ({ table, tile: t.tile })),
      live: live ? { table: this.featured!, view: live } : null,
      show: this.show,
    });
  }

  // ---- a standby director ------------------------------------------------------------------

  /** The latest copy for the standby (sealed: see standby.ts). */
  private copy: { blob: string; at: number } | null = null;
  private aliveTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether `cid`'s phone is linked to the director now (signing up, waiting, or quietly, at a table). */
  online(cid: string): boolean {
    for (const room of this.rooms.values()) for (const p of room.peers.values()) if (p.kind === 'player' && p.cid === cid) return true;
    return false;
  }

  /** How many standbys are linked up. */
  standbys(): number {
    let n = 0;
    for (const room of this.rooms.values()) for (const p of room.peers.values()) if (p.kind === 'standby') n++;
    return n;
  }

  /** A fresh copy for the standbys (false: too big to send). */
  sendBackup(blob: string): boolean {
    if (blob.length > MAX_COPY) return false;
    this.copy = { blob, at: Date.now() };
    for (const room of this.rooms.values())
      for (const [peer, p] of room.peers) if (p.kind === 'standby') this.send(room, peer, { t: 'evBackup', ...this.copy });
    return true;
  }
  get copiedAt(): number | null {
    return this.copy?.at ?? null;
  }

  /** While a standby is linked: a word every so often, so it can tell the director's still here (a timer only then). */
  private alive() {
    if (this.aliveTimer || this.closed) return;
    this.aliveTimer = setInterval(() => {
      if (!this.standbys()) {
        clearInterval(this.aliveTimer!);
        this.aliveTimer = null;
        return;
      }
      for (const room of this.rooms.values()) for (const [peer, p] of room.peers) if (p.kind === 'standby') this.send(room, peer, { t: 'evAlive' });
    }, ALIVE_EVERY_MS);
  }

  /**
   * The progress of each table this round (for the tiles), wherever it's hosted, and whose phones
   * there aren't linked to the director now (`off`, by name: asleep, closed, or out of reach).
   */
  tiles() {
    const d = this.o.director();
    return new Map(
      (currentRound(this.event)?.tables ?? []).map((t) => {
        const link = d.link(t.table);
        const remote = link instanceof RemoteTable ? link : null;
        const progress = link?.progress() ?? null;
        // (duplicate: no scores on a tile, where a table still to play those boards could see them)
        const tile = progress && isDuplicate(this.event) ? { ...progress, totals: null } : progress;
        const off = t.result
          ? []
          : t.seats.flatMap((s) =>
              s.member && !this.online(s.member) && !(remote?.link && remote.hostCid === s.member) ? [this.o.registry.members.get(s.member)?.name ?? '?'] : [],
            );
        return [t.table, { tile, linked: remote ? !!remote.link : true, room: link?.room ?? null, host: remote?.hostCid ?? null, local: !remote, off }];
      }),
    );
  }

  saved(): DeskSaved {
    return {
      rooms: [...this.rooms.keys()],
      tables: Object.fromEntries(
        [...this.remotes]
          .filter(([, t]) => t.room && t.hostCid)
          .map(([n, t]) => [n, { round: t.round, room: t.room!, hostCid: t.hostCid!, tried: [...t.tried] }]),
      ),
      show: this.show,
    };
  }

  close() {
    this.closed = true;
    if (this.boardTimer) clearTimeout(this.boardTimer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    if (this.quietTimer) clearInterval(this.quietTimer);
    for (const t of this.timers) clearTimeout(t);
    for (const r of this.rooms.values()) r.transport.leave();
  }
}
