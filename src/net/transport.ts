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

/** `p2p`: our relay plus the public networks (normal); `relay` / `public`: only one kind (testing). */
export type TransportKind = 'p2p' | 'local' | 'relay' | 'public';

/** How long a guest waits for a host on one network before also trying the next. */
export const FALLBACK_AFTER_MS = 6000;
/** How long the host waits for the relay before opening the backup networks. */
export const RELAY_GRACE_MS = 5000;

export interface Joined {
  transport: MultiTransport;
  /** Add the next untried backup network; resolves false when there are none left. */
  addNext: () => Promise<boolean>;
  /** Add every remaining backup network at once (the host, when the relay can't be reached). */
  addAll: () => Promise<void>;
}

/**
 * Join a room. Normally everyone starts on our relay alone, which keeps a phone to one connection
 * (plus a direct link per device it talks to). The public signalling networks are backups: a
 * guest adds them one by one while no host answers (`addNext`), and the host opens them all if the
 * relay can't be reached (`addAll`), so the two still meet during a relay outage.
 */
export async function createTransport(kind: TransportKind, code: string, role: 'host' | 'guest'): Promise<Joined> {
  const multi = new MultiTransport();
  const none = { addNext: async () => false, addAll: async () => {} };
  if (kind === 'local') {
    const { LocalTransport } = await import('./localTransport');
    multi.add(new LocalTransport(code));
    return { transport: multi, ...none };
  }
  if (kind !== 'public') {
    const { RelayTransport } = await import('./relayTransport');
    multi.add(new RelayTransport(code));
  }
  if (kind === 'relay') return { transport: multi, ...none };
  const { TrysteroTransport, STRATEGIES } = await import('./trysteroTransport');
  const join = async (s: (typeof STRATEGIES)[number]) => {
    try {
      multi.add(await TrysteroTransport.create(s, code));
    } catch (e) {
      console.warn(`Couldn't use ${s}`, e);
    }
  };
  const pending = [...STRATEGIES];
  const addNext = async () => {
    const next = pending.shift();
    if (!next) return false;
    await join(next);
    return true;
  };
  const addAll = async () => {
    await Promise.all(pending.splice(0).map(join));
  };
  // public-only (testing): no relay to wait for, so start on the public networks straight away
  if (kind === 'public') {
    if (role === 'host') await addAll();
    else await addNext();
  }
  return { transport: multi, addNext, addAll };
}
