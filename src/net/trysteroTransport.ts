import { joinRoom, selfId, type Room } from 'trystero';
import type { Msg } from './protocol';
import type { Transport } from './transport';

const APP_ID = 'cards-local-table-v1';

/**
 * WebRTC data channels between devices. Trystero introduces peers through public Nostr
 * relays (no server of our own); after that, traffic flows directly between devices,
 * which on the same WiFi means it never leaves the local network.
 */
export class TrysteroTransport implements Transport {
  readonly kind = 'p2p';
  readonly selfId = selfId;
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  private room: Room;
  private sendRaw: (data: string, opts?: { target?: string }) => Promise<void>;

  constructor(code: string) {
    this.room = joinRoom({ appId: APP_ID }, code);
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

  send(msg: Msg, to?: string) {
    this.sendRaw(JSON.stringify(msg), to ? { target: to } : undefined).catch((e) => console.warn('send failed', e));
  }

  leave() {
    void this.room.leave();
  }
}
