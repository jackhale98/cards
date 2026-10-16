import type { Action } from '../engine/types';
import { isValidCode, type Avatar, type Frame, type HostMsg, type LobbyOp, type Night, type View } from './protocol';
import type { ExportFormat } from './exports/formats';
import type { Transport } from './transport';
import { apply } from './patch';

/** No word from the host (which pings every 3s) for this long means we've lost it. */
export const SILENT_AFTER_MS = 9000;

/** A player's (or table display's) connection to the host. Holds the latest view. */
export class Client {
  view: View | null = null;
  hostPeer: string | null = null;
  connected = false;
  onView: (v: View) => void = () => {};
  onError: (msg: string) => void = () => {};
  onConnection: (connected: boolean) => void = () => {};
  /** Round-trip times from the host to each seat (ms), refreshed every few seconds. */
  onPings: (pings: (number | null)[]) => void = () => {};
  /** A moment of a finished hand, asked for with `replay` (null: there isn't one). */
  onFrame: (f: Frame | null) => void = () => {};
  /** The game as a file, asked for with `exportGame` (null: nothing to save). */
  onExport: (text: string | null) => void = () => {};
  /** Someone at the table reacted (see REACTIONS). */
  onReact: (id: string, e: number) => void = () => {};
  /** When we last heard anything from the host. */
  lastHeard = 0;
  /** The host's latest sealed backup of the game (only the relay can unlock it; see backup.ts). */
  backup: { blob: string; v: number; token?: string } | null = null;
  onBackup: (b: { blob: string; v: number; token?: string }) => void = () => {};
  /** The host is splitting the table (or sending a split-off table back): go to this one. */
  onMove: (m: {
    code: string;
    host?: boolean;
    night?: Night;
    parent?: string;
    back?: boolean;
    game?: { id: string; options: Record<string, number | boolean> };
  }) => void = () => {};
  /** Back from a table that split off: its code and finished games, sent with each hello. */
  returning: { from: string; night: Night } | null = null;
  private seq = 0;
  /** The table's id (Lobby.tid), from the first host that answered. */
  private tid: string | undefined;
  private helloTimer: ReturnType<typeof setInterval>;

  constructor(
    private transport: Transport,
    private cid: string,
    private name: string,
    private avatar: Avatar | undefined,
    private display = false,
    /** The secret that holds our seat: only ever sent to the host. */
    private key = '',
  ) {
    transport.onPeerJoin = (peer) => this.hello(peer);
    transport.onPeerLeave = (peer) => {
      if (peer === this.hostPeer) this.setConnected(false);
    };
    transport.onMessage = (raw, from) => {
      const msg = raw as HostMsg;
      if (msg.t === 'ping') {
        this.transport.send({ t: 'pong', ts: msg.ts }, from);
        if (this.isHost(from)) this.heard();
        return;
      }
      // everything else only counts from the host: other players can message us too
      if (!this.isHost(from)) return;
      if (msg.t === 'backup') {
        if (from !== this.hostPeer || typeof msg.blob !== 'string') return;
        this.backup = { blob: msg.blob, v: msg.v, ...(typeof msg.token === 'string' ? { token: msg.token } : {}) };
        this.onBackup(this.backup);
        return;
      }
      if (msg.t === 'move') {
        if (from !== this.hostPeer || typeof msg.code !== 'string' || !isValidCode(msg.code)) return;
        this.onMove(msg);
        return;
      }
      if (msg.t === 'frame') {
        if (from !== this.hostPeer) return;
        const f = msg.frame;
        this.onFrame(f && typeof f === 'object' && f.state && f.status ? f : null);
        return;
      }
      if (msg.t === 'export') {
        if (from !== this.hostPeer) return;
        this.onExport(typeof msg.text === 'string' ? msg.text : null);
        return;
      }
      if (msg.t === 'pings') {
        if (from !== this.hostPeer || !Array.isArray(msg.pings)) return;
        this.heard();
        this.onPings(msg.pings);
        return;
      }
      if (msg.t === 'view') {
        if (!msg.view || typeof msg.view !== 'object') return;
        // on networks that can't vouch for the host, keep to hosts of the table we joined (its id
        // survives the host reloading or a player taking over): a stranger who knows the code can't
        // pose as the host while we're reconnecting and collect our seat's key
        const tid = msg.view.lobby?.tid;
        if (this.tid && tid !== this.tid && this.transport.vouch?.(from) !== true) return;
        this.tid ??= typeof tid === 'string' ? tid : undefined;
        const fresh = from !== this.hostPeer;
        // the host asks who we are (we came in without showing our seat's key): tell it
        if (msg.view.who) {
          this.hostPeer = from;
          if (this.key) this.hello(from);
          return;
        }
        // the same host can reach us on several networks: take each version once, newest only
        // (a restarted host has a new id and starts counting again)
        const same = this.view && msg.view.hid === this.view.hid;
        if (same && msg.view.v <= this.view!.v) {
          if (from === this.hostPeer) this.heard();
          return;
        }
        this.hostPeer = from;
        this.heard();
        this.view = msg.view;
        this.onView(msg.view);
        // a host we've only just found: show it our key, so it gives us our seat
        if (fresh) this.hello(from);
      } else if (msg.t === 'patch') {
        // what changed since the view we have: from the host we're with, on top of the version
        // it was made from (a repeat over a second network is skipped; one that doesn't fit, as
        // after a lost message, gets the whole view instead)
        if (from !== this.hostPeer || !this.view || msg.hid !== this.view.hid || typeof msg.v !== 'number') return;
        this.heard();
        if (msg.v <= this.view.v) return;
        const next = msg.base === this.view.v ? apply(this.view, msg.ops) : null;
        if (!next || typeof next !== 'object' || next.v !== msg.v) return this.transport.send({ t: 'sync' }, from);
        this.view = next;
        this.onView(next);
      } else if (msg.t === 'react') {
        if (from === this.hostPeer && typeof msg.id === 'string' && typeof msg.e === 'number') this.onReact(msg.id, msg.e);
      } else if (msg.t === 'err') {
        if (from === this.hostPeer) this.onError(String(msg.msg));
      }
    };
    // keep saying hello until a host answers (covers missed join events), and notice a host
    // that has gone quiet (it pings every few seconds) faster than WebRTC would
    this.helloTimer = setInterval(() => {
      if (this.connected && Date.now() - this.lastHeard > SILENT_AFTER_MS) this.setConnected(false);
      if (!this.connected) this.hello();
    }, 2000);
  }

  /**
   * Whether a message from `from` may be from the host. Our relay vouches for who the host is;
   * on networks that can't, we keep to the host we found first, unless it has gone quiet.
   */
  private isHost(from: string): boolean {
    const vouched = this.transport.vouch?.(from);
    if (vouched !== undefined) return vouched;
    return !this.hostPeer || from === this.hostPeer || !this.connected;
  }

  private heard() {
    this.lastHeard = Date.now();
    this.setConnected(true);
  }

  /** Say hello to everyone again (e.g. when the phone wakes up). */
  nudge() {
    this.hello();
  }

  private setConnected(c: boolean) {
    if (c === this.connected) return;
    this.connected = c;
    this.onConnection(c);
  }

  /** Say hello: to everyone while we look for the host, with our seat's key only to the host. */
  private hello(peer?: string) {
    const back = this.returning ? { from: this.returning.from, merge: this.returning.night.games } : {};
    const key = this.key && peer && peer === this.hostPeer ? { key: this.key } : {};
    this.transport.send({ t: 'hello', cid: this.cid, name: this.name, avatar: this.avatar, display: this.display, ...key, ...back }, peer);
  }

  /** Change name/avatar; the host applies it to your seat. */
  updateProfile(name: string, avatar?: Avatar) {
    this.name = name;
    this.avatar = avatar;
    if (this.hostPeer) this.hello(this.hostPeer);
  }

  /** Ask the host for a moment of a finished hand (see Frame). */
  replay(hand: number, step: number) {
    if (this.hostPeer) this.transport.send({ t: 'replay', hand, step }, this.hostPeer);
  }

  /** Ask the host for the game so far as a file (see Host.exportFile). */
  exportGame(format: ExportFormat = 'csv') {
    if (this.hostPeer) this.transport.send({ t: 'export', format }, this.hostPeer);
  }

  /** A lobby button, from the player holding the controls while the host's device is the table screen. */
  lobbyOp(op: LobbyOp) {
    if (!this.hostPeer) return this.onError('Not connected to the host yet');
    this.transport.send({ t: 'lobby', op }, this.hostPeer);
  }

  react(e: number) {
    if (this.hostPeer) this.transport.send({ t: 'react', e }, this.hostPeer);
  }

  act(a: Action) {
    if (!this.hostPeer) return this.onError('Not connected to the host yet');
    this.transport.send({ t: 'act', a, seq: ++this.seq }, this.hostPeer);
  }

  close() {
    clearInterval(this.helloTimer);
    this.transport.leave();
  }
}
