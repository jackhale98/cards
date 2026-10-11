import type { Msg } from './protocol';
import type { Transport } from './transport';

export interface NetworkStatus {
  /** Networks joined so far, with how many of their relays are reachable. */
  networks: { kind: string; up: number; total: number }[];
  peers: number;
}

type Sub = Transport & { relays?: () => { up: number; total: number } };

/**
 * Several transports used as one. Peer ids are namespaced by network (`nostr:abc`), messages to a
 * peer go out on the network it was seen on, broadcasts go out on all. The host joins every
 * network at once; a guest starts with the first and adds the others if nobody answers, so one
 * flaky relay network can't keep a table from forming.
 */
export class MultiTransport implements Transport {
  readonly kind = 'multi';
  readonly selfId: string;
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  private subs = new Map<string, Sub>();
  private peers = new Set<string>();
  private closed = false;

  constructor(selfId = 'multi') {
    this.selfId = selfId;
  }

  /** Join another network. Safe to call while messages are flowing on the others. */
  add(t: Sub) {
    if (this.closed) return t.leave();
    if (this.subs.has(t.kind)) return;
    this.subs.set(t.kind, t);
    const id = (peer: string) => `${t.kind}:${peer}`;
    t.onMessage = (msg, from) => this.onMessage(msg, id(from));
    t.onPeerJoin = (peer) => {
      this.peers.add(id(peer));
      this.onPeerJoin(id(peer));
    };
    t.onPeerLeave = (peer) => {
      this.peers.delete(id(peer));
      this.onPeerLeave(id(peer));
    };
  }

  get networks(): string[] {
    return [...this.subs.keys()];
  }

  send(msg: Msg, to?: string) {
    if (!to) {
      for (const t of this.subs.values()) t.send(msg);
      return;
    }
    const sep = to.indexOf(':');
    this.subs.get(to.slice(0, sep))?.send(msg, to.slice(sep + 1));
  }

  status(): NetworkStatus {
    return {
      networks: [...this.subs.values()].map((t) => ({ kind: t.kind, ...(t.relays?.() ?? { up: 0, total: 0 }) })),
      peers: this.peers.size,
    };
  }

  leave() {
    this.closed = true;
    for (const t of this.subs.values()) t.leave();
    this.subs.clear();
  }
}
