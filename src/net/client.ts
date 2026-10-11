import type { Action } from '../engine/types';
import type { Avatar, HostMsg, View } from './protocol';
import type { Transport } from './transport';

/** A player's (or table display's) connection to the host. Holds the latest view. */
export class Client {
  view: View | null = null;
  hostPeer: string | null = null;
  connected = false;
  onView: (v: View) => void = () => {};
  onError: (msg: string) => void = () => {};
  onConnection: (connected: boolean) => void = () => {};
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
      if (msg.t === 'view') {
        // ignore out-of-order deliveries
        if (from === this.hostPeer && this.view && msg.view.v < this.view.v) return;
        this.hostPeer = from;
        this.setConnected(true);
        this.view = msg.view;
        this.onView(msg.view);
      } else if (msg.t === 'err') {
        this.onError(msg.msg);
      }
    };
    // keep saying hello until a host answers (covers missed join events)
    this.helloTimer = setInterval(() => {
      if (!this.connected) this.hello();
    }, 2000);
  }

  private setConnected(c: boolean) {
    if (c === this.connected) return;
    this.connected = c;
    this.onConnection(c);
  }

  private hello(peer?: string) {
    this.transport.send({ t: 'hello', cid: this.cid, name: this.name, avatar: this.avatar, display: this.display }, peer);
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
