import type { Msg } from './protocol';
import { MultiTransport } from './multiTransport';

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

/** How long a guest waits for a host on one network before also trying the next. */
export const FALLBACK_AFTER_MS = 6000;

/**
 * Join a room. The host joins every relay network at once; a guest starts on the first and
 * adds the next ones (`addNext`) while nobody has answered.
 */
export async function createTransport(kind: TransportKind, code: string, role: 'host' | 'guest') {
  const multi = new MultiTransport();
  if (kind === 'local') {
    const { LocalTransport } = await import('./localTransport');
    multi.add(new LocalTransport(code));
    return { transport: multi, addNext: async () => false };
  }
  const { TrysteroTransport, STRATEGIES } = await import('./trysteroTransport');
  const join = async (s: (typeof STRATEGIES)[number]) => {
    try {
      multi.add(await TrysteroTransport.create(s, code));
    } catch (e) {
      console.warn(`Couldn't use ${s}`, e);
    }
  };
  const pending = [...STRATEGIES];
  if (role === 'host') await Promise.all(pending.splice(0).map(join));
  else await join(pending.shift()!);
  return {
    transport: multi,
    /** Add the next untried network; resolves false when there are none left. */
    addNext: async () => {
      const next = pending.shift();
      if (!next) return false;
      await join(next);
      return true;
    },
  };
}
