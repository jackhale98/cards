import type { Action } from '../engine/types';
import type { Avatar, HostMsg, Night, View } from './protocol';
import type { Transport } from './transport';

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
  /** When we last heard anything from the host. */
  lastHeard = 0;
  /** The host's latest sealed backup of the game (only the relay can unlock it; see backup.ts). */
  backup: { blob: string; v: number } | null = null;
  onBackup: (b: { blob: string; v: number }) => void = () => {};
  /** The host is splitting the table (or sending a split-off table back): go to this one. */
  onMove: (m: { code: string; host?: boolean; night?: Night; parent?: string; back?: boolean }) => void = () => {};
  /** Back from a table that split off: its code and finished games, sent with each hello. */
  returning: { from: string; night: Night } | null = null;
  private seq = 0;
  private helloTimer: ReturnType<typeof setInterval>;

  constructor(
    private transport: Transport,
    private cid: string,
    private name: string,
    private avatar: Avatar | undefined,
    private display = false,
  ) {
    transport.onPeerJoin = (peer) => this.hello(peer);
    transport.onPeerLeave = (peer) => {
      if (peer === this.hostPeer) this.setConnected(false);
    };
    transport.onMessage = (raw, from) => {
      const msg = raw as HostMsg;
      if (msg.t === 'ping') {
        this.transport.send({ t: 'pong', ts: msg.ts }, from);
        this.heard();
        return;
      }
      if (msg.t === 'backup') {
        if (from !== this.hostPeer || typeof msg.blob !== 'string') return;
        this.backup = { blob: msg.blob, v: msg.v };
        this.onBackup(this.backup);
        return;
      }
      if (msg.t === 'move') {
        if (from !== this.hostPeer || typeof msg.code !== 'string') return;
        this.onMove(msg);
        return;
      }
      if (msg.t === 'pings') {
        this.heard();
        this.onPings(msg.pings);
        return;
      }
      if (msg.t === 'view') {
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
      } else if (msg.t === 'err') {
        this.onError(msg.msg);
      }
    };
    // keep saying hello until a host answers (covers missed join events), and notice a host
    // that has gone quiet (it pings every few seconds) faster than WebRTC would
    this.helloTimer = setInterval(() => {
      if (this.connected && Date.now() - this.lastHeard > SILENT_AFTER_MS) this.setConnected(false);
      if (!this.connected) this.hello();
    }, 2000);
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

  private hello(peer?: string) {
    const back = this.returning ? { from: this.returning.from, merge: this.returning.night.games } : {};
    this.transport.send({ t: 'hello', cid: this.cid, name: this.name, avatar: this.avatar, display: this.display, ...back }, peer);
  }

  /** Change name/avatar; the host applies it to your seat. */
  updateProfile(name: string, avatar?: Avatar) {
    this.name = name;
    this.avatar = avatar;
    if (this.hostPeer) this.hello(this.hostPeer);
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
