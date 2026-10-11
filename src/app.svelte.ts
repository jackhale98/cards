import type { Action } from './engine/types';
import { Client } from './net/client';
import { Host, type HostSnapshot } from './net/host';
import { makeRoomCode, type View } from './net/protocol';
import { createTransport, type TransportKind } from './net/transport';

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
  view = $state.raw<View | null>(null);
  isHost = $state(false);
  connected = $state(false);
  toast = $state<{ text: string; id: number } | null>(null);
  readonly cid = clientId();
  readonly net: TransportKind = new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'p2p';

  host: Host | null = null;
  private client: Client | null = null;
  private currentCode: string | null = null;

  constructor() {
    addEventListener('hashchange', () => {
      this.route = parseHash();
      void this.sync();
    });
  }

  setName(n: string) {
    this.name = n.slice(0, 20);
    store.set('cards.name', this.name);
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

  /** Re-open the table this device was hosting (e.g. after the browser was closed). */
  resumeRoom(code: string) {
    this.pendingHostCode = code;
    this.go(`/room/${code}`);
  }

  private async startHost(code: string, restore?: HostSnapshot) {
    const transport = await createTransport(this.net, code).catch((e) => {
      console.warn('Network unavailable, hosting offline', e);
      return null;
    });
    const host = new Host(transport, code, { cid: this.cid, name: this.name || 'Host' }, restore);
    // clone so the UI gets fresh objects, exactly like a remote client would
    host.onLocalView = (v) => (this.view = structuredClone(v));
    host.onPersist = (snap) => store.set('cards.host', JSON.stringify({ code, cid: this.cid, snap, at: Date.now() } satisfies SavedHost));
    this.host = host;
    this.isHost = true;
    this.connected = true;
    if (restore) host.resume();
    else host.broadcast();
  }

  private async startClient(code: string, display: boolean) {
    this.isHost = false;
    this.connected = false;
    const transport = await createTransport(this.net, code);
    const client = new Client(transport, this.cid, this.name || 'Player', display);
    client.onView = (v) => (this.view = v);
    client.onError = (m) => this.say(m);
    client.onConnection = (c) => (this.connected = c);
    this.client = client;
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
    this.host?.close();
    this.client?.close();
    if (clearSaved && this.host) store.set('cards.host', null);
    this.host = null;
    this.client = null;
    this.view = null;
    this.isHost = false;
    this.currentCode = null;
  }
}

export const app = new App();
