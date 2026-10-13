import type { Msg } from './protocol';
import type { Transport } from './transport';

type Envelope = { k: 'here'; from: string; reply?: boolean } | { k: 'gone'; from: string } | { k: 'msg'; from: string; to?: string; msg: Msg };

/**
 * Connects tabs of the same browser via BroadcastChannel. Used for development, automated
 * tests and "pass the device" play with no network at all. Enable with `?net=local`.
 */
export class LocalTransport implements Transport {
  readonly kind = 'local';
  readonly selfId = Math.random().toString(36).slice(2, 10);
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  private ch: BroadcastChannel;
  private peers = new Set<string>();

  constructor(code: string) {
    this.ch = new BroadcastChannel(`cards-room-${code}`);
    this.ch.onmessage = (e: MessageEvent<Envelope>) => this.receive(e.data);
    addEventListener('pagehide', () => this.leave());
    // announce after handlers are attached by the owner
    queueMicrotask(() => this.post({ k: 'here', from: this.selfId }));
  }

  private closed = false;

  private post(e: Envelope) {
    // (moving to another table closes this one, possibly while a message is still being handled)
    if (!this.closed) this.ch.postMessage(e);
  }

  private receive(e: Envelope) {
    if (e.from === this.selfId) return;
    if (e.k === 'here') {
      if (!e.reply) this.post({ k: 'here', from: this.selfId, reply: true });
      if (!this.peers.has(e.from)) {
        this.peers.add(e.from);
        this.onPeerJoin(e.from);
      }
    } else if (e.k === 'gone') {
      if (this.peers.delete(e.from)) this.onPeerLeave(e.from);
    } else if (!e.to || e.to === this.selfId) {
      this.onMessage(e.msg, e.from);
    }
  }

  send(msg: Msg, to?: string) {
    this.post({ k: 'msg', from: this.selfId, to, msg });
  }

  leave() {
    this.post({ k: 'gone', from: this.selfId });
    this.closed = true;
    this.ch.close();
  }
}
