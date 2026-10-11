import type { Msg } from './protocol';

/**
 * A room-scoped message bus between devices. The host and clients only see this interface,
 * so the signalling/connection strategy (WebRTC via public relays, QR pairing, a local
 * BroadcastChannel for testing…) is swappable.
 */
export interface Transport {
  readonly selfId: string;
  readonly kind: string;
  send(msg: Msg, to?: string): void;
  onMessage: (msg: Msg, from: string) => void;
  onPeerJoin: (peerId: string) => void;
  onPeerLeave: (peerId: string) => void;
  leave(): void;
}

export type TransportKind = 'p2p' | 'local';

export async function createTransport(kind: TransportKind, code: string): Promise<Transport> {
  if (kind === 'local') {
    const { LocalTransport } = await import('./localTransport');
    return new LocalTransport(code);
  }
  const { TrysteroTransport } = await import('./trysteroTransport');
  return new TrysteroTransport(code);
}
