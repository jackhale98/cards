import { botView } from '../engine/botView';
import { isHidden, redact, redactActions, resolveAction } from '../engine/redact';
import { randomSeed } from '../engine/rng';
import { steadily } from '../engine/bots/search';
import { RuleError, type Action, type Board, type GameModule, type GameState, type OtherResult, type TableChange } from '../engine/types';
import { cleanOthers } from './director/clean';
import { checkAction } from '../engine/validate';
import { getGame, GAMES, loadRules, rulesFor, startProblem } from '../games';
import { type Brain } from './brain';
import { fallbackMoves } from '../engine/fallback';

import {
  cleanAvatar,
  makeRoomCode,
  type Avatar,
  type ClientMsg,
  type Frame,
  type HostMsg,
  type Lobby,
  type LobbyEvent,
  type LobbySeat,
  type Msg,
  type Night,
  type View,
  REACTIONS,
} from './protocol';

import { Hands, noteScores, tally } from './host/history';
import { Bots } from './host/bots';
import { Backups } from './host/backups';
import { Conns } from './host/conns';
import type { ExportFormat } from './exports/formats';
import { wire } from './host/wire';
import { standardFormats } from './host/records';
import { addBot, carriedGame, defaultOptions, dropBot, fitSeats, lobbyCommand, mergeNight, seatsIn } from './host/lobby';
export { SCORE_HANDS, totalsOf } from './host/records';
export { defaultOptions } from './host/lobby';
import { report } from './reports';
import type { Transport } from './transport';

export {
  HEARTBEAT_MS,
  PING_AFTER_MS,
  DEAD_AFTER_MS,
  TAKE_BACK_MS,
  SCREEN_SOUND,
  STAND_IN,
  BACKUP_EVERY_MS,
  BACKUP_SOON_MS,
  BACKUP_HOLDERS,
  HELLO_GAP_MS,
  IDENTITIES_PER_MINUTE,
  REPLAY_HANDS,
  REPLAY_STEPS,
  REPLAY_TOTAL,
  TABLE_MAX,
} from './host/limits';
import { END_PHASES, EVENT_REPLAY_TOTAL, HEARTBEAT_MS, TAKE_BACK_MS, SCREEN_SOUND, STAND_IN, TABLE_MAX, UNDO } from './host/limits';
/** The solver failing (DDS not loading, say): asked again after this long. */
const PAR_AGAIN_MS = 30_000;
import { EVENT_GRACE_MS, eventSeats, tableResult, type EventTable, type HostEvent, type TableNews } from './host/event';
import { boardsKey, twinSeats, twinTable, type TwinSaved } from './host/twin';
import type { Solver } from './solver';
import type { TableTile } from './eventProtocol';

export interface HostSnapshot {
  lobby: Lobby;
  state: GameState | null;
  /** Each seat's key, by client id (see `hello`): kept with the game, never sent to players. */
  keys?: Record<string, string>;
  /** A tournament table's place in its event (see host/event.ts). */
  event?: HostEvent;
  /** Duplicate in a room: the other table playing the same boards (see host/twin.ts). */
  twin?: TwinSaved;
  /** Duplicate compared with the solver: each board's par, worked out (see solver.ts). */
  par?: OtherResult[];
}

/**
 * The authoritative game host. Runs on one device (the one that created the room), validates
 * every action and sends each device its own redacted view.
 */
export class Host {
  lobby: Lobby;
  state: GameState | null = null;
  private module: GameModule | null = null;
  /** The bots and automatic steps (see host/bots.ts). */
  private readonly bots: Bots;
  /** Development and tests: every game dealt from this seed, and nothing moving by itself (see opts). */
  private readonly seed?: number;
  private readonly still: boolean;
  private readonly twinOpts: { open?: (code: string) => Transport; brain?: () => Brain };
  /** Duplicate in a room: the other table, playing the same boards (see host/twin.ts); its boards' mark. */
  private twin: (Omit<TwinSaved, 'snap'> & { host: Host; key: string; snap: HostSnapshot | null }) | null = null;
  private syncing = false;
  /** Duplicate compared with the solver: what works out par, and each board's (once it has; null: on its way). */
  private readonly solver: Solver | null;
  private pars: { key: string; results: OtherResult[] | null; at: number } | null = null;
  private history: GameState[] = [];
  /** The connections: who each is, its health, what it was last sent (see host/conns.ts). */
  private readonly conns = new Conns((msg, peer) => this.transport?.send(msg, peer));
  private get peers() {
    return this.conns.peers;
  }
  private get displays() {
    return this.conns.displays;
  }
  /**
   * The secret holding each seat, by client id. Client ids are public (they're in every view), so
   * a seat goes back to a connection only when it brings that seat's key (sent only to the host).
   */
  private keys: Record<string, string>;
  /** Identifies this host instance in views (see View.hid). */
  private readonly hid = Math.random().toString(36).slice(2, 10);
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Round-trip times by seat, for the local UI. */
  onPings: (pings: (number | null)[]) => void = () => {};
  private v = 0;
  onLocalView: (v: View) => void = () => {};
  onLocalError: (msg: string) => void = () => {};
  /** Called after every change with a serialisable snapshot (for resume-after-refresh). */
  onPersist: (snap: HostSnapshot) => void = () => {};
  /** Host handoff: sealed backups held by two players (see host/backups.ts). */
  private readonly backups: Backups;
  private closed = false;
  /** A table in a tournament: its director decides who sits where and when it moves on (see host/event.ts). */
  private event: HostEvent | null = null;
  /** After every change has gone out (a tournament table's link to its director sends its progress). */
  onBroadcast: () => void = () => {};
  /** News of a tournament table for its director: each hand, the game's end, a hold reached. */
  onTable: (news: TableNews) => void = () => {};
  /** A tournament table waits this long for everyone, then deals with bots for whoever isn't here. */
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** The phase at the last commit (a hand has just ended when it changes into an end phase). */
  #lastPhase: string | null = null;

  constructor(
    private transport: Transport | null,
    code: string,
    host: { cid: string; name: string; avatar?: Avatar; key?: string },
    restore?: HostSnapshot,
    /** `takeover`: this device is a player (or a tournament's director) taking over from a host that has gone. */
    /** `brain`: where bots think (by default right here; the app gives a background worker). */
    opts: {
      backupKey?: string;
      takeoverToken?: string;
      takeover?: boolean;
      night?: Night;
      parent?: string;
      brain?: Brain;
      /** A split-off table starts on the game (and settings) the table it came from was on. */
      game?: { id: string; options: Record<string, number | boolean> };
      /**
       * Development builds and tests only: deal every game from this seed (the same cards each
       * time), and `still`, nothing moves by itself (no bots, no tricks collected), so a table can
       * be put on screen exactly, to look at or compare.
       */
      seed?: number;
      still?: boolean;
      /** Duplicate in a room: the other table's room, hosted here (its people play there), and where its bots think (see host/twin.ts). */
      twin?: { open?: (code: string) => Transport; brain?: () => Brain };
      /** Duplicate compared with the solver: works out each board's par (see solver.ts). */
      par?: Solver;
    } = {},
  ) {
    this.seed = opts.seed;
    this.still = !!opts.still;
    this.twinOpts = opts.twin ?? {};
    this.solver = opts.par ?? null;
    // (the bots and the backups see the table as it is when they look: getters onto this host)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.bots = new Bots(
      {
        get state() {
          return self.state;
        },
        get module() {
          return self.module;
        },
        get closed() {
          return self.closed;
        },
        grace: (s) => (this.takeBack?.after === s ? TAKE_BACK_MS : 0),
        apply: (seat, a) => this.applyAs(seat, a),
        system: (sys, module) => this.runSystem(sys, module),
        paused: (s) => this.held(s),
      },
      opts.brain,
      !!opts.still,
    );
    this.backups = new Backups({
      get transport() {
        return self.transport;
      },
      get state() {
        return self.state;
      },
      get lobby() {
        return self.lobby;
      },
      get keys() {
        return self.keys;
      },
      get event() {
        return self.event;
      },
      get v() {
        return self.v;
      },
      get peers() {
        return self.peers;
      },
      get displays() {
        return self.displays;
      },
      get snap() {
        return self.snapshot();
      },
    });
    this.backups.configure(opts.backupKey, opts.takeoverToken);
    this.keys = { ...(restore?.keys ?? {}) };
    if (host.key) this.keys[host.cid] = host.key;
    if (restore) {
      this.lobby = restore.lobby;
      // (the table may have moved to a new code, if its old one turned out to be taken)
      this.lobby.code = code;
      const hostSeat = this.lobby.seats.find((s) => s.host);
      const mine = this.lobby.seats.find((s) => s.id === host.cid);
      if (opts.takeover && !mine && restore.event) {
        // a tournament's director takes the table over (its host's phone went quiet): the host
        // keeps their seat as a player, and the director's device is the table's screen, sitting out
        if (hostSeat) {
          hostSeat.host = false;
          delete hostSeat.screen;
        }
        this.lobby.seats.unshift({ id: host.cid, name: host.name, avatar: host.avatar, host: true, connected: true, screen: true, out: true });
      } else if (opts.takeover && mine && hostSeat !== mine) {
        // the old host keeps their seat as a player (they can rejoin it), and we host from ours
        if (hostSeat) {
          hostSeat.host = false;
          delete hostSeat.screen;
        }
        mine.host = true;
      } else if (hostSeat) {
        // the host may be resuming from a new browser session with a new client id: the seat (and
        // its place in the game) moves to it
        const old = hostSeat.id;
        hostSeat.id = host.cid;
        hostSeat.avatar = host.avatar ?? hostSeat.avatar;
        if (old !== host.cid) {
          if (this.lobby.playing) this.lobby.playing = this.lobby.playing.map((id) => (id === old ? host.cid : id));
          delete this.keys[old];
          if (host.key) this.keys[host.cid] = host.key;
        }
      }
      // (nobody else is here yet: they show as gone until they're back. Held still, a table put
      // back on screen to look at, everyone stays as they were)
      if (!opts.still) this.lobby.seats.forEach((s) => (s.connected = !!s.bot || !!s.host));
      this.state = restore.state;
      this.event = restore.event ?? null;
      if (this.event) this.hands = new Hands(EVENT_REPLAY_TOTAL);
      // (the app loads a saved game's rules before reopening it: see loadRules)
      if (this.state) this.module = rulesFor(this.state.game) ?? missing(this.state.game);
      // (a game saved before people could sit out: everyone at the table is in it)
      if (this.state && !this.lobby.playing) this.lobby.playing = this.lobby.seats.map((s) => s.id);
      if (restore.twin) this.restoreTwin(restore.twin);
      const boards = this.state && this.module?.boards?.(this.state);
      if (restore.par && boards?.length) this.pars = { key: boardsKey(boards), results: restore.par, at: 0 };
    } else {
      const carried = carriedGame(opts.game);
      this.lobby = {
        code,
        gameId: carried?.id ?? 'holdem',
        options: carried?.options ?? defaultOptions(GAMES.holdem),
        seats: [{ id: host.cid, name: host.name, avatar: host.avatar, host: true, connected: true }],
        spectators: 0,
        started: false,
        // a table split off from another carries tonight's tally so far
        ...(opts.night ? { night: structuredClone(opts.night) } : {}),
        ...(opts.parent ? { parent: opts.parent } : {}),
      };
    }
    this.lobby.tid ??= Math.random().toString(36).slice(2, 12);
    if (transport) this.wire(transport);
    this.v = this.state?.v ?? 0;
    this.#lastPhase = this.state?.phase ?? null;
    // the game picked in the lobby: fetch its rules now, so dealing is instant
    if (!this.state) void loadRules(this.lobby.gameId).catch(() => {});
  }

  /**
   * The connection to everyone else, when it comes after the table opened (the host doesn't wait
   * for it: the table is open at once, and others can join as soon as it's here).
   */
  attach(transport: Transport, backup: { backupKey?: string; takeoverToken?: string } = {}) {
    if (this.closed || this.transport) return;
    this.transport = transport;
    this.backups.configure(backup.backupKey, backup.takeoverToken);
    this.wire(transport);
  }

  private wire(transport: Transport) {
    transport.onMessage = (msg, from) => this.receive(from, msg);
    transport.onPeerLeave = (peer) => {
      this.conns.forget(peer);
      this.peerLeft(peer);
    };
    transport.onPeerJoin = () => {};
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  get hostCid() {
    return this.lobby.seats.find((s) => s.host)!.id;
  }

  // ---- incoming -------------------------------------------------------------------------

  private receive(peer: string, raw: Msg) {
    const msg = raw as ClientMsg;
    this.conns.heard(peer);
    if (msg.t === 'pong') return this.conns.pong(peer, msg.ts);
    if (msg.t === 'hello') {
      if (typeof msg.cid !== 'string' || !msg.cid || msg.cid.length > 64) return;
      // (a hello asks for the table afresh: the next view goes whole)
      this.conns.afresh(peer);
      return this.conns.pace(peer, msg, (m) => this.greet(peer, m));
    }
    if (msg.t === 'sync') return this.resync(peer);
    if (msg.t === 'replay') return this.sendFrame(peer, msg.hand, msg.step);
    if (msg.t === 'react') return void this.react(this.peers.get(peer) ?? '', msg.e);
    if (msg.t === 'export') return this.sendExport(peer, msg.format);
    if (msg.t === 'lobby') return this.lobbyOp(this.peers.get(peer), msg.op);
    if (msg.t === 'act') {
      const cid = this.peers.get(peer);
      if (!cid) return;
      const err = this.act(cid, msg.a);
      if (err) this.transport?.send({ t: 'err', msg: err, seq: msg.seq }, peer);
    }
  }

  private greet(peer: string, msg: Extract<ClientMsg, { t: 'hello' }>) {
    const key = typeof msg.key === 'string' && msg.key.length <= 128 ? msg.key : undefined;
    this.hello(peer, msg.cid, String(msg.name ?? 'Player'), cleanAvatar(msg.avatar), !!msg.display, key);
    // back from a split-off table: only someone now seated here brings its games back
    if (typeof msg.from === 'string' && Array.isArray(msg.merge) && this.peers.get(peer) === msg.cid && this.lobby.seats.some((s) => s.id === msg.cid))
      this.mergeBack(msg.from, msg.merge);
  }

  private hello(peer: string, cid: string, name: string, avatar: Avatar | undefined, display: boolean, key?: string) {
    // one identity per connection: asking for another seat lets go of the one it had
    const prev = this.peers.get(peer);
    if (prev !== undefined && prev !== cid && prev !== `screen:${cid}`) this.peerLeft(peer);
    if (display) {
      this.displays.add(peer);
      this.peers.set(peer, `screen:${cid}`);
      this.conns.watch(peer);
      return this.broadcast();
    }
    const seat = this.lobby.seats.find((s) => s.id === cid);
    if (seat && !this.mayHold(peer, cid, seat, key)) {
      this.conns.watch(peer);
      // no key yet (a client says hello to everyone before it knows who the host is): ask for it
      if (!key) return this.transport?.send({ t: 'view', view: { ...this.viewFor(null), who: true } }, peer);
      // the wrong key: they can watch, but not as that seat
      this.peers.set(peer, `watch:${peer}`);
      return this.broadcast();
    }
    if (seat && key && !this.keys[cid]) this.keys[cid] = key;
    // a client may reach us on more than one network; keep them all, they're the same seat
    this.peers.set(peer, cid);
    this.conns.watch(peer);
    if (seat) {
      seat.connected = true;
      seat.avatar = avatar ?? seat.avatar;
      // (a tournament's names are the ones its players registered with)
      if (!this.lobby.started && !this.event) seat.name = name.slice(0, 20);
      // back after a bot played for them: their seat is theirs again
      if (seat.standIn) return this.handBack(seat);
      if (this.event) return this.maybeStart();
    } else if (!this.event && (this.lobby.seats.length < TABLE_MAX || this.lobby.seats.some((s) => s.bot))) {
      if (this.lobby.seats.length >= TABLE_MAX) this.dropBot();
      if (key) this.keys[cid] = key;
      // mid-game, newcomers watch and play from the next game; in the lobby they're in if there's room
      const late = this.lobby.started;
      this.lobby.seats.push({ id: cid, name: name.slice(0, 20), avatar, connected: true, ...(late ? { out: true } : {}) });
      if (!late) this.fit({ newcomer: cid });
    }
    this.broadcast();
  }

  /**
   * May this connection sit in this seat? Never the host's own seat; otherwise with the seat's key,
   * or, for a seat with no key yet, if this connection is the one that took it (or nobody holds it:
   * a table saved before seats had keys).
   */
  private mayHold(peer: string, cid: string, seat: LobbySeat, key?: string): boolean {
    if (seat.host || seat.bot) return false;
    const known = this.keys[cid];
    if (known) return key === known;
    return this.peers.get(peer) === cid || ![...this.peers.values()].includes(cid);
  }

  /** The heartbeat: ping whoever has been quiet; drop peers we haven't heard from in a while. */
  private beat() {
    this.conns.beat(
      this.lobby.seats,
      !this.lobby.started,
      (peer) => {
        this.conns.forget(peer);
        this.peerLeft(peer);
      },
      (p) => this.onPings(p),
    );
  }

  /** Best round-trip time for each seat over any of its connections (host itself = 0). */
  pings(): (number | null)[] {
    return this.conns.pings(this.lobby.seats);
  }

  private peerLeft(peer: string) {
    const cid = this.conns.drop(peer);
    const seat = this.lobby.seats.find((s) => s.id === cid);
    if (seat && !this.conns.reaches(seat.id)) {
      seat.connected = false;
      // before the game starts, leaving frees the seat (and maybe a place for someone sitting out)
      // (a tournament's seats are kept for their players: the director decides who sits where)
      if (!this.lobby.started && !this.event) {
        this.lobby.seats = this.lobby.seats.filter((s) => s !== seat);
        this.fit();
      }
    }
    this.broadcast();
  }

  // ---- actions ----------------------------------------------------------------------------

  /** Apply an action from a client id. Returns an error message if it was rejected. */
  act(cid: string, a: Action): string | null {
    // (from the network: anything at all)
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') return 'That move isn’t available right now';
    if (a.cards !== undefined && (!Array.isArray(a.cards) || a.cards.length > 60 || !a.cards.every((c) => typeof c === 'string')))
      return 'That move isn’t available right now';
    if (a.type === STAND_IN) return this.standIn(cid, a.seat);
    if (a.type === SCREEN_SOUND) {
      if (!this.lobby.seats.some((s) => s.id === cid)) return 'You are not at the table';
      this.lobby.screenSound = a.amount !== 0;
      this.broadcast();
      return null;
    }
    const seat = this.gameSeat(cid);
    if (!this.state || !this.module || seat < 0) return this.state ? 'You’re sitting this one out' : 'You are not seated';
    // face-down cards are referred to by placeholder ids; map them back to real cards
    const resolved = resolveAction(this.state, seat, a);
    if (!resolved) return 'The table changed — try again';
    // real-time games: when it arrived, and a believable reaction time (measured on the player's device)
    if (this.module.realtime)
      Object.assign(resolved, { at: Date.now(), rt: typeof a.rt === 'number' && isFinite(a.rt) ? Math.max(0, Math.min(10_000, a.rt)) : undefined });
    this.bots.moved();
    return this.applyAs(seat, resolved);
  }

  private applyAs(seat: number, a: Action): string | null {
    const module = this.module!;
    if (a.type === UNDO) {
      if (!module.config.undo) return this.undoTakeBack(seat);
      const prev = this.history.pop();
      if (!prev) return 'Nothing to undo';
      this.state = prev;
      this.commit();
      return null;
    }
    const stop = this.eventStop(a.type);
    if (stop) return stop;
    // only what was offered, in the shape it was offered (a raise in range, cards you may pick…)
    const checked = checkAction(a, module.actions(this.state!, seat));
    if ('error' in checked) return checked.error;
    const { action } = checked;
    if (a.at !== undefined) action.at = a.at;
    const next = structuredClone(this.state!);
    try {
      module.apply(next, seat, action);
    } catch (e) {
      if (e instanceof RuleError) return e.message;
      console.error(e);
      report('engine', e, { game: module.config.id, phase: this.state!.phase, action: action.type });
      return 'Something went wrong';
    }
    if (module.config.undo) {
      this.history.push(this.state!);
      if (this.history.length > 30) this.history.shift();
    }
    this.takeBack = this.mayTakeBack(seat, this.state!, next) ? { seat, before: this.state!, after: next } : null;
    this.state = next;
    this.move = { seat, action };
    this.commit();
    this.move = undefined;
    return null;
  }

  /**
   * Let a bot play for someone who has dropped out of the game (their phone died, they walked off
   * with it): anyone at the table may ask, but only for a player who isn't connected. The bot
   * plays their seat until they come back (see handBack).
   */
  private standIn(cid: string, seat: unknown): string | null {
    const s = this.state;
    if (!s || !this.module?.bot) return 'There’s no game for a bot to play';
    if (!this.lobby.seats.some((x) => x.id === cid && !x.bot)) return 'You are not at the table';
    const target = typeof seat === 'number' && Number.isInteger(seat) ? this.lobby.seats.find((x) => x.id === this.lobby.playing?.[seat]) : undefined;
    if (!target || target.bot || target.standIn) return null;
    if (target.connected) return `${target.name} is back`;
    target.standIn = true;
    this.setBot(seat as number, true);
    return null;
  }

  /** A player a bot was playing for is back: the seat is theirs again. */
  private handBack(seat: LobbySeat) {
    delete seat.standIn;
    const at = this.gameSeat(seat.id);
    if (this.state && at >= 0 && this.state.players[at].bot) this.setBot(at, false);
    else this.broadcast();
  }

  /** A seat's player becomes (or stops being) a bot, as a step of its own (it shows in the replay). */
  private setBot(seat: number, bot: boolean) {
    const next = structuredClone(this.state!);
    next.players[seat].bot = bot;
    this.state = next;
    this.commit();
  }

  /** The latest move, while its player may still take it back (see Lobby.takeBacks). */
  private takeBack: { seat: number; before: GameState; after: GameState } | null = null;

  /** The move just made can be taken back: take-backs are on, a person made it, and it showed them no new card (a draw can't be undone). */
  private mayTakeBack(seat: number, before: GameState, after: GameState): boolean {
    const m = this.module!;
    if (!this.lobby.takeBacks || m.realtime || m.config.undo || before.players[seat]?.bot) return false;
    const seen = (st: GameState) => {
      const ids = new Set<string>();
      for (const z of Object.values(redact(m, st, seat).zones)) for (const c of z.cards) if (!isHidden(c.id)) ids.add(c.id);
      return ids;
    };
    const had = seen(before);
    return [...seen(after)].every((id) => had.has(id));
  }

  /** The take-back on offer to `seat` right now, if any (only until anyone, or anything, moves next). */
  private takeBackFor(seat: number) {
    const t = this.takeBack;
    return t && t.seat === seat && t.after === this.state ? t : null;
  }

  private undoTakeBack(seat: number): string | null {
    const t = this.takeBackFor(seat);
    if (!t) return 'Too late to take that back';
    this.takeBack = null;
    this.state = t.before;
    this.commit();
    return null;
  }

  /** The host turns take-backs on or off (any time). */
  setTakeBacks(on: boolean) {
    if (this.event) return;
    this.lobby.takeBacks = on || undefined;
    this.broadcast();
  }

  /** Bump version, persist, send views, then schedule any automatic steps. */
  private commit() {
    this.tally();
    this.record();
    this.broadcast();
    this.tellDirector();
    this.bots.pump();
    this.syncTwin();
  }

  // ---- replays ------------------------------------------------------------------------------

  /** The last few hands for replays, and the whole game move by move (see history.ts). */
  private hands = new Hands();

  /** This game so far as CSV, for `cid`: the moves, and only their own cards. */
  exportCsv(cid: string | null): string | null {
    return this.exportFile(cid, 'csv');
  }

  /** This game so far as a file, for `cid`: the spreadsheet, or its game's standard record. */
  exportFile(cid: string | null, format: ExportFormat): string | null {
    const s = this.state;
    if (!s || !this.module || this.module.realtime) return null;
    return this.hands.file(s, this.gameSeat(cid), format, this.lobby.code);
  }

  /** The move being made (for the standard records: who did what), while it's committed. */
  private move: { seat: number; action: Action } | undefined;

  /** Keep this moment for replays and the game's record; a hand that has just ended adds to the score history. */
  private record() {
    const s = this.state;
    const m = this.module;
    if (s && m && this.hands.record(m, s, this.move)) this.noteScores();
  }

  /** Add everyone's total now to the game's score history (at the deal, and as each hand ends). */
  private noteScores(atDeal = false) {
    if (this.module && this.state) noteScores(this.lobby, this.module, this.state, atDeal);
  }

  /**
   * A moment of a finished hand, as `cid` saw it then: their own cards, and everyone else's only
   * if they were shown. `hand` counts back from the latest (0); `step` is clamped to the hand.
   */
  frame(cid: string | null, hand: number, step: number): Frame | null {
    return this.module ? this.hands.frame(this.module, this.gameSeat(cid), hand, step) : null;
  }

  /** A replay frame asked for (a few a second per connection at most). */
  private sendFrame(peer: string, hand: unknown, step: unknown) {
    if (!this.conns.mayAsk(peer)) return;
    const cid = this.displays.has(peer) ? null : (this.peers.get(peer) ?? null);
    this.transport?.send({ t: 'frame', frame: this.frame(cid, Number(hand), Number(step)) }, peer);
  }

  /** A player's spreadsheet of the game (counted with replay frames: a few a second at most). */
  private sendExport(peer: string, format: unknown) {
    if (!this.conns.mayAsk(peer)) return;
    const cid = this.displays.has(peer) ? null : (this.peers.get(peer) ?? null);
    const f: ExportFormat = format === 'pbn' || format === 'ohh' ? format : 'csv';
    this.transport?.send({ t: 'export', format: f, text: this.exportFile(cid, f) }, peer);
  }

  /** Add a game that has just finished to tonight's tally (once; a rematch starts a new one). */
  private tally() {
    // (a tournament keeps its own standings)
    if (this.state && this.module && !this.event) tally(this.lobby, this.module, this.state, this.players());
  }

  /** A reaction from someone at the table, passed on to everyone (one a second each, at most). */
  react(cid: string, e: unknown): boolean {
    const now = Date.now();
    if (typeof e !== 'number' || !Number.isInteger(e) || e < 0 || e >= REACTIONS.length) return false;
    if (!this.lobby.seats.some((s) => s.id === cid && !s.bot) || now - (this.reacted.get(cid) ?? 0) < 1000) return false;
    this.reacted.set(cid, now);
    this.onReact(cid, e);
    this.transport?.send({ t: 'react', id: cid, e });
    return true;
  }
  private reacted = new Map<string, number>();
  /** Reactions, for this device's own screen. */
  onReact: (id: string, e: number) => void = () => {};

  /** Clear tonight's tally (host only). */
  newNight() {
    this.lobby.night = { games: [] };
    this.broadcast();
  }

  /**
   * An automatic step (collect a trick, deal the next hand…). If the rules throw, the table would
   * freeze where it is: report it and leave the game as it was, so the host can still end it.
   */
  private runSystem(sys: { run: (s: GameState) => void }, module: GameModule) {
    const next = structuredClone(this.state!);
    try {
      sys.run(next);
    } catch (e) {
      console.error(e);
      report('engine', e, { game: module.config.id, phase: this.state!.phase, action: 'system' });
      this.onLocalError('Something went wrong with the rules — you can end the game from the menu');
      return;
    }
    this.state = next;
    this.commit();
  }

  // ---- lobby controls (host device only) --------------------------------------------------

  setGame(gameId: string) {
    if (this.lobby.started || this.event) return;
    const g = getGame(gameId);
    // fetch its rules now, while people settle in, so dealing is instant
    void loadRules(gameId).catch(() => {});
    this.lobby.gameId = gameId;
    this.lobby.options = defaultOptions(g);
    if (!g.bot) this.lobby.seats = this.lobby.seats.filter((s) => !s.bot);
    this.fit();
    this.broadcast();
  }

  // ---- who plays ----------------------------------------------------------------------------

  /** The seats in the game being played (or about to be dealt), in seat order. */
  players(): LobbySeat[] {
    if (this.state && this.lobby.playing)
      return this.lobby.playing.map((id) => this.lobby.seats.find((s) => s.id === id) ?? { id, name: '?', connected: false });
    return this.lobby.seats.filter((s) => !s.out);
  }

  /**
   * Development and tests: one step of the game at once, the same every time from the same table:
   * an automatic step (collect the trick, deal the next hand) if one is due, else the first seat
   * with a move makes the one an Easy bot would (no searching against the clock, which a busy
   * machine would cut short), or the plainest legal one. False: nothing left to do.
   */
  step(): boolean {
    // (duplicate in a room: then the other table)
    return this.stepHere() || !!this.twin?.host.step();
  }
  private stepHere(): boolean {
    const s = this.state;
    const m = this.module;
    if (!s || !m || this.held(s)) return false;
    const sys = m.system?.(s);
    if (sys) {
      const v = s.v;
      this.runSystem(sys, m);
      return this.state !== s || this.state?.v !== v;
    }
    // whose turn it is first, else round the table from after whoever moved last (all at once, as
    // in a pass, everyone gets their go: the same seat again could take back what it just did)
    const n = s.players.length;
    const from = s.turn ?? this.#stepAfter + 1;
    const order = s.players.map((_, i) => s.players[(((from + i) % n) + n) % n]);
    for (const p of order) {
      const offered = m.actions(s, p.seat).filter((a) => !a.menu);
      if (!offered.length) continue;
      let a: Action | null;
      if (offered.some((x) => x.type === 'next')) a = { type: 'next' };
      else {
        // (counted thinking and its own dice, seeded from the moment: whatever else on the page
        // draws on Math.random, and however busy the machine)
        a = steadily(s.v * 16 + p.seat, () => {
          const v = botView(m, s, p.seat);
          v.view.options = { ...v.view.options, botLevel: 0 };
          const pick = m.bot?.(v.view, p.seat);
          return pick ? resolveAction(s, p.seat, v.unfill(pick)) : null;
        });
      }
      this.#stepAfter = p.seat;
      if (a && !this.applyAs(p.seat, a)) return true;
      for (const f of fallbackMoves(m.actions(s, p.seat))) if (!this.applyAs(p.seat, f)) return true;
    }
    return false;
  }
  /** The seat that made the last step's move (see step). */
  #stepAfter = -1;

  /**
   * The move a bot would make in `cid`'s seat right now (null: nothing to do). For driving a
   * person's seat in browser tests (see app.svelte.ts: development builds only).
   */
  botMoveFor(cid: string): Action | null {
    const s = this.state;
    const m = this.module;
    const seat = this.gameSeat(cid);
    if (!s || !m || seat < 0) return null;
    const offered = m.actions(s, seat);
    // (between hands: deal the next one)
    if (offered.some((a) => a.type === 'next')) return { type: 'next' };
    // (the seat's own view, like any bot; placeholders come back for act() to resolve)
    const v = botView(m, s, seat);
    const a = m.bot?.(v.view, seat) ?? null;
    return a ? v.unfill(a) : null;
  }

  /** A client's seat in the game (-1: not playing). */
  private gameSeat(cid: string | null): number {
    if (!cid) return -1;
    if (this.state && this.lobby.playing) return this.lobby.playing.indexOf(cid);
    return this.lobby.seats.findIndex((s) => s.id === cid);
  }

  private dropBot() {
    dropBot(this.lobby);
  }

  /** Keep the players to what the game seats (see fitSeats). */
  private fit(opts: { newcomer?: string } = {}) {
    fitSeats(this.lobby, opts);
  }

  /** The host picks who plays this game. */
  setPlaying(id: string, playing: boolean) {
    if (this.lobby.started || this.event) return;
    const seat = this.lobby.seats.find((s) => s.id === id);
    if (!seat || seat.screen) return;
    seat.out = !playing;
    // someone coming in bumps a bot rather than leaving the table over-full
    const max = seatsIn(getGame(this.lobby.gameId));
    if (playing && this.lobby.seats.filter((s) => !s.out).length > max) this.dropBot();
    this.broadcast();
  }

  /** True when the host's device is the table screen rather than a player. */
  get hostScreen() {
    return !!this.lobby.seats.find((s) => s.host)?.screen;
  }

  /**
   * The host plays, or their device becomes the table screen (a laptop or tablet everyone can see):
   * then it never takes a seat in a game, and the phones switch to showing just their hands.
   */
  setScreen(on: boolean) {
    if (this.lobby.started || this.event) return;
    const me = this.lobby.seats.find((s) => s.host);
    if (!me || !!me.screen === on) return;
    if (on) {
      me.screen = true;
      me.out = true;
      // someone at the table runs it from their phone (the host can pick who)
      this.lobby.captain = undefined;
      // (someone who was sitting out takes the place)
      this.fit();
      this.broadcast();
    } else {
      delete me.screen;
      delete this.lobby.captain;
      this.setPlaying(me.id, true);
    }
  }

  /** The player whose phone runs the table while the host's device is the table screen (null: none). */
  get captain(): string | null {
    if (!this.hostScreen || this.event) return null;
    const seat = this.lobby.seats.find((s) => s.id === this.lobby.captain);
    return seat && !seat.bot && !seat.host ? seat.id : null;
  }

  /** The host hands the table's controls to someone at the table. */
  setCaptain(id: string) {
    const seat = this.lobby.seats.find((s) => s.id === id);
    if (!this.hostScreen || this.event || !seat || seat.bot || seat.host) return;
    this.lobby.captain = id;
    this.broadcast();
  }

  /**
   * A lobby button pressed on the phone of the player holding the controls. Only theirs is
   * obeyed, and everything is checked as if it came from anyone (it travels over the network):
   * a game we have, an option that game has with a value it allows, bots only to remove.
   */
  private lobbyOp(cid: string | undefined, op: unknown) {
    if (!cid || cid !== this.captain) return;
    const c = lobbyCommand(op, this.lobby);
    if (!c) return;
    switch (c.op) {
      case 'game':
        return this.setGame(c.id);
      case 'option':
        return this.setOption(c.id, c.value);
      case 'bot':
        return this.addBot();
      case 'playing':
        return this.setPlaying(c.id, c.on);
      case 'move':
        return this.moveSeat(c.id, c.dir);
      case 'remove':
        return this.removeSeat(c.id);
      case 'deal':
        return this.start();
      case 'takeBacks':
        return this.setTakeBacks(c.on);
      case 'end':
        return this.endGame();
      case 'look':
        return this.setLook(c.look);
    }
  }

  // ---- splitting the table -----------------------------------------------------------------

  /**
   * Send some of the people here off to a table of their own: `newHost` hosts it (with tonight's
   * tally so far) and the others join them. Their finished games come back into this table's
   * tally when they head back (see mergeBack).
   */
  split(ids: string[], newHost: string): string | null {
    if (this.lobby.started || this.event) return null;
    const going = this.lobby.seats.filter((s) => ids.includes(s.id) && !s.bot && !s.host && s.connected);
    if (!going.some((s) => s.id === newHost)) return null;
    const code = makeRoomCode();
    const night = this.lobby.night ?? { games: [] };
    // (the new host starts on this table's game and settings: they can pick another)
    const game = { id: this.lobby.gameId, options: { ...this.lobby.options } };
    for (const s of going)
      this.sendTo(s.id, {
        t: 'move',
        code,
        host: s.id === newHost,
        night: s.id === newHost ? night : undefined,
        game: s.id === newHost ? game : undefined,
        parent: this.lobby.code,
      });
    this.lobby.seats = this.lobby.seats.filter((s) => !going.includes(s));
    this.lobby.splits = [...(this.lobby.splits ?? []), { code, names: going.map((s) => s.name) }];
    this.fit();
    this.broadcast();
    return code;
  }

  /** This table split off from another: everyone heads back there, taking tonight's games along. */
  goBack() {
    const parent = this.lobby.parent;
    if (!parent || this.lobby.started) return;
    for (const s of this.lobby.seats) if (!s.bot && !s.host) this.sendTo(s.id, { t: 'move', code: parent, back: true, night: this.lobby.night });
  }

  /** Players back from a split-off table: add the games they finished there to tonight's tally. */
  private mergeBack(from: string, games: unknown[]) {
    mergeNight(this.lobby, from, games);
  }

  private sendTo(cid: string, msg: HostMsg) {
    for (const [peer, c] of this.peers) if (c === cid) this.transport?.send(msg, peer);
  }

  /** A message for one person at the table, on every network that reaches them (a tournament's move, passed on). */
  tell(cid: string, msg: HostMsg) {
    this.sendTo(cid, msg);
  }

  setOption(id: string, value: number | boolean) {
    if (this.event) return;
    this.lobby.options[id] = value;
    this.broadcast();
  }

  addBot() {
    if (!this.event && addBot(this.lobby, this.players().length)) this.broadcast();
  }

  removeSeat(id: string) {
    if (this.lobby.started || this.event) return;
    this.lobby.seats = this.lobby.seats.filter((s) => s.id !== id || s.host);
    for (const [p, c] of this.peers) if (c === id) this.peers.delete(p);
    this.fit();
    this.broadcast();
  }

  moveSeat(id: string, dir: -1 | 1) {
    const seats = this.lobby.seats;
    const i = seats.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= seats.length || this.lobby.started || this.event) return;
    [seats[i], seats[j]] = [seats[j], seats[i]];
    this.broadcast();
  }

  /** The table's card back and cloth (any time, mid-game too). */
  setLook(look: { back: string; cloth: string }) {
    this.lobby.look = { back: String(look.back).slice(0, 24), cloth: String(look.cloth).slice(0, 24) };
    this.broadcast();
  }

  /** The host changing their own name/avatar. */
  updateSelf(name: string, avatar?: Avatar) {
    const me = this.lobby.seats.find((s) => s.host)!;
    me.avatar = avatar;
    if (!this.lobby.started) me.name = name;
    this.broadcast();
  }

  canStart(): string | null {
    return startProblem(this.lobby.gameId, this.players().length);
  }

  start() {
    if (this.closed || this.canStart() || this.event?.pending) return;
    const module = rulesFor(this.lobby.gameId);
    if (!module) {
      // (rules still downloading: deal as soon as they're here)
      void loadRules(this.lobby.gameId).then(
        () => !this.closed && !this.lobby.started && this.start(),
        () => this.onLocalError('Couldn’t load the rules for this game — check your connection and try again'),
      );
      return;
    }
    this.module = module;
    const players = this.players();
    this.lobby.playing = players.map((s) => s.id);
    this.lobby.started = true;
    this.history = [];
    this.takeBack = null;
    this.hands.reset(standardFormats(this.module.config));
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    // (at a tournament table, a bot plays for whoever hasn't arrived, until they do)
    const away = (s: LobbySeat) => !!this.event && !s.bot && !s.connected;
    for (const s of players) if (away(s)) s.standIn = true;
    this.state = this.module.setup(
      players.map((s) => ({ name: s.name, bot: s.bot || away(s) })),
      this.event?.table.seed ?? this.seed ?? randomSeed(),
      { ...this.lobby.options },
      // (duplicate in a room: compared with the other table this host keeps, or par, see syncTwin)
      this.event?.table.setup ?? (this.comparing(this.module) ? { compared: true } : undefined),
    );
    delete this.lobby.scores;
    if (!this.module.realtime) this.noteScores(true);
    this.commit();
  }

  /** Back to the lobby (not at a tournament table: its director moves it on). */
  endGame() {
    if (this.event) return;
    this.closeTwin();
    this.clearGame();
    this.lobby.seats = this.lobby.seats.filter((s) => s.connected || s.host);
    // whoever sat out that game gets priority for the next one
    const played = new Set(this.lobby.playing ?? []);
    for (const s of this.lobby.seats) {
      if (!played.has(s.id) && !s.bot && !s.screen) s.sat = (s.sat ?? 0) + 1;
      s.out = !!s.screen;
    }
    this.lobby.playing = undefined;
    delete this.lobby.scores;
    this.fit();
    this.broadcast();
  }

  /** The game off the table (the seats stay as they are). */
  private clearGame() {
    this.bots.stop();
    this.lobby.started = false;
    this.state = null;
    this.module = null;
    this.history = [];
    this.hands.reset();
  }

  // ---- a tournament table (see host/event.ts) ----------------------------------------------

  /**
   * The director seats this table for a round: its game, who sits where (each seat held by its
   * member's key) and its private inputs. Any game on the table now is put away. The game is dealt
   * as soon as everyone is here, or after a grace period with bots for whoever isn't.
   */
  seatTable(t: EventTable) {
    if (this.closed) return;
    // (the same table again: its link to the director came back, after a drop, a reload or a takeover; it plays on)
    const now = this.event && !this.event.pending ? this.event.table.info : null;
    if (now && now.code === t.info.code && now.round === t.info.round && now.table === t.info.table) return;
    const carried = carriedGame(t.game);
    if (!carried) return;
    if (this.state) this.clearGame();
    const me = this.lobby.seats.find((s) => s.host)!;
    this.event = { table: t, held: false, over: false };
    this.hands = new Hands(EVENT_REPLAY_TOTAL);
    this.lobby.gameId = carried.id;
    this.lobby.options = carried.options;
    this.lobby.seats = eventSeats(t, { cid: me.id, name: me.name, avatar: me.avatar });
    this.lobby.playing = undefined;
    this.lobby.event = t.info;
    delete this.lobby.captain;
    delete this.lobby.takeBacks;
    delete this.lobby.scores;
    const mine = this.keys[me.id];
    this.keys = Object.fromEntries(t.seats.flatMap((m) => (m && 'key' in m ? [[m.id, m.key]] : [])));
    if (mine) this.keys[me.id] = mine;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (!this.lobby.started) this.start();
    }, t.grace ?? EVENT_GRACE_MS);
    void loadRules(carried.id).then(
      () => this.maybeStart(),
      () => {},
    );
    this.broadcast();
    // anyone already here for one of these seats shows its key to take it (a client id alone is public)
    const reserved = new Set(t.seats.map((m) => (m && 'id' in m ? m.id : null)));
    for (const [peer, cid] of this.peers)
      if (reserved.has(cid) && cid !== me.id) this.transport?.send({ t: 'view', view: { ...this.viewFor(null), who: true } }, peer);
  }

  /**
   * A table opened for a tournament before its seating has come from the director: it's a
   * tournament table already (nobody can change it, or sit down), with nothing to deal yet.
   */
  expectTable(info: LobbyEvent) {
    if (this.event && !this.event.pending) return;
    const me = this.lobby.seats.find((s) => s.host)!;
    this.event = { table: { info, game: { id: this.lobby.gameId, options: this.lobby.options }, seats: [] }, held: false, over: false, pending: true };
    this.lobby.seats = [me];
    this.lobby.event = info;
    delete this.lobby.captain;
    this.broadcast();
  }

  /** A tournament table's progress, for its tile on the director's screens (null: not a tournament table). */
  tile(): TableTile | null {
    if (!this.event) return null;
    const s = this.state;
    const m = this.module;
    let totals: TableTile['totals'] = null;
    try {
      const board = s && m ? m.status(s, -1).scoreboard : undefined;
      if (board?.rows.length) totals = board.rows.map((r) => ({ name: r.name, total: String(r.values.at(-1) ?? '') }));
    } catch {
      /* (a status that fails is reported elsewhere) */
    }
    return {
      started: this.lobby.started,
      over: this.event.over,
      hands: this.event.hands ?? 0,
      waiting: this.lobby.seats.filter((x) => !x.bot && !x.connected && !x.out).map((x) => x.name),
      totals,
    };
  }

  /** A tournament table deals once everyone it's waiting for is here. */
  private maybeStart() {
    if (!this.event || this.closed || this.lobby.started || this.event.over || this.event.pending) return this.broadcast();
    if (this.lobby.seats.every((s) => s.bot || s.connected || s.out)) this.start();
    else this.broadcast();
  }

  /**
   * The director holds the table at the end of the hand (to move players between tables, or
   * change the blinds), or lets it carry on. Reaching the hold is news for the director.
   */
  hold(on: boolean) {
    if (!this.event) return;
    const was = this.event.held;
    this.event.held = on;
    // (held already, and asked again: said again, as the director may have reloaded since)
    if (on && this.state && END_PHASES.has(this.state.phase)) this.onTable({ kind: 'held' });
    if (was === on) return;
    this.broadcast();
    if (!on) this.bots.pump();
  }

  /** The table is held at the end of a hand: nothing moves on until the director says. */
  private held(s: GameState): boolean {
    return !!this.event?.held && END_PHASES.has(s.phase);
  }

  /** A tournament's change to the game (new blinds), between hands only, as a step of its own. Null: done; else why not. */
  adjust(change: TableChange): string | null {
    const s = this.state;
    const m = this.module;
    if (!this.event || !s || !m?.adjust) return 'Nothing to change';
    if (!END_PHASES.has(s.phase)) return 'Only between hands';
    const next = structuredClone(s);
    try {
      m.adjust(next, change);
    } catch (e) {
      return e instanceof Error ? e.message : 'Couldn’t change that';
    }
    this.state = next;
    this.commit();
    return null;
  }

  // ---- duplicate in a room: the other table (see host/twin.ts) -----------------------------

  /** Duplicate in a room: the other table playing this game's boards (null: none). */
  get otherTable(): Host | null {
    return this.twin?.host ?? null;
  }

  /** Everything this host keeps, for resuming after a reload. */
  private snapshot(): HostSnapshot {
    const twin = this.twin;
    return {
      lobby: this.lobby,
      state: this.state,
      keys: this.keys,
      ...(this.event ? { event: this.event } : {}),
      ...(twin?.snap ? { twin: { snap: twin.snap, room: twin.room, label: twin.label, match: twin.match, seats: twin.seats } } : {}),
      ...(this.pars?.results ? { par: this.pars.results } : {}),
    };
  }

  /** Duplicate in a room: whether this game is compared with something this host can give it (another table, or par). */
  private comparing(m: GameModule): boolean {
    const want = m.compareWith?.(this.lobby.options);
    return want === 'table' || (want === 'par' && !!this.solver);
  }
  private persist() {
    this.onPersist(this.snapshot());
  }

  /** The other table: a host of its own, in its room (people play there) or none (bots alone). */
  private twinHost(room: string | null, restore?: HostSnapshot): Host {
    const transport = room && this.twinOpts.open ? this.twinOpts.open(room) : null;
    const host = new Host(transport, room ?? 'TWIN', { cid: 'twin', name: 'Table 2' }, restore, {
      brain: this.twinOpts.brain?.(),
      still: this.still,
      seed: this.seed,
    });
    // (its every change: results to pass on, and its snapshot to keep with this table's)
    host.onBroadcast = () => this.syncTwin();
    host.onPersist = (snap) => {
      if (this.twin?.host !== host) return;
      this.twin.snap = snap;
      this.persist();
    };
    return host;
  }

  private restoreTwin(t: TwinSaved) {
    const boards = this.state && this.module?.boards?.(this.state);
    if (!boards?.length) return;
    this.twin = { ...t, key: boardsKey(boards), host: this.twinHost(t.room, t.snap) };
    this.twin.host.resume();
  }

  /**
   * Duplicate in a room: the other table plays this game's boards (seated afresh for a new game of
   * them), and each table hears the other's results (only on boards it has played: see compare); or
   * each board's par, worked out by the solver, is told to this table as it plays the boards.
   */
  private syncTwin() {
    const s = this.state;
    const m = this.module;
    if (this.syncing || this.closed || this.event || !s || !m?.boards || !this.comparing(m)) return;
    const boards = m.boards(s);
    if (!boards?.length) return;
    if (m.compareWith?.(this.lobby.options) === 'par') return this.syncPar(boards);
    this.syncing = true;
    try {
      const key = boardsKey(boards);
      if (this.twin?.key !== key) this.seatTwin(boards, key);
      const twin = this.twin!;
      const there = twin.host.state;
      if (!there || !m.report) return;
      this.compare((m.report(there).boards ?? []).map((r) => ({ ...r, at: twin.label })));
      twin.host.compare((m.report(this.state!).boards ?? []).map((r) => ({ ...r, at: 'Table 1' })));
    } finally {
      this.syncing = false;
    }
  }

  /** Each board's par, asked of the solver once for a game's boards (again a while after it fails), and told as they're played. */
  private syncPar(boards: Board[]) {
    const key = boardsKey(boards);
    const pars = this.pars;
    if (pars?.key !== key || (!pars.results?.length && pars.at && Date.now() - pars.at > PAR_AGAIN_MS)) {
      const asked: { key: string; results: OtherResult[] | null; at: number } = { key, results: null, at: Date.now() };
      this.pars = asked;
      void this.solver!(boards).then(
        (results) => {
          if (this.pars !== asked || this.closed) return;
          asked.results = results;
          this.persist();
          this.syncTwin();
        },
        () => {},
      );
      return;
    }
    if (!pars.results?.length) return;
    this.syncing = true;
    try {
      this.compare(pars.results);
    } finally {
      this.syncing = false;
    }
  }

  /** The other table, for these boards: made (whoever is sitting out goes there), or seated again for a new game. */
  private seatTwin(boards: Board[], key: string) {
    let twin = this.twin;
    if (!twin) {
      // (people sit there only if it can have a room of its own: else bots alone)
      const seats = this.twinOpts.open
        ? twinSeats(this.lobby.seats, this.keys, boards[0].hands.length)
        : boards[0].hands.map(() => ({ bot: true as const, name: '' }));
      const people = seats.filter((x) => 'key' in x);
      const room = people.length ? makeRoomCode() : null;
      twin = this.twin = { host: this.twinHost(room), room, label: room ? 'Table 2' : 'Bots', match: 0, seats, key, snap: null };
      for (const p of people) this.sendTo(p.id, { t: 'move', code: room! });
    }
    twin.match++;
    twin.key = key;
    twin.host.seatTable(
      twinTable({ code: this.lobby.code, match: twin.match, game: { id: this.lobby.gameId, options: { ...this.lobby.options } }, seats: twin.seats, boards }),
    );
  }

  /** Back to the lobby: the other table closes, its people back here. */
  private closeTwin() {
    const twin = this.twin;
    if (!twin) return;
    this.twin = null;
    for (const p of twin.seats) if ('key' in p) twin.host.tell(p.id, { t: 'move', code: this.lobby.code, back: true });
    // (the moves get away first)
    setTimeout(() => twin.host.close(), 500);
  }

  /**
   * Duplicate: other tables' results on this table's boards (see GameModule.compare), as they come:
   * shown beside its own, and, with every board played, the game decided on them.
   */
  compare(others: OtherResult[]) {
    const s = this.state;
    const m = this.module;
    const clean = cleanOthers(others);
    if (!s || !m?.compare || !clean.length) return;
    const next = structuredClone(s);
    m.compare(next, clean);
    if (JSON.stringify(next) === JSON.stringify(s)) return;
    this.state = next;
    this.commit();
  }

  /** The finished game's result again (a table reloaded, or taken over: its director ignores a repeat). */
  resendResult() {
    const s = this.state;
    const m = this.module;
    if (this.event && s && m && s.phase === 'gameOver' && s.winner?.length) this.onTable({ kind: 'over', result: tableResult(m, s) });
  }

  /** The director puts a bot in for a player who isn't here (`seat`: their game seat), until they're back. */
  standInFor(seat: number) {
    const target = this.lobby.seats.find((x) => x.id === this.lobby.playing?.[seat]);
    if (!this.event || !this.state || !this.module?.bot || !target || target.bot || target.standIn || target.connected) return;
    target.standIn = true;
    this.setBot(seat, true);
  }

  /**
   * Why a move isn't on at a tournament table (null: it is). Nobody there deals the game again:
   * the director decides what comes next; and a table held at a hand's end waits.
   */
  private eventStop(type: string): string | null {
    if (!this.event) return null;
    if (type === 'rematch') return 'The tournament decides what’s next';
    if (type === 'next' && this.state && this.held(this.state)) return 'The table is waiting for the tournament';
    return null;
  }

  /** Tell a tournament's director how the table is going: a hand ended, the game ended, a hold reached. */
  private tellDirector() {
    const s = this.state;
    const m = this.module;
    const ev = this.event;
    const was = this.#lastPhase;
    this.#lastPhase = s?.phase ?? null;
    if (!ev || !s || !m || s.phase === was || !END_PHASES.has(s.phase)) return;
    ev.hands = (ev.hands ?? 0) + 1;
    this.onTable({ kind: 'hand', ...(m.report ? { report: m.report(s) } : {}) });
    if (s.phase === 'gameOver' && s.winner?.length && !ev.over) {
      ev.over = true;
      this.onTable({ kind: 'over', result: tableResult(m, s) });
    }
    if (ev.held) this.onTable({ kind: 'held' });
  }

  /** A tournament's director holds the table's latest backup too (null: no longer), from its host's link (see host/uplink.ts). */
  backupTo(f: ((blob: string, v: number, token: string) => void) | null) {
    this.backups.away = f;
    if (f) this.backups.queue();
  }

  /** Resume bots/system steps after restoring from a snapshot. */
  resume() {
    this.broadcast();
    this.bots.pump();
  }

  close() {
    this.closed = true;
    this.twin?.host.close();
    this.twin = null;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.bots.stop();
    for (const peer of this.conns.known) this.conns.forget(peer);
    this.backups.stop();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.transport?.leave();
  }

  // ---- outgoing ---------------------------------------------------------------------------

  viewFor(cid: string | null): View {
    const seat = this.gameSeat(cid);
    const s = this.state;
    const m = this.module;
    const view: View = {
      v: this.v,
      hid: this.hid,
      lobby: this.lobby,
      you: s ? seat : -1,
      state: s && m ? redact(m, s, seat) : null,
      actions: s && m && seat >= 0 ? redactActions(s, seat, m.actions(s, seat)).filter((a) => !this.eventStop(a.type)) : [],
      status: s && m ? m.status(s, seat) : null,
      ...(s && this.hands.count ? { replays: this.hands.count } : {}),
      // (the hand on the table has just finished: offer to replay it)
      ...(s && this.hands.justEnded(s) ? { handDone: true as const } : {}),
    };
    if (s && m?.config.undo && this.history.length && seat >= 0) view.actions.push({ type: UNDO, label: 'Undo', menu: true });
    else if (s && seat >= 0 && this.takeBackFor(seat)) view.actions.push({ type: UNDO, label: 'Take back', style: 'quiet' });
    return view;
  }

  broadcast() {
    // (a closed host has handed its table on, or left it: it saves and sends nothing more)
    if (this.closed) return;
    this.v++;
    // while the host is the table screen someone holds the controls: the first person here, unless the host picks
    if (this.hostScreen && !this.event && !this.captain) this.lobby.captain = this.lobby.seats.find((s) => !s.bot && !s.host && s.connected)?.id;
    // (people sitting out are at the table: not counted as watching)
    const seated = new Set(this.lobby.seats.map((s) => s.id));
    // a device can reach us on several networks: count devices (client ids), not connections
    const screens = new Set([...this.displays].map((p) => this.peers.get(p)));
    // (the host's own device counts when it's the table screen)
    this.lobby.displays = screens.size + (this.hostScreen ? 1 : 0);
    this.lobby.spectators = new Set([...this.peers.values()].filter((c) => !seated.has(c) && !screens.has(c))).size;
    if (this.state) this.state.v = this.v;
    this.onLocalView(this.viewFor(this.hostCid));
    if (this.transport) {
      // one view per person (or table screen), sent on one of the networks that reach them
      const views = new Map<string | null, View>();
      for (const cid of new Set(this.peers.values())) {
        const peer = this.conns.route(cid);
        if (!peer) continue;
        const who = this.displays.has(peer) ? null : cid;
        let view = views.get(who);
        if (!view) views.set(who, (view = wire(this.viewFor(who))));
        this.conns.sendView(peer, view);
      }
    }
    this.persist();
    this.backups.queue();
    this.onBroadcast();
  }

  /** A player's patch didn't fit: the whole view again (once a second at most, per connection). */
  private resync(peer: string) {
    const cid = this.conns.resync(peer);
    if (cid !== undefined) this.conns.sendView(peer, wire(this.viewFor(this.displays.has(peer) ? null : cid)));
  }
}

function missing(id: string): never {
  throw new Error(`The rules for ${id} aren't loaded (loadRules first)`);
}
