import { botView } from '../engine/botView';
import { isHidden, redact, redactActions, resolveAction } from '../engine/redact';
import { randomSeed } from '../engine/rng';
import { RuleError, type Action, type GameModule, type GameState } from '../engine/types';
import { checkAction } from '../engine/validate';
import { getGame, GAMES, loadRules, rulesFor, startProblem } from '../games';
import { type Brain } from './brain';

import {
  AVATAR_COLORS,
  AVATAR_EMOJI,
  cleanAvatar,
  makeRoomCode,
  type Avatar,
  type ClientMsg,
  type Frame,
  type HostMsg,
  type Lobby,
  type LobbySeat,
  type Msg,
  type Night,
  type NightGame,
  type View,
  REACTIONS,
} from './protocol';
import { seal } from './backup';
import { Hands, noteScores, tally } from './host/history';
import { Bots } from './host/bots';
import type { ExportFormat } from './exports/formats';
import { pingsMoved, VERSION_PATHS, wire } from './host/wire';
import { cleanNightGame, standardFormats } from './host/records';
import { carriedGame, defaultOptions } from './host/lobby';
export { SCORE_HANDS, totalsOf } from './host/records';
export { defaultOptions } from './host/lobby';
import { report } from './reports';
import type { Transport } from './transport';
import { diff } from './patch';

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
import {
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
  TABLE_MAX,
  RTT_EVERY_MS,
  UNDO,
  BOT_NAMES,
  FRAMES_PER_SECOND,
} from './host/limits';

/** The most players a game seats. */
const seatsIn = (g: { config: GameModule['config'] }) => (g.config.players.counts ? Math.max(...g.config.players.counts) : g.config.players.max);

export interface HostSnapshot {
  lobby: Lobby;
  state: GameState | null;
  /** Each seat's key, by client id (see `hello`): kept with the game, never sent to players. */
  keys?: Record<string, string>;
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
  /** Development and tests: every game dealt from this seed (see opts). */
  private readonly seed?: number;
  private history: GameState[] = [];
  /**
   * transport peer id → client id. Table screens are `screen:<cid>` and people the host won't seat
   * under the id they asked for (no key, or the wrong one) watch as `watch:<peer>`, so neither can
   * act for a seat.
   */
  private peers = new Map<string, string>();
  /**
   * The secret holding each seat, by client id. Client ids are public (they're in every view), so
   * a seat goes back to a connection only when it brings that seat's key (sent only to the host).
   */
  private keys: Record<string, string>;
  private displays = new Set<string>();
  /** Identifies this host instance in views (see View.hid). */
  private readonly hid = Math.random().toString(36).slice(2, 10);
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** peer → last round-trip time and when we last heard from it */
  private health = new Map<string, { rtt: number | null; seen: number }>();
  /** Round-trip times by seat, for the local UI. */
  onPings: (pings: (number | null)[]) => void = () => {};
  private v = 0;
  onLocalView: (v: View) => void = () => {};
  onLocalError: (msg: string) => void = () => {};
  /** Called after every change with a serialisable snapshot (for resume-after-refresh). */
  onPersist: (snap: HostSnapshot) => void = () => {};
  /** Host handoff: the key players' backups are sealed with (held by the relay), if any. */
  private backupKey?: string;
  /** Given to players with their backups: the relay lets only someone holding it take over. */
  private takeoverToken?: string;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the queued backup goes, and when the last one went. */
  private backupDue = 0;
  private backupAt = 0;
  private backedUp = -1;
  /** Who holds the latest backup (client ids). */
  private holders: string[] = [];
  /** The phase, and the cards on the trick, at the last broadcast: their change marks a trick or hand ending. */
  private seenPhase?: string;
  private seenTrick = 0;
  private closed = false;

  constructor(
    private transport: Transport | null,
    code: string,
    host: { cid: string; name: string; avatar?: Avatar; key?: string },
    restore?: HostSnapshot,
    /** `takeover`: this device is a player taking over from a host that has gone. */
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
    } = {},
  ) {
    this.seed = opts.seed;
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
      },
      opts.brain,
      !!opts.still,
    );
    this.backupKey = opts.backupKey;
    this.takeoverToken = opts.takeoverToken;
    this.keys = { ...(restore?.keys ?? {}) };
    if (host.key) this.keys[host.cid] = host.key;
    if (restore) {
      this.lobby = restore.lobby;
      // (the table may have moved to a new code, if its old one turned out to be taken)
      this.lobby.code = code;
      const hostSeat = this.lobby.seats.find((s) => s.host);
      const mine = this.lobby.seats.find((s) => s.id === host.cid);
      if (opts.takeover && mine && hostSeat !== mine) {
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
      this.lobby.seats.forEach((s) => (s.connected = !!s.bot || !!s.host));
      this.state = restore.state;
      // (the app loads a saved game's rules before reopening it: see loadRules)
      if (this.state) this.module = rulesFor(this.state.game) ?? missing(this.state.game);
      // (a game saved before people could sit out: everyone at the table is in it)
      if (this.state && !this.lobby.playing) this.lobby.playing = this.lobby.seats.map((s) => s.id);
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
    this.backupKey = backup.backupKey;
    this.takeoverToken = backup.takeoverToken;
    this.wire(transport);
  }

  private wire(transport: Transport) {
    transport.onMessage = (msg, from) => this.receive(from, msg);
    transport.onPeerLeave = (peer) => {
      this.forget(peer);
      this.peerLeft(peer);
    };
    transport.onPeerJoin = () => {};
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  get hostCid() {
    return this.lobby.seats.find((s) => s.host)!.id;
  }

  // ---- incoming -------------------------------------------------------------------------

  /** The last view each connection was sent, and when each last asked for a whole one. */
  private sentViews = new Map<string, View>();
  private syncedAt = new Map<string, number>();

  private receive(peer: string, raw: Msg) {
    const msg = raw as ClientMsg;
    const h = this.health.get(peer);
    if (h) h.seen = Date.now();
    if (msg.t === 'pong') {
      if (h && typeof msg.ts === 'number') h.rtt = Math.max(0, Math.round(performance.now() - msg.ts));
      return;
    }
    if (msg.t === 'hello') {
      if (typeof msg.cid !== 'string' || !msg.cid || msg.cid.length > 64) return;
      // (a hello asks for the table afresh: the next view goes whole)
      this.sentViews.delete(peer);
      return this.paced(peer, msg);
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

  /**
   * Hellos, rate-limited per connection: every hello re-sends the whole table, so a connection
   * saying hello over and over (a bug, or on purpose) could swamp the host. One is handled at
   * once; any more within HELLO_GAP_MS wait, and only the latest of them is handled. A connection
   * hopping between client ids is cut off after a few.
   */
  private helloPace = new Map<
    string,
    { last: number; pending: Extract<ClientMsg, { t: 'hello' }> | null; timer: ReturnType<typeof setTimeout> | null; ids: number[] }
  >();

  private paced(peer: string, msg: Extract<ClientMsg, { t: 'hello' }>) {
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
      return this.greet(peer, msg);
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
        if (latest) this.greet(peer, latest);
      },
      HELLO_GAP_MS - (now - p.last),
    );
  }

  private greet(peer: string, msg: Extract<ClientMsg, { t: 'hello' }>) {
    const key = typeof msg.key === 'string' && msg.key.length <= 128 ? msg.key : undefined;
    this.hello(peer, msg.cid, String(msg.name ?? 'Player'), cleanAvatar(msg.avatar), !!msg.display, key);
    // back from a split-off table: only someone now seated here brings its games back
    if (typeof msg.from === 'string' && Array.isArray(msg.merge) && this.peers.get(peer) === msg.cid && this.lobby.seats.some((s) => s.id === msg.cid))
      this.mergeBack(msg.from, msg.merge);
  }

  /** A connection has gone for good: drop its pacing (and any hello still waiting). */
  private forget(peer: string) {
    this.framesAsked.delete(peer);
    this.sentViews.delete(peer);
    this.syncedAt.delete(peer);
    const p = this.helloPace.get(peer);
    if (p?.timer) clearTimeout(p.timer);
    this.helloPace.delete(peer);
  }

  private hello(peer: string, cid: string, name: string, avatar: Avatar | undefined, display: boolean, key?: string) {
    // one identity per connection: asking for another seat lets go of the one it had
    const prev = this.peers.get(peer);
    if (prev !== undefined && prev !== cid && prev !== `screen:${cid}`) this.peerLeft(peer);
    if (display) {
      this.displays.add(peer);
      this.peers.set(peer, `screen:${cid}`);
      this.health.set(peer, { rtt: null, seen: Date.now() });
      return this.broadcast();
    }
    const seat = this.lobby.seats.find((s) => s.id === cid);
    if (seat && !this.mayHold(peer, cid, seat, key)) {
      this.health.set(peer, { rtt: this.health.get(peer)?.rtt ?? null, seen: Date.now() });
      // no key yet (a client says hello to everyone before it knows who the host is): ask for it
      if (!key) return this.transport?.send({ t: 'view', view: { ...this.viewFor(null), who: true } }, peer);
      // the wrong key: they can watch, but not as that seat
      this.peers.set(peer, `watch:${peer}`);
      return this.broadcast();
    }
    if (seat && key && !this.keys[cid]) this.keys[cid] = key;
    // a client may reach us on more than one network; keep them all, they're the same seat
    this.peers.set(peer, cid);
    this.health.set(peer, { rtt: this.health.get(peer)?.rtt ?? null, seen: Date.now() });
    if (seat) {
      seat.connected = true;
      seat.avatar = avatar ?? seat.avatar;
      if (!this.lobby.started) seat.name = name.slice(0, 20);
      // back after a bot played for them: their seat is theirs again
      if (seat.standIn) return this.handBack(seat);
    } else if (this.lobby.seats.length < TABLE_MAX || this.lobby.seats.some((s) => s.bot)) {
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

  /** Ping whoever has been quiet; drop peers we haven't heard from in a while (faster than WebRTC notices). */
  private beat() {
    const now = Date.now();
    // our own page was asleep (a phone locked, a tab in the background): nobody could be heard
    // meanwhile, so everyone gets a fresh chance to answer rather than all being dropped at once
    if (now - this.lastBeat > HEARTBEAT_MS * 3) for (const h of this.health.values()) h.seen = Math.max(h.seen, now);
    this.lastBeat = now;
    const pings = this.pings();
    for (const [peer, h] of this.health) {
      if (now - h.seen > DEAD_AFTER_MS) {
        this.forget(peer);
        this.peerLeft(peer);
        continue;
      }
      // someone who has been talking (moves, answers) and been sent something lately needs no ping
      const sent = this.sentAt.get(peer) ?? 0;
      const pinged = this.pingedAt.get(peer) ?? 0;
      if (h.rtt != null && now - h.seen < PING_AFTER_MS && now - sent < PING_AFTER_MS && now - pinged < RTT_EVERY_MS) continue;
      // the latency lights ride along when they've changed for this connection (in the lobby, which
      // shows the numbers, by 25 ms; at the table, which shows only a light, when a light changes)
      const told = this.toldPings.get(peer);
      const fresh = !told || pingsMoved(told, pings, !this.lobby.started);
      if (fresh) this.toldPings.set(peer, pings);
      this.pingedAt.set(peer, now);
      this.sentAt.set(peer, now);
      this.transport?.send({ t: 'ping', ts: performance.now(), ...(fresh ? { pings } : {}) }, peer);
    }
    // (the host's own screen hears of every change: that costs nothing)
    const now2 = this.pings();
    if (pingsMoved(this.sentPings, now2, true)) {
      this.sentPings = now2;
      this.onPings(now2);
    }
  }
  private sentPings: (number | null)[] = [];
  /** When each connection was last sent anything, last pinged, and the latency lights it was last told. */
  private sentAt = new Map<string, number>();
  private pingedAt = new Map<string, number>();
  private toldPings = new Map<string, (number | null)[]>();
  private lastBeat = Date.now();

  /** Best round-trip time for each seat over any of its connections (host itself = 0). */
  pings(): (number | null)[] {
    return this.lobby.seats.map((seat) => {
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

  private peerLeft(peer: string) {
    const cid = this.peers.get(peer);
    this.peers.delete(peer);
    this.health.delete(peer);
    this.displays.delete(peer);
    this.sentAt.delete(peer);
    this.pingedAt.delete(peer);
    this.toldPings.delete(peer);
    if (cid !== undefined && ![...this.peers.values()].includes(cid)) this.routes.delete(cid);
    const seat = this.lobby.seats.find((s) => s.id === cid);
    if (seat && ![...this.peers.values()].includes(seat.id)) {
      seat.connected = false;
      // before the game starts, leaving frees the seat (and maybe a place for someone sitting out)
      if (!this.lobby.started) {
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
    this.lobby.takeBacks = on || undefined;
    this.broadcast();
  }

  /** Bump version, persist, send views, then schedule any automatic steps. */
  private commit() {
    this.tally();
    this.record();
    this.broadcast();
    this.bots.pump();
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

  /** Replay requests, a few a second per connection at most. */
  private framesAsked = new Map<string, { second: number; n: number }>();
  private sendFrame(peer: string, hand: unknown, step: unknown) {
    const second = Math.floor(Date.now() / 1000);
    const c = this.framesAsked.get(peer);
    if (c?.second === second && ++c.n > FRAMES_PER_SECOND) return;
    if (c?.second !== second) this.framesAsked.set(peer, { second, n: 1 });
    const cid = this.displays.has(peer) ? null : (this.peers.get(peer) ?? null);
    this.transport?.send({ t: 'frame', frame: this.frame(cid, Number(hand), Number(step)) }, peer);
  }

  /** A player's spreadsheet of the game (counted with replay frames: a few a second at most). */
  private sendExport(peer: string, format: unknown) {
    const second = Math.floor(Date.now() / 1000);
    const c = this.framesAsked.get(peer);
    if (c?.second === second && ++c.n > FRAMES_PER_SECOND) return;
    if (c?.second !== second) this.framesAsked.set(peer, { second, n: 1 });
    const cid = this.displays.has(peer) ? null : (this.peers.get(peer) ?? null);
    const f: ExportFormat = format === 'pbn' || format === 'ohh' ? format : 'csv';
    this.transport?.send({ t: 'export', format: f, text: this.exportFile(cid, f) }, peer);
  }

  /** Add a game that has just finished to tonight's tally (once; a rematch starts a new one). */
  private tally() {
    if (this.state && this.module) tally(this.lobby, this.module, this.state, this.players());
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
    if (this.lobby.started) return;
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
    const i = this.lobby.seats.map((s) => !!s.bot).lastIndexOf(true);
    if (i >= 0) this.lobby.seats.splice(i, 1);
  }

  /**
   * Keep the players to what the game seats: bots go first, then whoever has sat out least
   * (latest to join among equals) sits out; when there's room, whoever has sat out most comes in.
   * A newcomer takes a bot's place, or sits out if the game is full of people.
   */
  private fit(opts: { newcomer?: string } = {}) {
    const max = seatsIn(getGame(this.lobby.gameId));
    const seats = this.lobby.seats;
    const playing = () => seats.filter((s) => !s.out);
    while (playing().length > max && seats.some((s) => s.bot)) this.dropBot();
    const order = (s: LobbySeat) => (s.sat ?? 0) * 100 - seats.indexOf(s) / 100;
    // the newcomer waits their turn rather than bumping someone already in
    if (opts.newcomer && playing().length > max) {
      const me = seats.find((s) => s.id === opts.newcomer);
      if (me) me.out = true;
    }
    while (playing().length > max) {
      const bump = playing()
        .filter((s) => !s.host || playing().length === 1)
        .sort((a, b) => order(a) - order(b))[0];
      if (!bump) break;
      bump.out = true;
    }
    while (playing().length < max) {
      const next = seats.filter((s) => s.out && s.connected && !s.screen).sort((a, b) => order(b) - order(a))[0];
      if (!next) break;
      next.out = false;
    }
  }

  /** The host picks who plays this game. */
  setPlaying(id: string, playing: boolean) {
    if (this.lobby.started) return;
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
    if (this.lobby.started) return;
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
    if (!this.hostScreen) return null;
    const seat = this.lobby.seats.find((s) => s.id === this.lobby.captain);
    return seat && !seat.bot && !seat.host ? seat.id : null;
  }

  /** The host hands the table's controls to someone at the table. */
  setCaptain(id: string) {
    const seat = this.lobby.seats.find((s) => s.id === id);
    if (!this.hostScreen || !seat || seat.bot || seat.host) return;
    this.lobby.captain = id;
    this.broadcast();
  }

  /**
   * A lobby button pressed on the phone of the player holding the controls. Only theirs is
   * obeyed, and everything is checked as if it came from anyone (it travels over the network):
   * a game we have, an option that game has with a value it allows, bots only to remove.
   */
  private lobbyOp(cid: string | undefined, op: unknown) {
    if (!cid || cid !== this.captain || !op || typeof op !== 'object') return;
    const o = op as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : null);
    switch (o.op) {
      case 'game': {
        const id = str(o.id);
        if (id && GAMES[id]) this.setGame(id);
        return;
      }
      case 'option': {
        const id = str(o.id);
        const opt = getGame(this.lobby.gameId).config.options?.find((x) => x.id === id);
        if (this.lobby.started || !opt || !id) return;
        if (opt.type === 'boolean' && typeof o.value === 'boolean') return this.setOption(id, o.value);
        const v = o.value;
        if (opt.type === 'number' && typeof v === 'number' && Number.isFinite(v)) {
          const min = opt.min ?? 0;
          const top = opt.choices ? opt.choices.length - 1 : (opt.max ?? Infinity);
          // (on the option's own steps: a choice's index, or min + a whole number of steps)
          const step = opt.choices ? 1 : (opt.step ?? 1);
          if (v >= min && v <= top && Number.isInteger(Math.round(((v - min) / step) * 1e6) / 1e6)) this.setOption(id, v);
        }
        return;
      }
      case 'bot':
        if (!this.lobby.started) this.addBot();
        return;
      case 'playing': {
        const id = str(o.id);
        if (id && typeof o.on === 'boolean') this.setPlaying(id, o.on);
        return;
      }
      case 'move': {
        const id = str(o.id);
        if (id && (o.dir === 1 || o.dir === -1)) this.moveSeat(id, o.dir);
        return;
      }
      case 'remove': {
        // (only bots: who is at the table is the host's call)
        const id = str(o.id);
        if (id && this.lobby.seats.some((s) => s.id === id && s.bot)) this.removeSeat(id);
        return;
      }
      case 'deal':
        if (!this.lobby.started) this.start();
        return;
      case 'takeBacks':
        if (typeof o.on === 'boolean') this.setTakeBacks(o.on);
        return;
      case 'end':
        if (this.lobby.started) this.endGame();
        return;
      case 'look': {
        const back = str(o.back);
        const cloth = str(o.cloth);
        if (back && cloth) this.setLook({ back, cloth });
        return;
      }
    }
  }

  // ---- splitting the table -----------------------------------------------------------------

  /**
   * Send some of the people here off to a table of their own: `newHost` hosts it (with tonight's
   * tally so far) and the others join them. Their finished games come back into this table's
   * tally when they head back (see mergeBack).
   */
  split(ids: string[], newHost: string): string | null {
    if (this.lobby.started) return null;
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
    // (only a table that split off from this one, once; and only well-formed games)
    if (!this.lobby.splits?.some((x) => x.code === from)) return;
    const known = new Set((this.lobby.night?.games ?? []).map((g) => `${g.at}:${g.game}`));
    const fresh = games
      .slice(0, 100)
      .map(cleanNightGame)
      .filter((g): g is NightGame => !!g && !known.has(`${g.at}:${g.game}`));
    if (fresh.length) {
      this.lobby.night ??= { games: [] };
      this.lobby.night.games.push(...fresh);
      this.lobby.night.games.sort((a, b) => a.at - b.at);
    }
    this.lobby.splits = this.lobby.splits.filter((x) => x.code !== from);
  }

  private sendTo(cid: string, msg: HostMsg) {
    for (const [peer, c] of this.peers) if (c === cid) this.transport?.send(msg, peer);
  }

  setOption(id: string, value: number | boolean) {
    this.lobby.options[id] = value;
    this.broadcast();
  }

  addBot() {
    const g = getGame(this.lobby.gameId);
    if (!g.bot || this.players().length >= seatsIn(g) || this.lobby.seats.length >= TABLE_MAX) return;
    const used = new Set(this.lobby.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.lobby.seats.length}`;
    const n = this.lobby.seats.length;
    const avatar = { emoji: AVATAR_EMOJI[(n * 7 + 3) % AVATAR_EMOJI.length], color: AVATAR_COLORS[(n * 3 + 1) % AVATAR_COLORS.length] };
    this.lobby.seats.push({ id: `bot:${Math.random().toString(36).slice(2, 7)}`, name, avatar, bot: true, connected: true });
    this.broadcast();
  }

  removeSeat(id: string) {
    if (this.lobby.started) return;
    this.lobby.seats = this.lobby.seats.filter((s) => s.id !== id || s.host);
    for (const [p, c] of this.peers) if (c === id) this.peers.delete(p);
    this.fit();
    this.broadcast();
  }

  moveSeat(id: string, dir: -1 | 1) {
    const seats = this.lobby.seats;
    const i = seats.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= seats.length || this.lobby.started) return;
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
    if (this.closed || this.canStart()) return;
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
    this.state = this.module.setup(
      players.map((s) => ({ name: s.name, bot: s.bot })),
      this.seed ?? randomSeed(),
      { ...this.lobby.options },
    );
    delete this.lobby.scores;
    if (!this.module.realtime) this.noteScores(true);
    this.commit();
  }

  /** Back to the lobby. */
  endGame() {
    this.bots.stop();
    this.lobby.started = false;
    this.state = null;
    this.module = null;
    this.history = [];
    this.hands.reset();
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

  /** Resume bots/system steps after restoring from a snapshot. */
  resume() {
    this.broadcast();
    this.bots.pump();
  }

  close() {
    this.closed = true;
    this.bots.stop();
    for (const peer of [...this.helloPace.keys()]) this.forget(peer);
    if (this.backupTimer) clearTimeout(this.backupTimer);
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
      actions: s && m && seat >= 0 ? redactActions(s, seat, m.actions(s, seat)) : [],
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
    if (this.hostScreen && !this.captain) this.lobby.captain = this.lobby.seats.find((s) => !s.bot && !s.host && s.connected)?.id;
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
      const now = Date.now();
      for (const cid of new Set(this.peers.values())) {
        const peer = this.routeTo(cid);
        if (!peer) continue;
        const who = this.displays.has(peer) ? null : cid;
        let view = views.get(who);
        if (!view) views.set(who, (view = wire(this.viewFor(who))));
        if (this.sendView(peer, view)) this.sentAt.set(peer, now);
      }
    }
    this.onPersist({ lobby: this.lobby, state: this.state, keys: this.keys });
    this.queueBackup();
  }

  /**
   * A view to one connection: only what changed since the last one it had, when that's smaller (a
   * move changes a few dozen bytes of a view of several kilobytes, which matters to players on a
   * phone's data); otherwise the whole view.
   */
  /** (`view` is a copy, as sent: a view shares the lobby and game with the host, which change in place, and the next patch is worked out against it) */
  private sendView(peer: string, view: View): boolean {
    const prev = this.sentViews.get(peer);
    if (prev && prev.hid === view.hid && view.v > prev.v) {
      // (the version number is the patch's own `v`: the player sets it, it isn't sent twice more)
      const ops = diff(prev, view).filter((op) => !(op[0] === 's' && VERSION_PATHS.has(op[1].join('.')) && op[2] === view.v));
      // nothing they can see has changed (a phone saying hello again, someone else's move that's
      // hidden from them): send nothing (the next patch still fits what they have)
      if (!ops.length) return false;
      this.sentViews.set(peer, view);
      if (JSON.stringify(ops).length < JSON.stringify(view).length * 0.6) {
        this.transport?.send({ t: 'patch', hid: view.hid, base: prev.v, v: view.v, ops }, peer);
        return true;
      }
    }
    this.sentViews.set(peer, view);
    this.transport?.send({ t: 'view', view }, peer);
    return true;
  }

  /**
   * The connection a person's views go on, when several networks reach them (as after the relay
   * dropped and the backup networks opened): the one in use while it answers, else the one heard
   * from last. Everything twice would be twice the data. A new one starts with a whole view: the
   * player takes patches only from the connection their last whole view came on.
   */
  private routeTo(cid: string): string | undefined {
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
  private routes = new Map<string, string>();

  /** A player's patch didn't fit: the whole view again (once a second at most, per connection). */
  private resync(peer: string) {
    const cid = this.peers.get(peer);
    const last = this.syncedAt.get(peer) ?? 0;
    if (cid === undefined || Date.now() - last < 1000) return;
    // (they're listening on this one: their views go here from now on)
    this.routes.set(cid, peer);
    this.syncedAt.set(peer, Date.now());
    this.sentViews.delete(peer);
    this.sendView(peer, wire(this.viewFor(this.displays.has(peer) ? null : cid)));
  }

  // ---- host handoff -----------------------------------------------------------------------

  /**
   * Queue a backup: soon after a trick or a hand ends, or when someone new must hold one (a holder
   * has gone); otherwise within BACKUP_EVERY_MS of the last.
   */
  private queueBackup() {
    if (!this.transport || !this.backupKey) return;
    const s = this.state;
    const trick = s?.zones.trick?.cards.length ?? 0;
    const ended = !!s && (s.phase !== this.seenPhase || (this.seenTrick > 0 && trick === 0));
    this.seenPhase = s?.phase;
    this.seenTrick = trick;
    const newHolder = this.backupHolders().some(([cid]) => !this.holders.includes(cid));
    const now = Date.now();
    const due = ended || newHolder ? now + BACKUP_SOON_MS : Math.max(now, this.backupAt + BACKUP_EVERY_MS);
    if (this.backupTimer) {
      if (this.backupDue <= due) return;
      clearTimeout(this.backupTimer);
    }
    this.backupDue = due;
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      void this.sendBackup();
    }, due - now);
  }

  /**
   * The players to hold backups, and the connection to send each one's on: seated people who could
   * take over (not bots, not table screens), connected now. Those already holding one come first, so
   * a backup isn't passed around; then in seat order.
   */
  private backupHolders(): [string, string][] {
    const reach = new Map<string, string>();
    for (const [peer, cid] of this.peers) if (!this.displays.has(peer) && !reach.has(cid)) reach.set(cid, peer);
    const people = this.lobby.seats.filter((x) => !x.bot && !x.host && reach.has(x.id)).map((x) => x.id);
    const order = [...people.filter((c) => this.holders.includes(c)), ...people.filter((c) => !this.holders.includes(c))];
    return order.slice(0, BACKUP_HOLDERS).map((cid) => [cid, reach.get(cid)!]);
  }

  private async sendBackup() {
    const v = this.v;
    const to = this.backupHolders();
    // (nothing new: only a new holder needs it)
    const fresh = v === this.backedUp ? to.filter(([cid]) => !this.holders.includes(cid)) : to;
    this.backupAt = Date.now();
    if (!fresh.length) return;
    const blob = await seal({ lobby: this.lobby, state: this.state, keys: this.keys }, this.backupKey!);
    this.backedUp = v;
    this.holders = to.map(([cid]) => cid);
    for (const [, peer] of fresh) this.transport?.send({ t: 'backup', blob, v, token: this.takeoverToken }, peer);
  }
}

function missing(id: string): never {
  throw new Error(`The rules for ${id} aren't loaded (loadRules first)`);
}
