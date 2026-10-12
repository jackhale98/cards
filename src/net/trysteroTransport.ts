import type { Room } from '@trystero-p2p/nostr';
import type { Msg } from './protocol';
import type { Transport } from './transport';

const APP_ID = 'cards-local-table-v1';

/** Public signalling networks Trystero can use to introduce devices, in order of preference. */
export type Strategy = 'nostr' | 'mqtt' | 'torrent';
export const STRATEGIES: Strategy[] = ['nostr', 'mqtt', 'torrent'];

interface StrategyModule {
  joinRoom: (config: { appId: string; relayConfig?: { redundancy?: number } }, room: string) => Room;
  getRelaySockets: () => Record<string, unknown>;
  selfId: string;
}

const load: Record<Strategy, () => Promise<StrategyModule>> = {
  nostr: () => import('@trystero-p2p/nostr') as unknown as Promise<StrategyModule>,
  mqtt: () => import('@trystero-p2p/mqtt') as unknown as Promise<StrategyModule>,
  torrent: () => import('@trystero-p2p/torrent') as unknown as Promise<StrategyModule>,
};

/** A relay socket counts as up if it reports an open WebSocket or a connected client. */
function isUp(sock: unknown): boolean {
  const s = sock as { readyState?: number; connected?: boolean } | null;
  return !!s && (s.readyState === 1 || s.connected === true);
}

/**
 * WebRTC data channels between devices via one Trystero strategy. The strategy only introduces
 * peers (through public relays, no server of our own); after that, traffic flows directly
 * between devices, which on the same WiFi means it never leaves the local network.
 */
export class TrysteroTransport implements Transport {
  readonly kind: string;
  readonly selfId: string;
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  private room: Room;
  private sendRaw: (data: string, opts?: { target?: string }) => Promise<void>;

  private constructor(
    private mod: StrategyModule,
    strategy: Strategy,
    code: string,
  ) {
    this.kind = strategy;
    this.selfId = mod.selfId;
    // ask for a few extra relays: any one in common is enough to find each other
    this.room = mod.joinRoom({ appId: APP_ID, relayConfig: { redundancy: strategy === 'nostr' ? 8 : undefined } }, code);
    const action = this.room.makeAction<string>('m');
    this.sendRaw = action.send;
    action.onMessage = (data, ctx) => {
      try {
        this.onMessage(JSON.parse(data) as Msg, ctx.peerId);
      } catch (e) {
        console.warn('Bad message', e);
      }
    };
    this.room.onPeerJoin = (id) => this.onPeerJoin(id);
    this.room.onPeerLeave = (id) => this.onPeerLeave(id);
  }

  static async create(strategy: Strategy, code: string): Promise<TrysteroTransport> {
    return new TrysteroTransport(await load[strategy](), strategy, code);
  }

  send(msg: Msg, to?: string) {
    this.sendRaw(JSON.stringify(msg), to ? { target: to } : undefined).catch((e) => console.warn('send failed', e));
  }

  /** How many of this strategy's relays are reachable right now. */
  relays(): { up: number; total: number } {
    try {
      const socks = Object.values(this.mod.getRelaySockets() ?? {});
      return { up: socks.filter(isUp).length, total: socks.length };
    } catch {
      return { up: 0, total: 0 };
    }
  }

  leave() {
    void this.room.leave();
  }
}
