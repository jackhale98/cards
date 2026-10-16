import type { Action } from './engine/types';
import { EXPORT_FILE, type ExportFormat } from './net/exports/formats';
import { newBackupKey, open as openBackup } from './net/backup';
import { workerBrain, type Brain } from './net/brain';
import { Client } from './net/client';
import { loadRules } from './games';
import type { Host, HostSnapshot } from './net/host';
import { AVATAR_COLORS, AVATAR_EMOJI, cleanAvatar, makeRoomCode, type Avatar, type Frame, type Night, type View } from './net/protocol';
import type { MultiTransport, NetworkStatus } from './net/multiTransport';
import type { RelayTransport } from './net/relayTransport';
import { noteGames } from './ui/record';
import { createTransport, FALLBACK_AFTER_MS, RELAY_GRACE_MS, type TransportKind } from './net/transport';

/** The host's table is saved this long after a change (and at once when the page is hidden). */
const SAVE_AFTER_MS = 800;
/** A guest that has lost the host for this long rebuilds its connection from scratch. */
const REJOIN_AFTER_MS = 8000;
/** A host gone this long can be taken over by a player (the relay itself waits 20s). */
export const TAKEOVER_OFFER_MS = 25_000;

export type Route =
  | { name: 'home'; code?: string }
  | { name: 'room'; code: string }
  | { name: 'display'; code: string }
  /** A TV waiting to be paired with a table (`/tv`, or a Chromecast at `/?cast=1`). */
  | { name: 'tv' };

/** The lobby buttons (see App.controls). */
export interface TableControls {
  setGame(id: string): void;
  setOption(id: string, value: number | boolean): void;
  addBot(): void;
  setPlaying(id: string, on: boolean): void;
  moveSeat(id: string, dir: -1 | 1): void;
  removeSeat(id: string): void;
  start(): void;
  endGame(): void;
  setLook(look: { back: string; cloth: string }): void;
  setTakeBacks(on: boolean): void;
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/** Per-tab secret that claims a table code on the relay while this tab hosts it (kept across reloads). */
function hostKey(fresh = false): string {
  try {
    let key = fresh ? null : sessionStorage.getItem('cards.hostKey');
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem('cards.hostKey', key);
    }
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Per-tab secret that holds our seat at a table (the client id is public; this is only ever sent
 * to the host). Lives exactly as long as the client id.
 */
function seatKey(): string {
  try {
    let key = sessionStorage.getItem('cards.seatKey');
    if (!key) {
      key = newBackupKey();
      sessionStorage.setItem('cards.seatKey', key);
    }
    return key;
  } catch {
    return fallbackKey;
  }
}
const fallbackKey = newBackupKey();

/** Take on a client id and seat key for this tab (one an earlier tab or session held). */
function useIdentity(cid: string, key?: string, host?: string) {
  try {
    sessionStorage.setItem('cards.cid', cid);
    if (key) sessionStorage.setItem('cards.seatKey', key);
    if (host) sessionStorage.setItem('cards.hostKey', host);
  } catch {
    /* private mode */
  }
}

/**
 * While a tab uses a client id it holds a lock named after it, so another tab can tell the id is
 * taken (see inUse). Browsers without Web Locks skip this.
 */
let tabLock = 0;
let releaseTab: (() => void) | null = null;
function holdIdentity(cid: string) {
  const mine = ++tabLock;
  releaseTab?.();
  releaseTab = null;
  try {
    // (a request that's granted after we've moved on to another id lets go at once)
    void navigator.locks?.request(`cards.tab.${cid}`, () => (tabLock === mine ? new Promise<void>((r) => (releaseTab = r)) : undefined));
  } catch {
    /* no Web Locks */
  }
}
async function inUse(cid: string): Promise<boolean> {
  try {
    return !!(await navigator.locks?.query())?.held?.some((l) => l.name === `cards.tab.${cid}`);
  } catch {
    return false;
  }
}

/**
 * The seat this device last held at each table (code → client id and seat key), so closing the tab
 * (or the whole browser) doesn't cost you your seat: open the table again and you sit back down.
 */
interface HeldSeat {
  cid: string;
  key: string;
  at: number;
}
const HELD_FOR_MS = 12 * 3600_000;
function heldSeats(): Record<string, HeldSeat> {
  try {
    const all = JSON.parse(store.get('cards.seats') ?? '{}') as Record<string, HeldSeat>;
    return Object.fromEntries(
      Object.entries(all).filter(([, s]) => s && typeof s.cid === 'string' && typeof s.key === 'string' && Date.now() - s.at < HELD_FOR_MS),
    );
  } catch {
    return {};
  }
}
function rememberSeat(code: string, cid: string, key: string) {
  const all = heldSeats();
  all[code] = { cid, key, at: Date.now() };
  // (the latest few tables are plenty)
  const keep = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 8);
  store.set('cards.seats', JSON.stringify(Object.fromEntries(keep)));
}

/** Per-tab client id: survives a reload (so you keep your seat) but differs between tabs. */
function clientId(): string {
  try {
    let id = sessionStorage.getItem('cards.cid');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('cards.cid', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * The link friends are sent: the code rides in the query (`?join=CODE`), which survives being
 * pasted into any app; some drop everything after a `#`. Other query flags (`net=…`) are kept.
 */
export function inviteUrl(code: string): string {
  const q = new URLSearchParams(location.search);
  q.delete('join');
  q.set('join', code);
  return `${location.origin}${location.pathname}?${q}`;
}

/** Arrived by an invite (`?join=CODE`): turn it into the join route, so the code doesn't linger in the address. */
function takeInvite() {
  const q = new URLSearchParams(location.search);
  const code = q.get('join');
  if (!code) return;
  q.delete('join');
  const rest = q.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}#/join/${code}`);
}

export function parseHash(hash = location.hash): Route {
  const [, kind, code] = hash.replace(/^#\/?/, '/').split('/');
  if (kind === 'room' && code) return { name: 'room', code: code.toUpperCase() };
  if (kind === 'display' && code) return { name: 'display', code: code.toUpperCase() };
  if (kind === 'join' && code) return { name: 'home', code: code.toUpperCase() };
  if (kind === 'tv' || /\/tv\/?$/.test(location.pathname) || new URLSearchParams(location.search).has('cast')) return { name: 'tv' };
  return { name: 'home' };
}

function loadAvatar(): Avatar {
  try {
    const saved = cleanAvatar(JSON.parse(store.get('cards.avatar') ?? 'null'));
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { emoji: pick(AVATAR_EMOJI), color: pick(AVATAR_COLORS) };
}

interface SavedHost {
  code: string;
  /** Tab that hosts it; other tabs on this device join as normal players. */
  cid: string;
  /** That tab's seat key (to sit back down as a player if someone took over meanwhile). */
  key?: string;
  /** Its claim on the code at the relay: a new tab resuming the table brings the same claim. */
  hostKey?: string;
  snap: HostSnapshot;
  at: number;
}

class App {
  /** Where the host's bots think: a background worker, started on first use and kept. */
  private get brain(): Brain {
    return (this._brain ??= workerBrain());
  }
  private _brain: Brain | null = null;
  route = $state<Route>((takeInvite(), parseHash()));
  name = $state(store.get('cards.name') ?? '');
  avatar = $state.raw<Avatar>(loadAvatar());
  view = $state.raw<View | null>(null);
  isHost = $state(false);
  /** This device is opening its own table (its screen says so, not "Finding table"). */
  starting = $state(false);
  connected = $state(false);
  toast = $state<{ text: string; id: number } | null>(null);
  /** Host → player round-trip times by seat (ms; host 0, bots/unknown null). */
  pings = $state.raw<(number | null)[]>([]);
  /** The latest reaction at the table: who (lobby seat id), which (REACTIONS index), and when. */
  reaction = $state.raw<{ id: string; e: number; at: number } | null>(null);
  /** Relay networks in use and how many of their relays are reachable. */
  netStatus = $state.raw<NetworkStatus | null>(null);
  /** With a table screen connected, show just your hand and private info on this phone. */
  handMode = $state(store.get('cards.handMode') !== 'off');
  /** When this device started trying to join the current table (for the "Finding table" screen). */
  joinStarted = $state(0);
  cid = clientId();
  readonly net: TransportKind = (['local', 'relay', 'public'] as const).find((k) => k === new URLSearchParams(location.search).get('net')) ?? 'p2p';

  host: Host | null = null;
  private client: Client | null = null;
  private currentCode: string | null = null;
  private transport: MultiTransport | null = null;
  private addNext: (() => Promise<boolean>) | null = null;
  private addAll: (() => Promise<void>) | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;
  private lostSince = 0;
  /** The host has been gone a while and we hold a backup: offer to take over the table. */
  canTakeOver = $state(false);
  /** When we lost the host (kept through reconnect attempts, unlike lostSince). */
  private hostGoneSince = 0;
  takingOver = $state(false);

  constructor() {
    addEventListener('hashchange', () => {
      this.route = parseHash();
      void this.sync();
    });
    holdIdentity(this.cid);
    // (a page going away writes the table first: see saveSoon)
    addEventListener('pagehide', () => this.saveNow());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.saveNow());
    // a phone waking up says hello straight away instead of waiting for the next retry
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.client?.nudge();
    });
  }

  setHandMode(on: boolean) {
    this.handMode = on;
    store.set('cards.handMode', on ? null : 'off');
  }

  setName(n: string) {
    this.setProfile(n, this.avatar);
  }

  /** Save name/avatar locally and tell the table, if we're at one. */
  setProfile(name: string, avatar: Avatar) {
    this.name = name.slice(0, 20);
    avatar = { emoji: avatar.emoji, color: avatar.color };
    this.avatar = avatar;
    store.set('cards.name', this.name);
    store.set('cards.avatar', JSON.stringify(avatar));
    this.host?.updateSelf(this.name || 'Host', avatar);
    this.client?.updateProfile(this.name || 'Player', avatar);
  }

  /** Games this device hosted most recently (newest first), for the picker. */
  get recentGames(): string[] {
    try {
      const list = JSON.parse(store.get('cards.recent') ?? '[]');
      return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  noteGame(id: string) {
    store.set('cards.recent', JSON.stringify([id, ...this.recentGames.filter((x) => x !== id)].slice(0, 4)));
  }

  get savedHost(): SavedHost | null {
    const raw = store.get('cards.host');
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw) as SavedHost;
      // forget tables idle for more than 12 hours
      return Date.now() - saved.at < 12 * 3600_000 ? saved : null;
    } catch {
      return null;
    }
  }

  go(hash: string) {
    location.hash = hash;
  }

  /** Bring connections in line with the current route. */
  async sync() {
    const r = this.route;
    if (r.name === 'home' || r.name === 'tv') return this.leave(false);
    if (this.currentCode === r.code) return;
    this.leave(false);
    this.currentCode = r.code;
    const saved = this.savedHost;
    const resume = saved?.code === r.code ? saved.snap : undefined;
    if (r.name === 'room' && this.pendingHostCode === r.code) {
      this.pendingHostCode = null;
      await this.startHost(r.code, resume, { resuming: !!resume });
    } else if (r.name === 'room' && resume && saved?.cid === this.cid) await this.startHost(r.code, resume, { resuming: true });
    else await this.startClient(r.code, r.name === 'display');
  }

  /** Code of a room this device just created (so sync() hosts it rather than joining). */
  private pendingHostCode: string | null = null;
  /** Hosting a table split off from another: tonight's tally so far, and where it came from. */
  private pendingSplit: { code: string; night?: Night; parent?: string; game?: { id: string; options: Record<string, number | boolean> } } | null = null;
  /** Heading back to the table we split off from (`to`), with the games we played meanwhile. */
  private returning: { to: string; from: string; night: Night } | null = null;

  /**
   * The host split the table (or our split-off table is heading back): go to the other table, as
   * its host if we were picked to host it.
   */
  private moveTable(m: {
    code: string;
    host?: boolean;
    night?: Night;
    parent?: string;
    back?: boolean;
    game?: { id: string; options: Record<string, number | boolean> };
  }) {
    const from = this.currentCode;
    if (!from || m.code === from) return;
    if (m.back && m.night) this.returning = { to: m.code, from, night: m.night };
    if (m.host) {
      this.forgetSaved();
      this.pendingHostCode = m.code;
      this.pendingSplit = { code: m.code, night: m.night, parent: m.parent, game: m.game };
      this.say(`You're hosting a new table, ${m.code} — your group is on its way`);
    } else this.say(m.back ? `Back to table ${m.code}` : `Moving to table ${m.code}`);
    this.go(`/room/${m.code}`);
  }

  /** Our split-off table heads back to the table it came from (host only): everyone, us included. */
  goBack() {
    const parent = this.view?.lobby.parent;
    const from = this.currentCode;
    if (!this.host || !parent || !from) return;
    this.host.goBack();
    this.returning = { to: parent, from, night: this.view?.lobby.night ?? { games: [] } };
    this.forgetSaved();
    // (a moment for the message to reach everyone before this table closes)
    setTimeout(() => this.go(`/room/${parent}`), 400);
  }

  /** The card back and cloth this device last chose as host: new tables start with them. */
  get savedLook(): { back: string; cloth: string } | null {
    try {
      const l = JSON.parse(store.get('cards.look') ?? 'null');
      return l && typeof l.back === 'string' && typeof l.cloth === 'string' ? l : null;
    } catch {
      return null;
    }
  }
  setLook(look: { back: string; cloth: string }) {
    store.set('cards.look', JSON.stringify(look));
    this.host?.setLook(look);
  }

  /** This device hosts as the table screen (a laptop or tablet in the middle) rather than as a player. */
  get hostScreen(): boolean {
    return this.isHost && !!this.view?.lobby.seats.find((s) => s.host)?.screen;
  }
  /** The host plays, or this device is the table screen (remembered for the next table it hosts). */
  setScreen(on: boolean) {
    store.set('cards.hostScreen', on ? '1' : null);
    this.host?.setScreen(on);
  }

  /** Split the table (host only): these people go to a new table that `newHost` hosts. */
  split(ids: string[], newHost: string) {
    const code = this.host?.split(ids, newHost);
    if (code) this.say(`${ids.length} ${ids.length === 1 ? 'player is' : 'players are'} off to table ${code}`);
  }

  createRoom() {
    this.forgetSaved();
    const code = makeRoomCode();
    this.pendingHostCode = code;
    this.go(`/room/${code}`);
  }

  /**
   * The relay says someone else is already hosting this code (rare: 3.2 million codes). Move our
   * table, as it stands, to a fresh code; anyone who joined with the old one will need the new one.
   */
  private codeTaken(code: string) {
    if (this.currentCode !== code || !this.isHost) return;
    // (the table as it stands now, written at once: it moves to the new code)
    this.saveNow();
    const saved = this.savedHost;
    const next = makeRoomCode();
    if (saved?.code === code) store.set('cards.host', JSON.stringify({ ...saved, code: next, at: Date.now() } satisfies SavedHost));
    else this.forgetSaved();
    this.say('That table code was already in use — here’s a new one');
    this.pendingHostCode = next;
    this.go(`/room/${next}`);
  }

  /** Re-open the table this device was hosting (e.g. after the browser was closed). */
  resumeRoom(code: string) {
    this.pendingHostCode = code;
    this.go(`/room/${code}`);
  }

  private async startHost(code: string, restore?: HostSnapshot, how: { resuming?: boolean; takeover?: boolean } = {}) {
    this.starting = true;
    try {
      await this.openHost(code, restore, how);
    } finally {
      this.starting = false;
    }
  }

  private async openHost(code: string, restore?: HostSnapshot, how: { resuming?: boolean; takeover?: boolean } = {}) {
    const saved = this.savedHost;
    // resuming in a new tab (the browser was closed): host as the tab that saved the table did, with
    // its seat and its claim on the code (a new claim would be told the code is taken)
    if (how.resuming && saved?.code === code && saved.cid !== this.cid && !(await inUse(saved.cid))) this.becomeId(saved.cid, saved.key, saved.hostKey);
    if (this.currentCode !== code) return;
    // a table we were hosting that someone else now hosts (they took over while we were gone): join
    // it. (A brand-new table whose code turns out to be in use moves to a new code instead.)
    const seatId = saved?.cid;
    const seatKeyThen = saved?.key;
    const onTaken = () =>
      how.resuming || how.takeover || this.host?.state || (this.host?.lobby.seats.length ?? 1) > 1
        ? this.tableMoved(code, seatId ?? this.cid, seatKeyThen ?? seatKey())
        : this.codeTaken(code);
    // (the table opens without waiting for the connection to everyone else: it's attached below,
    // when it's ready, so a slow network never holds up the host's own screen)
    const joining = createTransport(this.net, code, 'host', { key: hostKey(), onTaken }).catch((e) => {
      console.warn('Network unavailable, hosting offline', e);
      return null;
    });
    // a game in progress needs its rules before the table can reopen
    // (the route may change while we wait: leave the connection once it comes)
    const gone = () => void joining.then((j) => j?.transport.leave());
    if (restore?.state) {
      try {
        await loadRules(restore.state.game);
      } catch {
        this.say('Couldn’t load the rules for this game — check your connection');
        return gone();
      }
      if (this.currentCode !== code) return gone();
    }
    // (the host's code loads when a table is first hosted: the home screen doesn't need it)
    const { Host } = await import('./net/host');
    if (this.currentCode !== code) return gone();
    const split = this.pendingSplit?.code === code ? this.pendingSplit : null;
    this.pendingSplit = null;
    const host = new Host(null, code, { cid: this.cid, name: this.name || 'Host', avatar: this.avatar, key: seatKey() }, restore, {
      brain: this.brain,
      takeover: how.takeover,
      night: split?.night,
      parent: split?.parent,
      game: split?.game,
    });
    host.onPings = (p) => (this.pings = p);
    host.onReact = (id, e) => (this.reaction = { id, e, at: Date.now() });
    host.onLocalError = (m) => this.say(m);
    // clone so the UI gets fresh objects, exactly like a remote client would
    host.onLocalView = (v) => {
      this.view = structuredClone(v);
      this.noteRecord(v);
    };
    // (saved a moment after each change, not on every one: the whole game is a lot to write; and at
    // once when the page is hidden or closed)
    host.onPersist = (snap) =>
      this.saveSoon(host, () =>
        store.set('cards.host', JSON.stringify({ code, cid: this.cid, key: seatKey(), hostKey: hostKey(), snap, at: Date.now() } satisfies SavedHost)),
      );
    this.host = host;
    // (development builds: browser tests drive this seat with a bot's moves)
    if (import.meta.env.DEV)
      Object.assign(window, {
        __botMove: () => {
          const a = this.host?.botMoveFor(this.cid) ?? null;
          if (a) this.act(a);
          return a;
        },
        __phase: () => this.host?.state?.phase ?? null,
      });
    this.isHost = true;
    this.connected = true;
    if (restore) host.resume();
    else {
      const look = this.savedLook;
      if (look) host.lobby.look = look;
      // (a laptop that was the table screen last time is the table screen again)
      if (store.get('cards.hostScreen') && !split) host.setScreen(true);
      else host.broadcast();
    }
    // the connection to everyone else, whenever it's ready
    const joined = await joining;
    if (this.currentCode !== code || this.host !== host) return joined?.transport.leave();
    this.transport = joined?.transport ?? null;
    this.addAll = joined?.addAll ?? null;
    if (this.transport) {
      // host handoff: players get sealed backups; the relay keeps the key
      const relay = this.transport.network<RelayTransport>('relay');
      const backupKey = relay ? newBackupKey() : undefined;
      const takeoverToken = relay ? newBackupKey() : undefined;
      if (relay && backupKey) void relay.deposit(backupKey, takeoverToken);
      host.attach(this.transport, { backupKey, takeoverToken });
      host.broadcast();
    }
    this.startWatching();
  }

  private async startClient(code: string, display: boolean) {
    this.isHost = false;
    this.connected = false;
    this.joinStarted = Date.now();
    this.lostSince = 0;
    if (!display) {
      // back at a table after closing the tab: sit down in the seat this device held there
      const held = heldSeats()[code];
      if (held && held.cid !== this.cid && !(await inUse(held.cid))) this.becomeId(held.cid, held.key);
      if (this.currentCode !== code) return;
      rememberSeat(code, this.cid, seatKey());
    }
    const joined = await createTransport(this.net, code, 'guest');
    // the route may have changed while we were connecting
    if (this.currentCode !== code) return joined.transport.leave();
    this.transport = joined.transport;
    this.addNext = joined.addNext;
    const client = new Client(joined.transport, this.cid, this.name || 'Player', this.avatar, display, seatKey());
    client.onView = (v) => {
      this.view = v;
      this.noteRecord(v);
    };
    client.onError = (m) => this.say(m);
    client.onPings = (p) => (this.pings = p);
    client.onReact = (id, e) => (this.reaction = { id, e, at: Date.now() });
    // (an answer that comes after the replay was closed is ignored)
    client.onFrame = (f) => {
      if (this.replay !== null || this.replayAsked) this.replay = f;
      this.replayAsked = false;
    };
    client.onConnection = (c) => {
      this.connected = c;
      this.lostSince = c ? 0 : Date.now();
      if (c) {
        this.canTakeOver = false;
        this.hostGoneSince = 0;
      } else this.hostGoneSince ||= Date.now();
    };
    client.onBackup = (b) => store.set('cards.backup', JSON.stringify({ code, ...b }));
    client.onMove = (m) => this.moveTable(m);
    if (this.returning?.to === code) client.returning = this.returning;
    this.client = client;
    this.startWatching();
  }

  /**
   * Every couple of seconds: refresh the network status; if the host can't reach our relay, open
   * the backup networks; while a guest can't reach the host, try the backups one by one; and if a
   * host we had is gone for a while, rebuild the connection.
   */
  private startWatching() {
    if (this.watch) clearInterval(this.watch);
    let lastFallback = Date.now();
    let relayDownSince = 0;
    this.watch = setInterval(() => {
      this.netStatus = this.transport?.status() ?? null;
      if (this.host) {
        const relay = this.netStatus?.networks.find((n) => n.kind === 'relay');
        if (!relay || !this.addAll) return;
        if (relay.up) relayDownSince = 0;
        else if (!relayDownSince) relayDownSince = Date.now();
        else if (Date.now() - relayDownSince > RELAY_GRACE_MS) {
          void this.addAll();
          this.addAll = null; // once opened, the backups stay up for the rest of the session
        }
        return;
      }
      const client = this.client;
      if (!client || client.connected) return;
      if (Date.now() - lastFallback > FALLBACK_AFTER_MS && this.addNext) {
        lastFallback = Date.now();
        void this.addNext();
      }
      if (this.view && this.lostSince && Date.now() - this.lostSince > REJOIN_AFTER_MS) void this.rejoin();
      this.canTakeOver =
        !!this.view &&
        this.view.you >= 0 &&
        !!this.hostGoneSince &&
        Date.now() - this.hostGoneSince > TAKEOVER_OFFER_MS &&
        !!this.savedBackup(this.currentCode);
    }, 2000);
  }

  /** The latest sealed backup of the table `code` this device holds. */
  private savedBackup(code: string | null): { blob: string; v: number; token?: string } | null {
    try {
      const b = JSON.parse(store.get('cards.backup') ?? 'null');
      return b && b.code === code && typeof b.blob === 'string' ? b : null;
    } catch {
      return null;
    }
  }

  /**
   * The host has gone: take over its table. The relay hands us the key to the backup we hold (and
   * the table's code) once the host has been away a while; we open it and host from there, with
   * everyone keeping their seats. Bots keep playing; the old host can rejoin as a player.
   */
  async takeOver() {
    const code = this.currentCode;
    const backup = this.savedBackup(code);
    const relay = this.transport?.network<RelayTransport>('relay');
    if (!code || !backup || !relay || this.isHost || this.takingOver) return;
    this.takingOver = true;
    try {
      const res = await relay.takeover(hostKey(true), backup.token);
      if (!res.key) {
        const why: Record<string, string> = {
          'host-here': 'The host is back — hang on, reconnecting',
          'too-soon': 'The host only just dropped — give it a few more seconds',
          'no-backup': 'Someone else is already taking over',
          'not-a-player': 'Only players at this table can take it over',
          offline: 'Couldn’t reach the Lamplight relay — check your connection',
        };
        this.say(why[res.error ?? ''] ?? 'Couldn’t take over the table');
        return;
      }
      const snap = await openBackup(backup.blob, res.key);
      this.client?.close();
      this.client = null;
      this.transport = null;
      this.canTakeOver = false;
      store.set('cards.backup', null);
      await this.startHost(code, snap, { takeover: true });
      this.say('You’re hosting the table now');
    } catch (e) {
      console.warn('Takeover failed', e);
      this.say('Couldn’t open the backup of this table');
    } finally {
      this.takingOver = false;
    }
  }

  /** We came back to host a table that a player has taken over meanwhile: join it as a player. */
  private tableMoved(code: string, seatId?: string, key?: string) {
    if (this.currentCode !== code || !this.isHost) return;
    // our seat is under the id (and key) we hosted with (this may be a new tab, with new ones)
    if (seatId && seatId !== this.cid) this.becomeId(seatId, key);
    this.forgetSaved();
    this.host?.close();
    this.host = null;
    this.transport = null;
    this.say('Someone took over hosting while you were away — you’re back in your seat');
    void this.startClient(code, false);
  }

  /** Finished games go into this device's own record (see ui/record.ts), each once. */
  private noteRecord(v: View) {
    const last = v.lobby.night?.games.at(-1);
    const seen = last ? `${v.lobby.night!.games.length}:${last.at}` : '';
    if (seen === this.recordSeen) return;
    this.recordSeen = seen;
    noteGames(v.lobby.night, this.cid);
  }
  private recordSeen = '';

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: { host: Host; write: () => void } | null = null;
  private saveSoon(host: Host, write: () => void) {
    this.pendingSave = { host, write };
    this.saveTimer ??= setTimeout(() => this.saveNow(), SAVE_AFTER_MS);
  }
  /** Forget the table this device was hosting (and any save of it still to come). */
  private forgetSaved() {
    this.pendingSave = null;
    store.set('cards.host', null);
  }
  /** Write the table now (if it's still this device's table: leaving or handing it on drops the save). */
  saveNow() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const p = this.pendingSave;
    this.pendingSave = null;
    if (p && p.host === this.host) p.write();
  }

  /** This tab takes on another client id (and seat key): an earlier tab's, at a table it sat at. */
  private becomeId(cid: string, key?: string, host?: string) {
    this.cid = cid;
    useIdentity(cid, key, host);
    holdIdentity(cid);
  }

  /** Tear down and rebuild the connection to the current table, keeping what's on screen. */
  async rejoin() {
    const code = this.currentCode;
    if (!code || this.isHost) return;
    const display = this.route.name === 'display';
    this.client?.close();
    this.client = null;
    this.transport = null;
    await this.startClient(code, display);
  }

  // ---- replays: step through a finished hand, as you saw it ---------------------------------

  /** The moment of a finished hand on screen instead of the live table (null: playing live). */
  replay = $state.raw<Frame | null>(null);

  /** Show a moment of a finished hand (`hand` 0 is the latest); the host works it out. */
  showReplay(hand: number, step: number) {
    if (this.host) this.replay = this.host.frame(this.cid, hand, step);
    else {
      this.replayAsked = true;
      this.client?.replay(hand, step);
    }
  }
  private replayAsked = false;

  /** Save this game so far as a spreadsheet: every move, and your own cards each deal. */
  exportGame(format: ExportFormat = 'csv') {
    const game = this.view?.state?.game ?? 'game';
    const file = EXPORT_FILE[format];
    const name = `lamplight-${game}-${new Date().toISOString().slice(0, 10)}.${file.ext}`;
    const save = (text: string | null) => {
      if (!text) return this.say('Nothing to save yet');
      void import('./ui/saveFile').then((m) => m.saveFile(name, text, file.type));
    };
    if (this.host) save(this.host.exportFile(this.cid, format));
    else if (this.client) {
      this.client.onExport = (text) => {
        this.client!.onExport = () => {};
        save(text);
      };
      this.client.exportGame(format);
    }
  }

  closeReplay() {
    this.replay = null;
    this.replayAsked = false;
  }

  /**
   * The table's lobby buttons on this device: the host's own, or (while the host's device is the
   * table screen) those of the player holding the controls, sent to the host. Null for everyone else.
   */
  get controls(): TableControls | null {
    const host = this.host;
    if (host)
      return {
        setGame: (id) => host.setGame(id),
        setOption: (id, value) => host.setOption(id, value),
        addBot: () => host.addBot(),
        setPlaying: (id, on) => host.setPlaying(id, on),
        moveSeat: (id, dir) => host.moveSeat(id, dir),
        removeSeat: (id) => host.removeSeat(id),
        start: () => host.start(),
        endGame: () => host.endGame(),
        setLook: (look) => this.setLook(look),
        setTakeBacks: (on) => host.setTakeBacks(on),
      };
    const client = this.client;
    if (!client || !this.view || this.view.lobby.captain !== this.cid) return null;
    return {
      setGame: (id) => client.lobbyOp({ op: 'game', id }),
      setOption: (id, value) => client.lobbyOp({ op: 'option', id, value }),
      addBot: () => client.lobbyOp({ op: 'bot' }),
      setPlaying: (id, on) => client.lobbyOp({ op: 'playing', id, on }),
      moveSeat: (id, dir) => client.lobbyOp({ op: 'move', id, dir }),
      removeSeat: (id) => client.lobbyOp({ op: 'remove', id }),
      start: () => client.lobbyOp({ op: 'deal' }),
      endGame: () => client.lobbyOp({ op: 'end' }),
      setLook: (look) => client.lobbyOp({ op: 'look', ...look }),
      setTakeBacks: (on) => client.lobbyOp({ op: 'takeBacks', on }),
    };
  }

  /** React at the table (see REACTIONS): it shows on your seat for everyone. */
  react(e: number) {
    if (this.host) this.host.react(this.cid, e);
    else this.client?.react(e);
  }

  act(a: Action) {
    if (this.host) {
      const err = this.host.act(this.cid, a);
      if (err) this.say(err);
    } else this.client?.act(a);
  }

  say(text: string) {
    this.toast = { text, id: Date.now() };
  }

  leave(clearSaved = true) {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.host?.close();
    this.client?.close();
    this.transport = null;
    this.addNext = null;
    this.addAll = null;
    this.netStatus = null;
    this.pings = [];
    if (clearSaved && this.host) this.forgetSaved();
    else this.saveNow();
    this.host = null;
    this.client = null;
    this.view = null;
    this.closeReplay();
    this.isHost = false;
    this.currentCode = null;
    this.hostGoneSince = 0;
    this.canTakeOver = false;
  }
}

export const app = new App();
