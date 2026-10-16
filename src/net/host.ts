import { botView } from '../engine/botView';
import { isHidden, redact, redactActions, resolveAction } from '../engine/redact';
import { randomSeed } from '../engine/rng';
import { nightPoints, standingsOf } from '../engine/state';
import { RuleError, type Action, type GameModule, type GameState } from '../engine/types';
import { checkAction } from '../engine/validate';
import { getGame, GAMES, loadRules, rulesFor, startProblem } from '../games';
import { inlineBrain, type Brain, type Pick, type Thought } from './brain';
import { fallbackMoves } from '../engine/fallback';
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
  type NightFinal,
  type NightGame,
  type View,
  REACTIONS,
  type ScoreHistory,
} from './protocol';
import { seal } from './backup';
import { GameRecord, toCsv } from './gameRecord';
import { recordFormats, type ExportFormat } from './exports/formats';
import { ohh } from './exports/ohh';
import { pbn } from './exports/pbn';
import type { HandFormat } from './exports/types';
import { familyRules } from '../engine/types';
import { report } from './reports';
import type { Transport } from './transport';
import { diff } from './patch';

export const HEARTBEAT_MS = 3000;
/** A peer silent for this long is treated as gone (it keeps its seat and can come back). */
export const DEAD_AFTER_MS = 12000;
const UNDO = '__undo';
/** With take-backs on, bots and automatic steps wait this much longer after a person's move (time to take it back). */
export const TAKE_BACK_MS = 1500;
/** Anyone at the table can mute (amount 0) or unmute the table screens: a Chromecast has no menu of its own. */
export const SCREEN_SOUND = '__screenSound';
/** Anyone at the table can let a bot play for a player who has dropped (`seat`: their game seat) until they're back. */
export const STAND_IN = '__standIn';
/**
 * Host handoff: two players hold a sealed backup (one is enough to take over; two in case one has
 * gone too). It's sent when a trick or hand ends, and otherwise at most this often: a game night
 * lasts hours, and every backup costs the holders' data.
 */
export const BACKUP_EVERY_MS = 30000;
/** Backups after a trick or a hand wait this long, so a burst of moves makes one backup. */
export const BACKUP_SOON_MS = 1000;
export const BACKUP_HOLDERS = 2;
const BOT_NAMES = ['Ada', 'Bix', 'Cleo', 'Dash', 'Echo', 'Fizz', 'Gus', 'Hux', 'Ivy'];
/** A connection's hellos are handled at most this often; a burst is folded into its latest. */
export const HELLO_GAP_MS = 400;
/** How many different seats one connection may ask for in a minute (a client keeps one id). */
export const IDENTITIES_PER_MINUTE = 3;
/** Finished hands kept for replay, and the most moments kept of one hand. */
export const REPLAY_HANDS = 5;
/** The phases a hand ends in, across the families. */
const END_PHASES = new Set(['handOver', 'roundOver', 'gameOver']);
export const REPLAY_STEPS = 600;
/** Most moments kept across all the replay hands (each is a whole game state: memory adds up). */
export const REPLAY_TOTAL = 1200;
/** Replay frames one connection may ask for a second (stepping, or playing a hand back). */
const FRAMES_PER_SECOND = 20;
/** Most people at one table (more than any game seats: the rest sit out and rotate in). */
export const TABLE_MAX = 16;

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
  private readonly brain: Brain;
  /** Counts requests to the brain: an answer to an older one (the table has moved on) is ignored. */
  private thinking = 0;
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
  private timer: ReturnType<typeof setTimeout> | null = null;
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
    } = {},
  ) {
    this.brain = opts.brain ?? inlineBrain();
    this.brain.onError = (e, game, phase) => {
      console.error(e);
      report('bot', e, { game, phase, action: 'think' });
    };
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

  /** Ping everyone; drop peers we haven't heard from in a while (faster than WebRTC notices). */
  private beat() {
    const now = Date.now();
    // our own page was asleep (a phone locked, a tab in the background): nobody could be heard
    // meanwhile, so everyone gets a fresh chance to answer rather than all being dropped at once
    if (now - this.lastBeat > HEARTBEAT_MS * 3) for (const h of this.health.values()) h.seen = Math.max(h.seen, now);
    this.lastBeat = now;
    for (const [peer, h] of this.health) {
      if (now - h.seen > DEAD_AFTER_MS) {
        this.forget(peer);
        this.peerLeft(peer);
        continue;
      }
      // mid-game, views go out and moves come in all the time: they show both ends are there, so
      // a ping would only wake the radio (and the relay) for nothing. Every third beat pings anyway,
      // to keep the round-trip times fresh.
      const busy = h.rtt != null && now - h.seen < HEARTBEAT_MS && now - (this.sentAt.get(peer) ?? 0) < HEARTBEAT_MS;
      const skipped = this.pingSkips.get(peer) ?? 0;
      if (busy && skipped < 2) {
        this.pingSkips.set(peer, skipped + 1);
        continue;
      }
      this.pingSkips.set(peer, 0);
      this.transport?.send({ t: 'ping', ts: performance.now() }, peer);
    }
    // (everyone's phone hears about connections when they change, or every so often: not every beat)
    const pings = this.pings();
    const moved =
      pings.length !== this.sentPings.length ||
      pings.some((p, i) => (p == null) !== (this.sentPings[i] == null) || Math.abs((p ?? 0) - (this.sentPings[i] ?? 0)) > 25);
    if (!moved && ++this.quietBeats < 5) return;
    this.quietBeats = 0;
    this.sentPings = pings;
    this.onPings(pings);
    this.transport?.send({ t: 'pings', pings });
  }
  private sentPings: (number | null)[] = [];
  /** When each connection was last sent a view, and how many pings in a row it has gone without. */
  private sentAt = new Map<string, number>();
  private pingSkips = new Map<string, number>();
  private quietBeats = 0;
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
    this.pingSkips.delete(peer);
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
    this.rescued.clear();
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
    this.pump();
  }

  // ---- replays ------------------------------------------------------------------------------

  /** Finished hands of this game, oldest first: every moment of each, as the host saw it. */
  private hands: GameState[][] = [];
  /** The hand being played now, so far. */
  private recording: GameState[] | null = null;
  /** The whole game, move by move, for saving as a spreadsheet (see gameRecord.ts). */
  private gameRecord = new GameRecord();

  /** This game so far as CSV, for `cid`: the moves, and only their own cards. */
  exportCsv(cid: string | null): string | null {
    return this.exportFile(cid, 'csv');
  }

  /** This game so far as a file, for `cid`: the spreadsheet, or its game's standard record. */
  exportFile(cid: string | null, format: ExportFormat): string | null {
    const s = this.state;
    if (!s || !this.module || this.module.realtime) return null;
    const seat = this.gameSeat(cid);
    const names = s.players.map((p) => p.name);
    if (format === 'csv') return toCsv(this.gameRecord, seat, names);
    return this.gameRecord.write(format, seat, { names, table: this.lobby.code });
  }

  /** The move being made (for the standard records: who did what), while it's committed. */
  private move: { seat: number; action: Action } | undefined;

  /**
   * Keep each moment of the hand in play, for replays. A hand ends in one of the end phases every
   * family uses (or when the game shows a result banner); the next starts with the next deal. (Real-time games are a blur: not kept.)
   * The states are the host's own (each move makes a new one), so keeping them costs no copying.
   */
  private record() {
    const s = this.state;
    const m = this.module;
    if (!s || !m || m.realtime) return;
    const ended = END_PHASES.has(s.phase) || !!m.status(s, 0).banner;
    this.gameRecord.note(
      s,
      ended,
      () => {
        // (the result as someone watching sees it: no "you")
        try {
          return m.status(s, -1).banner?.lines ?? [];
        } catch {
          return [];
        }
      },
      this.move,
    );
    if (!ended) {
      this.recording ??= [];
      if (this.recording.length < REPLAY_STEPS && this.recording.at(-1) !== s) this.recording.push(s);
      return;
    }
    if (!this.recording) return;
    this.noteScores();
    this.recording.push(s);
    this.hands.push(this.recording);
    if (this.hands.length > REPLAY_HANDS) this.hands.shift();
    while (this.hands.length > 1 && this.hands.reduce((n, h) => n + h.length, 0) > REPLAY_TOTAL) this.hands.shift();
    this.recording = null;
  }

  /** Add everyone's total now to the game's score history (at the deal, and as each hand ends). */
  private noteScores(atDeal = false) {
    const t = this.module && this.state ? totalsOf(this.module, this.state, atDeal) : null;
    if (!t) return;
    const h = this.lobby.scores;
    if (!h || h.names.join('|') !== t.names.join('|')) this.lobby.scores = { names: t.names, totals: [t.totals] };
    else {
      h.totals.push(t.totals);
      // (the deal and the latest hands: a long poker night stays small)
      if (h.totals.length > SCORE_HANDS + 1) h.totals.splice(1, 1);
    }
  }

  /**
   * A moment of a finished hand, as `cid` saw it then: their own cards, and everyone else's only
   * if they were shown. `hand` counts back from the latest (0); `step` is clamped to the hand.
   */
  frame(cid: string | null, hand: number, step: number): Frame | null {
    const m = this.module;
    const hands = this.hands.length;
    if (!m || !hands || !Number.isInteger(hand) || !Number.isInteger(step)) return null;
    const h = Math.max(0, Math.min(hands - 1, hand));
    const frames = this.hands[hands - 1 - h];
    const at = Math.max(0, Math.min(frames.length - 1, step));
    const seat = this.gameSeat(cid);
    const s = frames[at];
    return { hand: h, hands, step: at, steps: frames.length, state: redact(m, s, seat), status: m.status(s, seat) };
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
    const s = this.state;
    const m = this.module;
    if (!s || !m) return;
    if (s.phase !== 'gameOver') {
      s.tallied = false;
      return;
    }
    if (s.tallied || !s.winner?.length) return;
    s.tallied = true;
    const places = standingsOf(m, s);
    this.lobby.night ??= { games: [] };
    this.lobby.night.games.push({
      game: m.config.id,
      name: m.config.name,
      at: Date.now(),
      results: this.players().map((seat, i) => ({ id: seat.id, name: seat.name, place: places[i], points: nightPoints(places[i], places) })),
      final: finalScores(m, s),
    });
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

  /** Run system steps (e.g. collecting a trick) and bot moves after a natural pause. */
  private pump() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.state;
    const module = this.module;
    if (!s || !module) return;
    if (module.realtime) return this.pumpRealtime(s, module);
    const sys = module.system?.(s);
    // (a move that can still be taken back: give its player a moment before the table moves on)
    const grace = this.takeBack?.after === s ? TAKE_BACK_MS : 0;
    if (sys) {
      this.timer = setTimeout(() => this.runSystem(sys, module), sys.delay + grace);
      return;
    }
    if (!module.bot) return;
    // (only bots with a move on offer: no sending the whole game off to think on a person's turn)
    const seats = s.players.filter((p) => p.bot && module.actions(s, p.seat).some((a) => !a.menu)).map((p) => p.seat);
    if (!seats.length) return;
    // bots think (in the background, in the app), then move after a natural pause
    const turn = ++this.thinking;
    const asked = Date.now();
    const pause = 650 + Math.random() * 600 + grace;
    const then = (pick: Thought) => {
      if (this.closed || turn !== this.thinking || this.state !== s || !pick) return; // (the table moved on)
      const wait = Math.max(0, pause - (Date.now() - asked));
      // a bot that failed still moves: something plain and legal (see rescue)
      this.timer = setTimeout(() => (pick === 'failed' ? this.rescue(seats) : this.botMove(module, pick)), wait);
    };
    // each bot sees only its own seat's view (botView.ts); its answer comes back to the real deal
    const views = new Map(seats.map((seat) => [seat, botView(module, s, seat)]));
    const back = (pick: Thought): Thought => {
      if (!pick || pick === 'failed') return pick;
      const action = resolveAction(s, pick.seat, views.get(pick.seat)!.unfill(pick.action));
      return action ? { seat: pick.seat, action } : 'failed';
    };
    let pick: ReturnType<Brain['think']>;
    try {
      pick = this.brain.think(module.config.id, Object.fromEntries([...views].map(([seat, v]) => [seat, v.view])), seats);
    } catch (e) {
      this.brain.onError(e, module.config.id, s.phase);
      pick = 'failed';
    }
    if (pick instanceof Promise)
      void pick.then(
        (p) => then(back(p)),
        (e) => {
          this.brain.onError(e, module.config.id, s.phase);
          then('failed');
        },
      );
    else then(back(pick));
  }

  private botMove(module: GameModule, { seat, action: a }: Pick) {
    const err = this.applyAs(seat, a);
    if (!err) return this.rescued.clear();
    console.warn(`Bot ${seat}: ${err}`, a);
    // (a bot proposing a move the rules refuse is a bug in the bot)
    report('bot', new Error(err), { game: module.config.id, phase: this.state?.phase ?? '', action: a.type });
    this.rescue([seat]);
  }

  /**
   * Never let a bot's mistake freeze the table: the first of these bots with anything to do makes
   * the plainest legal move on offer (see fallbackMoves), trying each until the rules accept one.
   */
  private rescue(seats: number[]) {
    const m = this.module;
    if (!m || !this.state) return;
    // (bots it has already moved for go last: some moves stay on offer once made, like a pass
    // that can be changed until everyone has passed, and each stuck bot needs its turn)
    const order = [...seats.filter((x) => !this.rescued.has(x)), ...seats.filter((x) => this.rescued.has(x))];
    for (const seat of order)
      for (const a of fallbackMoves(m.actions(this.state, seat)))
        if (!this.applyAs(seat, a)) {
          if (this.rescued.size >= seats.length) this.rescued.clear();
          this.rescued.add(seat);
          return;
        }
  }
  /** Bots `rescue` has moved for since anyone else moved. */
  private rescued = new Set<number>();

  /** Real-time games: each bot's planned move, its key (to tell when the plan changes) and its timer. */
  private botPlans = new Map<number, { key: string; timer: ReturnType<typeof setTimeout> }>();

  /**
   * Real-time games: the system step on its own timer, and every bot on its own, all at once. A
   * bot keeps its timer while its plan stays the same (so a busy table doesn't keep pushing its
   * reaction back), and starts a new one when the plan changes.
   */
  private pumpRealtime(s: GameState, module: GameModule) {
    const sys = module.system?.(s);
    if (sys)
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.state && this.module === module) this.runSystem(sys, module);
      }, sys.delay);
    const keyOf = (a: Action) => JSON.stringify({ ...a, rt: undefined, at: undefined });
    for (const p of s.players) {
      if (!p.bot) continue;
      const a = this.think(module, s, p.seat);
      const plan = this.botPlans.get(p.seat);
      if (!a) {
        if (plan) clearTimeout(plan.timer);
        this.botPlans.delete(p.seat);
        continue;
      }
      const key = keyOf(a);
      if (plan?.key === key) continue;
      if (plan) clearTimeout(plan.timer);
      const delay = Math.max(0, module.botDelay?.(s, p.seat, a) ?? 600);
      const timer = setTimeout(() => {
        this.botPlans.delete(p.seat);
        if (!this.state || this.module !== module) return;
        // still what it means to do?
        const again = this.think(module, this.state, p.seat);
        if (!again || keyOf(again) !== key) return this.pump();
        const err = this.applyAs(p.seat, { ...a, rt: delay, at: Date.now() });
        if (err) {
          // (in a real-time game the table can move on under a bot: just think again)
          this.pump();
        }
      }, delay);
      this.botPlans.set(p.seat, { key, timer });
    }
  }

  /** A bot's next move; a bot that throws is reported and sits this one out, not the whole table. */
  private think(module: GameModule, s: GameState, seat: number): Action | null {
    try {
      const v = botView(module, s, seat);
      const a = module.bot?.(v.view, seat);
      return a ? resolveAction(s, seat, v.unfill(a)) : null;
    } catch (e) {
      console.error(e);
      report('bot', e, { game: module.config.id, phase: s.phase, action: 'think' });
      return null;
    }
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

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.thinking++;
    for (const plan of this.botPlans.values()) clearTimeout(plan.timer);
    this.botPlans.clear();
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
    this.hands = [];
    this.recording = null;
    this.gameRecord = new GameRecord(standardFormats(this.module.config));
    this.state = this.module.setup(
      players.map((s) => ({ name: s.name, bot: s.bot })),
      randomSeed(),
      { ...this.lobby.options },
    );
    delete this.lobby.scores;
    if (!this.module.realtime) this.noteScores(true);
    this.commit();
  }

  /** Back to the lobby. */
  endGame() {
    this.clearTimers();
    this.lobby.started = false;
    this.state = null;
    this.module = null;
    this.history = [];
    this.hands = [];
    this.recording = null;
    this.gameRecord = new GameRecord();
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
    this.pump();
  }

  close() {
    this.closed = true;
    this.clearTimers();
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
      ...(s && this.hands.length ? { replays: this.hands.length } : {}),
      // (the hand on the table has just finished: offer to replay it)
      ...(s && this.hands.at(-1)?.at(-1) === s ? { handDone: true as const } : {}),
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
      // one view per person (or table screen), however many networks reach them
      const views = new Map<string | null, View>();
      const now = Date.now();
      for (const [peer, cid] of this.peers) {
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
      const ops = diff(prev, view);
      // nothing they can see has changed (someone else's move that's hidden from them): only the
      // version number moved, so send nothing (the next patch still fits what they have)
      if (ops.every(([, path]) => VERSION_PATHS.has(path.join('.')))) return false;
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

  /** A player's patch didn't fit: the whole view again (once a second at most, per connection). */
  private resync(peer: string) {
    const cid = this.peers.get(peer);
    const last = this.syncedAt.get(peer) ?? 0;
    if (cid === undefined || Date.now() - last < 1000) return;
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

/** Where a view carries its version number. */
const VERSION_PATHS = new Set(['v', 'state.v']);

/** A copy of a view as it goes over the wire (JSON: what's undefined isn't there). */
const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Hands kept in the score history (after the deal). */
export const SCORE_HANDS = 300;

/**
 * Everyone's running total, as the scoreboard shows it to someone watching (its last column), or
 * their chips in a chip game. Null when there's no number to follow (a game with no running score).
 */
export function totalsOf(m: GameModule, s: GameState, atDeal = false): (Omit<ScoreHistory, 'totals'> & { totals: number[] }) | null {
  try {
    // (at the deal, before the blinds and antes went in: everyone's starting chips)
    if (atDeal && m.config.chips) return { names: s.players.map((p) => p.name), totals: s.players.map(() => m.config.chips!.start) };
    const board = m.status(s, -1).scoreboard;
    if (board?.rows.length) {
      const totals = board.rows.map((r) => toNumber(r.values.at(-1)));
      if (totals.every((x) => x !== null)) return { names: board.rows.map((r) => r.name), totals: totals as number[] };
    }
    if (m.config.chips) return { names: s.players.map((p) => p.name), totals: s.players.map((p) => p.chips) };
  } catch {
    /* (a status that fails is reported elsewhere) */
  }
  return null;
}

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m =
    typeof v === 'string'
      ? v
          .replace(/[,\s]/g, '')
          .replace('−', '-')
          .match(/^-?\d+(\.\d+)?$/)
      : null;
  return m ? Number(m[0]) : null;
};

/** A finished game's own scores, as someone watching sees them (nothing private: it's over). */
function finalScores(m: GameModule, s: GameState): NightFinal | undefined {
  try {
    const st = m.status(s, -1);
    const board =
      st.scoreboard ??
      (m.config.chips
        ? {
            columns: ['Chips'],
            rows: [...s.players]
              .sort((a, b) => b.chips - a.chips)
              .map((p) => ({ name: p.name, values: [p.chips.toLocaleString()], highlight: !!s.winner?.includes(p.seat) })),
          }
        : null);
    const out = cleanFinal({
      columns: board?.columns ?? [],
      rows: board?.rows.map((r) => ({ ...r, values: r.values.map(String) })) ?? [],
      lines: st.banner?.lines ?? [],
    });
    return out && (out.rows.length || out.lines.length) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** A game's final scores, size-limited and checked (they come from another device on a merge). */
function cleanFinal(x: unknown): NightFinal | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const f = x as Record<string, unknown>;
  const strs = (a: unknown, n: number, len: number) =>
    Array.isArray(a)
      ? a
          .slice(0, n)
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.slice(0, len))
      : [];
  const rows = Array.isArray(f.rows)
    ? f.rows.slice(0, TABLE_MAX).flatMap((r) => {
        if (!r || typeof r !== 'object') return [];
        const { name, values, highlight } = r as Record<string, unknown>;
        return typeof name === 'string' ? [{ name: name.slice(0, 40), values: strs(values, 8, 24), ...(highlight === true ? { highlight: true } : {}) }] : [];
      })
    : [];
  return { columns: strs(f.columns, 8, 24), rows, lines: strs(f.lines, 12, 120) };
}

/** A finished game from another device, checked field by field (it goes into everyone's tally). */
function cleanNightGame(x: unknown): NightGame | null {
  if (!x || typeof x !== 'object') return null;
  const g = x as Record<string, unknown>;
  if (typeof g.game !== 'string' || typeof g.name !== 'string' || typeof g.at !== 'number' || !Number.isFinite(g.at) || !Array.isArray(g.results)) return null;
  const results: NightGame['results'] = [];
  for (const r of g.results.slice(0, TABLE_MAX)) {
    if (!r || typeof r !== 'object') return null;
    const { id, name, place, points } = r as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof place !== 'number' || typeof points !== 'number') return null;
    if (!Number.isFinite(place) || !Number.isFinite(points)) return null;
    results.push({ id: id.slice(0, 64), name: name.slice(0, 20), place, points });
  }
  const final = cleanFinal(g.final);
  return { game: g.game.slice(0, 40), name: g.name.slice(0, 40), at: g.at, results, ...(final ? { final } : {}) };
}

/** The standard record formats a game is followed in (see exports/formats.ts). */
function standardFormats(config: GameModule['config']): Partial<Record<ExportFormat, HandFormat<unknown>>> {
  const out: Partial<Record<ExportFormat, HandFormat<unknown>>> = {};
  for (const f of recordFormats(config)) {
    if (f === 'pbn') out.pbn = pbn as HandFormat<unknown>;
    if (f === 'ohh') out.ohh = ohh(familyRules(config, 'poker')) as HandFormat<unknown>;
  }
  return out;
}

function missing(id: string): never {
  throw new Error(`The rules for ${id} aren't loaded (loadRules first)`);
}

/**
 * The game a split-off table starts on (it came over the network, so only a game we have, and
 * only that game's own settings with values of the right kind; the rest are its defaults).
 */
function carriedGame(game: unknown): { id: string; options: Record<string, number | boolean> } | null {
  if (!game || typeof game !== 'object') return null;
  const { id, options } = game as { id?: unknown; options?: unknown };
  if (typeof id !== 'string' || !Object.hasOwn(GAMES, id)) return null;
  const given = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
  const out = defaultOptions(GAMES[id]);
  for (const o of GAMES[id].config.options ?? []) {
    const v = given[o.id];
    if (typeof v === typeof o.default && (typeof v !== 'number' || Number.isFinite(v))) out[o.id] = v as number | boolean;
  }
  return { id, options: out };
}

export function defaultOptions(g: { config: GameModule['config'] }): Record<string, number | boolean> {
  return Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default]));
}
