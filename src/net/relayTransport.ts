import type { Msg } from './protocol';
import type { Transport } from './transport';

/** Our own relay (a Cloudflare Worker, see `relay/`). `?relay=ws://…` overrides it for testing. */
export const RELAY_URL: string =
  (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('relay') : null) ??
  (import.meta.env.VITE_RELAY_URL as string | undefined) ??
  'wss://relay.lamplight.cards';
const ROOM_PREFIX = 'lamplight-v1-';
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const KEEPALIVE_MS = 25_000;
const QUEUE_LIMIT = 200;
/**
 * Messages exchanged through the relay with a peer before a direct link is worth setting up.
 * Guests only say hello to each other (all game traffic goes through the host), so this keeps a
 * table to one link per guest instead of a link between every pair of phones.
 */
const LINK_AFTER = 3;

type FromRelay =
  | { t: 'welcome'; peers: string[] }
  | { t: 'join' | 'leave'; peer: string }
  | { t: 'msg'; from: string; d?: Msg; s?: Signal };
type Signal = { sdp: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit };

interface Link {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  /** ICE candidates that arrived before the remote description. */
  early: RTCIceCandidateInit[];
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => (b % 36).toString(36)).join('');

/**
 * Devices meet through the Lamplight relay (one WebSocket per device, one Durable Object per
 * table), which also passes along WebRTC offers so each pair of devices can open a direct data
 * channel. Messages go over the direct channel whenever it's open, so on the same WiFi game
 * traffic stays in the room; until then, or if a network won't allow direct links, the relay
 * carries them. Drops and reconnects are handled here, so callers just see peers come and go.
 */
export class RelayTransport implements Transport {
  readonly kind = 'relay';
  readonly selfId = randomId();
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  private ws: WebSocket | null = null;
  /** Peers the relay says are at the table. */
  private present = new Set<string>();
  /** Peers we've told our owner about (here via the relay, a direct link, or both). */
  private known = new Set<string>();
  private links = new Map<string, Link>();
  /** Messages exchanged with each peer through the relay (see LINK_AFTER). */
  private traffic = new Map<string, number>();
  private queue: string[] = [];
  private closed = false;
  private retries = 0;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private readonly direct: boolean;

  constructor(
    private code: string,
    private url = RELAY_URL,
    opts: { direct?: boolean } = {},
  ) {
    this.direct = (opts.direct ?? true) && typeof RTCPeerConnection !== 'undefined';
    this.connect();
  }

  // ---- relay connection ----------------------------------------------------------------

  private connect() {
    if (this.closed) return;
    const ws = new WebSocket(`${this.url.replace(/\/$/, '')}/room/${ROOM_PREFIX}${this.code}?peer=${this.selfId}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      for (const text of this.queue.splice(0)) ws.send(text);
      this.keepalive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), KEEPALIVE_MS);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      try {
        this.fromRelay(JSON.parse(e.data as string) as FromRelay);
      } catch (err) {
        console.warn('Bad relay message', err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.keepalive) clearInterval(this.keepalive);
      // everyone we only reached through the relay is gone for now
      for (const peer of [...this.present]) {
        this.present.delete(peer);
        this.update(peer);
      }
      if (this.closed) return;
      const delay = Math.min(15_000, 500 * 2 ** this.retries++) * (0.75 + Math.random() * 0.5);
      setTimeout(() => this.connect(), delay);
    };
  }

  private toRelay(envelope: { to?: string; d?: Msg; s?: Signal }) {
    const text = JSON.stringify(envelope);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else if (this.queue.length < QUEUE_LIMIT) this.queue.push(text);
  }

  private fromRelay(m: FromRelay) {
    if (m.t === 'welcome') for (const p of m.peers) this.arrived(p);
    else if (m.t === 'join') this.arrived(m.peer);
    else if (m.t === 'leave') {
      this.present.delete(m.peer);
      this.update(m.peer);
    } else if (m.t === 'msg') {
      if (m.s) void this.signal(m.from, m.s);
      else if (m.d) {
        this.counted(m.from);
        this.onMessage(m.d, m.from);
      }
    }
  }

  private arrived(peer: string) {
    this.present.add(peer);
    this.update(peer);
  }

  /** Count a message through the relay; peers that really talk get a direct link. */
  private counted(peer: string) {
    const n = (this.traffic.get(peer) ?? 0) + 1;
    this.traffic.set(peer, n);
    if (n >= LINK_AFTER) this.offerLink(peer);
  }

  /** Tell our owner when a peer becomes reachable (relay or direct) or stops being reachable. */
  private update(peer: string) {
    const here = this.present.has(peer) || this.linkOpen(peer);
    if (here && !this.known.has(peer)) {
      this.known.add(peer);
      this.onPeerJoin(peer);
    } else if (!here && this.known.has(peer)) {
      this.known.delete(peer);
      this.dropLink(peer);
      this.onPeerLeave(peer);
    }
  }

  // ---- direct WebRTC links ---------------------------------------------------------------

  private linkOpen(peer: string) {
    return this.links.get(peer)?.dc.readyState === 'open';
  }

  private makeLink(peer: string): Link {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // both sides create the same pre-agreed channel, so neither has to wait to be offered one
    const dc = pc.createDataChannel('m', { negotiated: true, id: 0, ordered: true });
    const link: Link = { pc, dc, early: [] };
    this.links.set(peer, link);
    pc.onicecandidate = (e) => e.candidate && this.toRelay({ to: peer, s: { ice: e.candidate.toJSON() } });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.linkLost(peer, link);
    };
    dc.onopen = () => this.update(peer);
    dc.onclose = () => this.linkLost(peer, link);
    dc.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data as string) as Msg, peer);
      } catch (err) {
        console.warn('Bad direct message', err);
      }
    };
    return link;
  }

  /** The lower id makes the offer, so two devices never offer each other at once. */
  private offerLink(peer: string) {
    if (!this.direct || this.closed || this.links.has(peer) || this.selfId > peer) return;
    const { pc } = this.makeLink(peer);
    void (async () => {
      try {
        await pc.setLocalDescription(await pc.createOffer());
        this.toRelay({ to: peer, s: { sdp: pc.localDescription!.toJSON() } });
      } catch (e) {
        console.warn('Direct link offer failed', e);
      }
    })();
  }

  private async signal(from: string, s: Signal) {
    if (!this.direct || this.closed) return;
    try {
      if ('sdp' in s) {
        if (s.sdp.type === 'offer') {
          // a fresh offer replaces any half-made link (the other side may have restarted)
          this.dropLink(from);
          const link = this.makeLink(from);
          await link.pc.setRemoteDescription(s.sdp);
          await link.pc.setLocalDescription(await link.pc.createAnswer());
          this.toRelay({ to: from, s: { sdp: link.pc.localDescription!.toJSON() } });
          for (const c of link.early.splice(0)) await link.pc.addIceCandidate(c);
        } else {
          const link = this.links.get(from);
          if (link?.pc.signalingState !== 'have-local-offer') return;
          await link.pc.setRemoteDescription(s.sdp);
          for (const c of link.early.splice(0)) await link.pc.addIceCandidate(c);
        }
      } else {
        const link = this.links.get(from);
        if (!link) return;
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(s.ice);
        else link.early.push(s.ice);
      }
    } catch (e) {
      console.warn('Direct link signalling failed', e);
    }
  }

  private linkLost(peer: string, link: Link) {
    if (this.links.get(peer) !== link) return;
    this.dropLink(peer);
    this.update(peer);
    // try again in a while if they're still at the table (e.g. after switching networks)
    setTimeout(() => this.present.has(peer) && this.offerLink(peer), 5000);
  }

  private dropLink(peer: string) {
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    link.dc.onclose = null;
    link.pc.onconnectionstatechange = null;
    link.dc.close();
    link.pc.close();
  }

  // ---- Transport -------------------------------------------------------------------------

  send(msg: Msg, to?: string) {
    if (!to) {
      for (const peer of this.known) this.send(msg, peer);
      return;
    }
    const link = this.links.get(to);
    if (link?.dc.readyState === 'open') {
      try {
        link.dc.send(JSON.stringify(msg));
        return;
      } catch {
        /* fall back to the relay */
      }
    }
    this.counted(to);
    this.toRelay({ to, d: msg });
  }

  /** The relay counts as one "relay"; `direct` is how many devices we reach without it. */
  relays(): { up: number; total: number; direct: number } {
    return {
      up: this.ws?.readyState === WebSocket.OPEN ? 1 : 0,
      total: 1,
      direct: [...this.links.keys()].filter((p) => this.linkOpen(p)).length,
    };
  }

  leave() {
    this.closed = true;
    if (this.keepalive) clearInterval(this.keepalive);
    for (const peer of [...this.links.keys()]) this.dropLink(peer);
    this.ws?.close();
    this.ws = null;
  }
}
