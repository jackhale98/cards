import type { Action } from './engine/types';
import { Client } from './net/client';
import { Host, type HostSnapshot } from './net/host';
import { AVATAR_COLORS, AVATAR_EMOJI, cleanAvatar, makeRoomCode, type Avatar, type View } from './net/protocol';
import type { MultiTransport, NetworkStatus } from './net/multiTransport';
import { createTransport, FALLBACK_AFTER_MS, RELAY_GRACE_MS, type TransportKind } from './net/transport';

/** A guest that has lost the host for this long rebuilds its connection from scratch. */
const REJOIN_AFTER_MS = 8000;

export type Route =
  | { name: 'home'; code?: string }
  | { name: 'room'; code: string }
  | { name: 'display'; code: string };

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
function hostKey(): string {
  try {
    let key = sessionStorage.getItem('cards.hostKey');
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

export function parseHash(hash = location.hash): Route {
  const [, kind, code] = hash.replace(/^#\/?/, '/').split('/');
  if (kind === 'room' && code) return { name: 'room', code: code.toUpperCase() };
  if (kind === 'display' && code) return { name: 'display', code: code.toUpperCase() };
  if (kind === 'join' && code) return { name: 'home', code: code.toUpperCase() };
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
  route = $state<Route>(parseHash());
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
  readonly cid = clientId();
  readonly net: TransportKind = (['local', 'relay', 'public'] as const).find((k) => k === new URLSearchParams(location.search).get('net')) ?? 'p2p';

  host: Host | null = null;
  private client: Client | null = null;
  private currentCode: string | null = null;
  private transport: MultiTransport | null = null;
  private addNext: (() => Promise<boolean>) | null = null;
  private addAll: (() => Promise<void>) | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;
  private lostSince = 0;

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
    if (r.name === 'home') return this.leave(false);
    if (this.currentCode === r.code) return;
    this.leave(false);
    this.currentCode = r.code;
    const saved = this.savedHost;
    const resume = saved?.code === r.code ? saved.snap : undefined;
    if (r.name === 'room' && this.pendingHostCode === r.code) {
      this.pendingHostCode = null;
      await this.startHost(r.code, resume);
    } else if (r.name === 'room' && resume && saved?.cid === this.cid) await this.startHost(r.code, resume);
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

  private async startHost(code: string, restore?: HostSnapshot) {
    const joined = await createTransport(this.net, code, 'host', { key: hostKey(), onTaken: () => this.codeTaken(code) }).catch((e) => {
      console.warn('Network unavailable, hosting offline', e);
      return null;
    });
    this.transport = joined?.transport ?? null;
    this.addAll = joined?.addAll ?? null;
    const host = new Host(this.transport, code, { cid: this.cid, name: this.name || 'Host', avatar: this.avatar }, restore);
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
    };
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
    }, 2000);
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
  }
}

export const app = new App();
