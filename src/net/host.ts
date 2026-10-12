import { redact, redactActions, resolveAction } from '../engine/redact';
import { randomSeed } from '../engine/rng';
import { nightPoints, standingsOf } from '../engine/state';
import { RuleError, type Action, type GameModule, type GameState } from '../engine/types';
import { getGame, GAMES } from '../games';
import { AVATAR_COLORS, AVATAR_EMOJI, cleanAvatar, type Avatar, type ClientMsg, type Lobby, type LobbySeat, type Msg, type View } from './protocol';
import { seal } from './backup';
import type { Transport } from './transport';

export const LOCAL = 'local';
export const HEARTBEAT_MS = 3000;
/** A peer silent for this long is treated as gone (it keeps its seat and can come back). */
export const DEAD_AFTER_MS = 12000;
const UNDO = '__undo';
/** Host handoff: players get a fresh sealed backup at most this often. */
export const BACKUP_EVERY_MS = 2000;
const BOT_NAMES = ['Ada', 'Bix', 'Cleo', 'Dash', 'Echo', 'Fizz', 'Gus', 'Hux', 'Ivy'];

export interface HostSnapshot {
  lobby: Lobby;
  state: GameState | null;
}

/**
 * The authoritative game host. Runs on one device (the one that created the room), validates
 * every action and sends each device its own redacted view.
 */
export class Host {
  lobby: Lobby;
  state: GameState | null = null;
  private module: GameModule | null = null;
  private history: GameState[] = [];
  /** transport peer id → client id */
  private peers = new Map<string, string>();
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
  private readonly backupKey?: string;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private backedUp = -1;

  constructor(
    private transport: Transport | null,
    code: string,
    host: { cid: string; name: string; avatar?: Avatar },
    restore?: HostSnapshot,
    /** `takeover`: this device is a player taking over from a host that has gone. */
    opts: { backupKey?: string; takeover?: boolean } = {},
  ) {
    this.backupKey = opts.backupKey;
    if (restore) {
      this.lobby = restore.lobby;
      // (the table may have moved to a new code, if its old one turned out to be taken)
      this.lobby.code = code;
      const hostSeat = this.lobby.seats.find((s) => s.host);
      const mine = this.lobby.seats.find((s) => s.id === host.cid);
      if (opts.takeover && mine && hostSeat !== mine) {
        // the old host keeps their seat as a player (they can rejoin it), and we host from ours
        if (hostSeat) hostSeat.host = false;
        mine.host = true;
      } else if (hostSeat) {
        // the host may be resuming from a new browser session with a new client id
        hostSeat.id = host.cid;
        hostSeat.avatar = host.avatar ?? hostSeat.avatar;
      }
      this.lobby.seats.forEach((s) => (s.connected = !!s.bot || !!s.host));
      this.state = restore.state;
      if (this.state) this.module = getGame(this.state.game);
    } else {
      this.lobby = {
        code,
        gameId: 'holdem',
        options: defaultOptions(GAMES.holdem),
        seats: [{ id: host.cid, name: host.name, avatar: host.avatar, host: true, connected: true }],
        spectators: 0,
        started: false,
      };
    }
    if (transport) {
      transport.onMessage = (msg, from) => this.receive(from, msg);
      transport.onPeerLeave = (peer) => this.peerLeft(peer);
      transport.onPeerJoin = () => {};
      this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    }
    this.v = this.state?.v ?? 0;
  }

  get hostCid() {
    return this.lobby.seats.find((s) => s.host)!.id;
  }

  // ---- incoming -------------------------------------------------------------------------

  private receive(peer: string, raw: Msg) {
    const msg = raw as ClientMsg;
    const h = this.health.get(peer);
    if (h) h.seen = Date.now();
    if (msg.t === 'pong') {
      if (h && typeof msg.ts === 'number') h.rtt = Math.max(0, Math.round(performance.now() - msg.ts));
      return;
    }
    if (msg.t === 'hello') return this.hello(peer, String(msg.cid), String(msg.name ?? 'Player'), cleanAvatar(msg.avatar), msg.display);
    if (msg.t === 'act') {
      const cid = this.peers.get(peer);
      if (!cid) return;
      const err = this.act(cid, msg.a);
      if (err) this.transport?.send({ t: 'err', msg: err, seq: msg.seq }, peer);
    }
  }

  private hello(peer: string, cid: string, name: string, avatar: Avatar | undefined, display?: boolean) {
    if (display) {
      this.displays.add(peer);
      this.peers.set(peer, cid);
      this.health.set(peer, { rtt: null, seen: Date.now() });
      return this.broadcast();
    }
    // a client may reach us on more than one network; keep them all, they're the same seat
    if (!this.peers.has(peer)) this.backedUp = -1; // (someone new: they need a backup too)
    this.peers.set(peer, cid);
    this.health.set(peer, { rtt: this.health.get(peer)?.rtt ?? null, seen: Date.now() });
    const seat = this.lobby.seats.find((s) => s.id === cid);
    if (seat) {
      seat.connected = true;
      seat.avatar = avatar ?? seat.avatar;
      if (!this.lobby.started) seat.name = name.slice(0, 20);
    } else if (!this.lobby.started) {
      const max = this.module?.config.players.max ?? getGame(this.lobby.gameId).config.players.max;
      // a human takes the place of a bot if the table is full
      if (this.lobby.seats.length >= max) {
        const bot = this.lobby.seats.findIndex((s) => s.bot);
        if (bot >= 0) this.lobby.seats.splice(bot, 1);
      }
      if (this.lobby.seats.length < max) this.lobby.seats.push({ id: cid, name: name.slice(0, 20), avatar, connected: true });
    }
    this.broadcast();
  }

  /** Ping everyone; drop peers we haven't heard from in a while (faster than WebRTC notices). */
  private beat() {
    const now = Date.now();
    for (const [peer, h] of this.health) {
      if (now - h.seen > DEAD_AFTER_MS) {
        this.peerLeft(peer);
        continue;
      }
      this.transport?.send({ t: 'ping', ts: performance.now() }, peer);
    }
    const pings = this.pings();
    this.onPings(pings);
    this.transport?.send({ t: 'pings', pings });
  }

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
    const seat = this.lobby.seats.find((s) => s.id === cid);
    if (seat && ![...this.peers.values()].includes(seat.id)) {
      seat.connected = false;
      // before the game starts, leaving frees the seat
      if (!this.lobby.started) this.lobby.seats = this.lobby.seats.filter((s) => s !== seat);
    }
    this.broadcast();
  }

  // ---- actions ----------------------------------------------------------------------------

  /** Apply an action from a client id. Returns an error message if it was rejected. */
  act(cid: string, a: Action): string | null {
    const seat = this.lobby.seats.findIndex((s) => s.id === cid);
    if (!this.state || !this.module || seat < 0) return 'You are not seated';
    // face-down cards are referred to by placeholder ids; map them back to real cards
    const resolved = resolveAction(this.state, seat, a);
    if (!resolved) return 'The table changed — try again';
    return this.applyAs(seat, resolved);
  }

  private applyAs(seat: number, a: Action): string | null {
    const module = this.module!;
    if (a.type === UNDO) {
      const prev = this.history.pop();
      if (!prev) return 'Nothing to undo';
      this.state = prev;
      this.commit();
      return null;
    }
    const allowed = module.actions(this.state!, seat).some((s) => s.type === a.type);
    if (!allowed) return 'That move isn’t available right now';
    const next = structuredClone(this.state!);
    try {
      module.apply(next, seat, a);
    } catch (e) {
      if (e instanceof RuleError) return e.message;
      console.error(e);
      return 'Something went wrong';
    }
    if (module.config.undo) {
      this.history.push(this.state!);
      if (this.history.length > 30) this.history.shift();
    }
    this.state = next;
    this.commit();
    return null;
  }

  /** Bump version, persist, send views, then schedule any automatic steps. */
  private commit() {
    this.tally();
    this.broadcast();
    this.pump();
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
      results: this.lobby.seats.map((seat, i) => ({ id: seat.id, name: seat.name, place: places[i], points: nightPoints(places[i], places) })),
    });
  }

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
    const sys = module.system?.(s);
    if (sys) {
      this.timer = setTimeout(() => {
        const next = structuredClone(this.state!);
        sys.run(next);
        this.state = next;
        this.commit();
      }, sys.delay);
      return;
    }
    if (!module.bot) return;
    for (const p of s.players) {
      if (!p.bot) continue;
      const a = module.bot(s, p.seat);
      if (!a) continue;
      this.timer = setTimeout(() => {
        const err = this.applyAs(p.seat, a);
        if (!err) return;
        console.warn(`Bot ${p.name}: ${err}`, a);
        // never let a bot's mistake freeze the table: fall back to the most passive move on offer
        const offered = module.actions(this.state!, p.seat);
        const safe = ['check', 'call', 'pass', 'decline', 'go', 'fold'].map((t) => offered.find((o) => o.type === t)).find(Boolean);
        if (safe && !safe.select && !safe.amount && !safe.choose) this.applyAs(p.seat, { type: safe.type });
      }, 650 + Math.random() * 600);
      return;
    }
  }

  // ---- lobby controls (host device only) --------------------------------------------------

  setGame(gameId: string) {
    if (this.lobby.started) return;
    const g = getGame(gameId);
    this.lobby.gameId = gameId;
    this.lobby.options = defaultOptions(g);
    // trim bots that no longer fit
    while (this.lobby.seats.length > g.config.players.max && this.lobby.seats.some((s) => s.bot)) {
      const i = this.lobby.seats.map((s) => !!s.bot).lastIndexOf(true);
      this.lobby.seats.splice(i, 1);
    }
    if (!g.bot) this.lobby.seats = this.lobby.seats.filter((s) => !s.bot);
    this.broadcast();
  }

  setOption(id: string, value: number | boolean) {
    this.lobby.options[id] = value;
    this.broadcast();
  }

  addBot() {
    const g = getGame(this.lobby.gameId);
    if (!g.bot || this.lobby.seats.length >= g.config.players.max) return;
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

  /** The host changing their own name/avatar. */
  updateSelf(name: string, avatar?: Avatar) {
    const me = this.lobby.seats.find((s) => s.host)!;
    me.avatar = avatar;
    if (!this.lobby.started) me.name = name;
    this.broadcast();
  }

  canStart(): string | null {
    const g = getGame(this.lobby.gameId);
    const n = this.lobby.seats.length;
    if (n < g.config.players.min) return `${g.config.name} needs at least ${g.config.players.min} players`;
    if (n > g.config.players.max) return `${g.config.name} allows at most ${g.config.players.max} players`;
    const counts = g.config.players.counts;
    if (counts && !counts.includes(n)) return `${g.config.name} is for ${counts.join(' or ')} players`;
    return null;
  }

  start() {
    if (this.canStart()) return;
    this.module = getGame(this.lobby.gameId);
    this.lobby.started = true;
    this.history = [];
    this.state = this.module.setup(
      this.lobby.seats.map((s) => ({ name: s.name, bot: s.bot })),
      randomSeed(),
      { ...this.lobby.options },
    );
    this.commit();
  }

  /** Back to the lobby. */
  endGame() {
    if (this.timer) clearTimeout(this.timer);
    this.lobby.started = false;
    this.state = null;
    this.module = null;
    this.history = [];
    this.lobby.seats = this.lobby.seats.filter((s) => s.connected || s.host);
    this.broadcast();
  }

  /** Resume bots/system steps after restoring from a snapshot. */
  resume() {
    this.broadcast();
    this.pump();
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.transport?.leave();
  }

  // ---- outgoing ---------------------------------------------------------------------------

  viewFor(cid: string | null): View {
    const seat = cid ? this.lobby.seats.findIndex((s) => s.id === cid) : -1;
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
    };
    if (s && m?.config.undo && this.history.length && seat >= 0)
      view.actions.push({ type: UNDO, label: 'Undo', menu: true });
    return view;
  }

  broadcast() {
    this.v++;
    const seated = new Set(this.lobby.seats.map((s) => s.id));
    // a device can reach us on several networks: count devices (client ids), not connections
    const screens = new Set([...this.displays].map((p) => this.peers.get(p)));
    this.lobby.displays = screens.size;
    this.lobby.spectators = new Set([...this.peers.values()].filter((c) => !seated.has(c) && !screens.has(c))).size;
    if (this.state) this.state.v = this.v;
    this.onLocalView(this.viewFor(this.hostCid));
    if (this.transport) {
      for (const [peer, cid] of this.peers) {
        this.transport.send({ t: 'view', view: this.viewFor(this.displays.has(peer) ? null : cid) }, peer);
      }
    }
    this.onPersist({ lobby: this.lobby, state: this.state });
    this.queueBackup();
  }

  // ---- host handoff -----------------------------------------------------------------------

  /** Send seated players a sealed backup of the game soon (at most every BACKUP_EVERY_MS). */
  private queueBackup() {
    if (!this.transport || !this.backupKey || this.backupTimer) return;
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      void this.sendBackup();
    }, BACKUP_EVERY_MS);
  }

  private async sendBackup() {
    if (this.v === this.backedUp) return;
    const v = this.v;
    const blob = await seal({ lobby: this.lobby, state: this.state }, this.backupKey!);
    this.backedUp = v;
    // the players who could take over: seated people (not bots, not table screens)
    const players = new Set(this.lobby.seats.filter((x) => !x.bot && !x.host).map((x) => x.id));
    for (const [peer, cid] of this.peers) if (players.has(cid) && !this.displays.has(peer)) this.transport?.send({ t: 'backup', blob, v }, peer);
  }
}

export function defaultOptions(g: GameModule): Record<string, number | boolean> {
  return Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default]));
}
