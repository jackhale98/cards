import type { Action } from './engine/types';
import { newBackupKey, open as openBackup } from './net/backup';
import { Client } from './net/client';
import { Host, type HostSnapshot } from './net/host';
import { AVATAR_COLORS, AVATAR_EMOJI, cleanAvatar, makeRoomCode, type Avatar, type View } from './net/protocol';
import type { MultiTransport, NetworkStatus } from './net/multiTransport';
import type { RelayTransport } from './net/relayTransport';
import { createTransport, FALLBACK_AFTER_MS, RELAY_GRACE_MS, type TransportKind } from './net/transport';

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
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { emoji: pick(AVATAR_EMOJI), color: pick(AVATAR_COLORS) };
}

interface SavedHost {
  code: string;
  /** Tab that hosts it; other tabs on this device join as normal players. */
  cid: string;
  snap: HostSnapshot;
  at: number;
}

class App {
  route = $state<Route>((takeInvite(), parseHash()));
  name = $state(store.get('cards.name') ?? '');
  avatar = $state.raw<Avatar>(loadAvatar());
  view = $state.raw<View | null>(null);
  isHost = $state(false);
  connected = $state(false);
  toast = $state<{ text: string; id: number } | null>(null);
  /** Host → player round-trip times by seat (ms; host 0, bots/unknown null). */
  pings = $state.raw<(number | null)[]>([]);
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

  createRoom() {
    store.set('cards.host', null);
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
    const saved = this.savedHost;
    const next = makeRoomCode();
    if (saved?.code === code) store.set('cards.host', JSON.stringify({ ...saved, code: next, at: Date.now() } satisfies SavedHost));
    else store.set('cards.host', null);
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
    // a table we were hosting that someone else now hosts (they took over while we were gone): join it
    // (the seat we hosted from: resuming in a new tab re-saves the table under this tab's id)
    const seatId = this.savedHost?.cid;
    const onTaken = () => (how.resuming ? this.tableMoved(code, seatId) : this.codeTaken(code));
    const joined = await createTransport(this.net, code, 'host', { key: hostKey(), onTaken }).catch((e) => {
      console.warn('Network unavailable, hosting offline', e);
      return null;
    });
    this.transport = joined?.transport ?? null;
    this.addAll = joined?.addAll ?? null;
    // host handoff: players get sealed backups; the relay keeps the key
    const relay = this.transport?.network<RelayTransport>('relay');
    const backupKey = relay ? newBackupKey() : undefined;
    if (relay && backupKey) relay.deposit(backupKey);
    const host = new Host(this.transport, code, { cid: this.cid, name: this.name || 'Host', avatar: this.avatar }, restore, { backupKey, takeover: how.takeover });
    host.onPings = (p) => (this.pings = p);
    // clone so the UI gets fresh objects, exactly like a remote client would
    host.onLocalView = (v) => (this.view = structuredClone(v));
    host.onPersist = (snap) => store.set('cards.host', JSON.stringify({ code, cid: this.cid, snap, at: Date.now() } satisfies SavedHost));
    this.host = host;
    this.isHost = true;
    this.connected = true;
    if (restore) host.resume();
    else host.broadcast();
    this.startWatching();
  }

  private async startClient(code: string, display: boolean) {
    this.isHost = false;
    this.connected = false;
    this.joinStarted = Date.now();
    this.lostSince = 0;
    const joined = await createTransport(this.net, code, 'guest');
    // the route may have changed while we were connecting
    if (this.currentCode !== code) return joined.transport.leave();
    this.transport = joined.transport;
    this.addNext = joined.addNext;
    const client = new Client(joined.transport, this.cid, this.name || 'Player', this.avatar, display);
    client.onView = (v) => (this.view = v);
    client.onError = (m) => this.say(m);
    client.onPings = (p) => (this.pings = p);
    client.onConnection = (c) => {
      this.connected = c;
      this.lostSince = c ? 0 : Date.now();
      if (c) {
        this.canTakeOver = false;
        this.hostGoneSince = 0;
      } else this.hostGoneSince ||= Date.now();
    };
    client.onBackup = (b) => store.set('cards.backup', JSON.stringify({ code, ...b }));
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
      this.canTakeOver = !!this.view && this.view.you >= 0 && !!this.hostGoneSince && Date.now() - this.hostGoneSince > TAKEOVER_OFFER_MS && !!this.savedBackup(this.currentCode);
    }, 2000);
  }

  /** The latest sealed backup of the table `code` this device holds. */
  private savedBackup(code: string | null): { blob: string; v: number } | null {
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
      const res = await relay.takeover(hostKey(true));
      if (!res.key) {
        const why: Record<string, string> = {
          'host-here': 'The host is back — hang on, reconnecting',
          'too-soon': 'The host only just dropped — give it a few more seconds',
          'no-backup': 'Someone else is already taking over',
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
  private tableMoved(code: string, seatId?: string) {
    if (this.currentCode !== code || !this.isHost) return;
    // our seat is under the id we hosted with (this may be a new tab, with a new one)
    if (seatId && seatId !== this.cid) {
      this.cid = seatId;
      try {
        sessionStorage.setItem('cards.cid', seatId);
      } catch {
        /* private mode */
      }
    }
    store.set('cards.host', null);
    this.host?.close();
    this.host = null;
    this.transport = null;
    this.say('Someone took over hosting while you were away — you’re back in your seat');
    void this.startClient(code, false);
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
    if (clearSaved && this.host) store.set('cards.host', null);
    this.host = null;
    this.client = null;
    this.view = null;
    this.isHost = false;
    this.currentCode = null;
    this.hostGoneSince = 0;
    this.canTakeOver = false;
  }
}

export const app = new App();
