import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayTransport } from '../src/net/relayTransport';

/** An in-memory stand-in for the relay (same protocol as relay/src/index.ts). */
class FakeRelay {
  sockets = new Set<FakeSocket>();
  up = true;
  /** Open sockets at the same table as `s` (not `s` itself). */
  mates(s: FakeSocket) {
    return [...this.sockets].filter((o) => o !== s && o.room === s.room && o.readyState === 1);
  }
  connect(s: FakeSocket) {
    if (!this.up) return queueMicrotask(() => s.drop());
    if (s.host && [...this.sockets].some((o) => o.room === s.room && o.host && o.host !== s.host && o.readyState === 1)) {
      // another host has this code
      return queueMicrotask(() => {
        s.readyState = 1;
        s.deliver({ t: 'taken' });
        s.drop();
      });
    }
    this.sockets.add(s);
    queueMicrotask(() => {
      s.readyState = 1;
      s.onopen?.();
      s.deliver({ t: 'welcome', peers: this.mates(s).map((o) => o.peer) });
      for (const o of this.mates(s)) o.deliver({ t: 'join', peer: s.peer });
    });
  }
  receive(from: FakeSocket, text: string) {
    if (text === 'ping') return from.deliver('pong');
    const env = JSON.parse(text);
    const out = { t: 'msg', from: from.peer, ...(env.s ? { s: env.s } : { d: env.d }) };
    for (const o of this.mates(from)) if (!env.to || o.peer === env.to) o.deliver(out);
  }
  close(s: FakeSocket) {
    if (!this.sockets.has(s)) return;
    for (const o of this.mates(s)) o.deliver({ t: 'leave', peer: s.peer });
    this.sockets.delete(s);
  }
  /** The relay restarts: everyone is disconnected. */
  crash() {
    this.up = false;
    for (const s of [...this.sockets]) s.drop();
    this.sockets.clear();
  }
}

let relay: FakeRelay;
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  peer: string;
  room: string;
  host: string | null;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(url: string) {
    this.peer = new URL(url).searchParams.get('peer')!;
    this.room = new URL(url).pathname;
    this.host = new URL(url).searchParams.get('host');
    relay.connect(this);
  }
  deliver(m: unknown) {
    if (this.readyState === 1) this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) });
  }
  send(text: string) {
    if (this.readyState === 1) relay.receive(this, text);
  }
  drop() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  close() {
    relay.close(this);
    this.drop();
  }
}

function device(code = 'ABCD') {
  const t = new RelayTransport(code, 'ws://relay.test');
  const got: { msg: unknown; from: string }[] = [];
  const joined: string[] = [];
  const left: string[] = [];
  t.onMessage = (msg, from) => got.push({ msg, from });
  t.onPeerJoin = (p) => joined.push(p);
  t.onPeerLeave = (p) => left.push(p);
  return { t, got, joined, left };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  relay = new FakeRelay();
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('relay transport', () => {
  it('meets other devices and passes messages to one or everyone', async () => {
    const a = device();
    await flush();
    const b = device();
    const c = device();
    await flush();
    expect(a.joined.sort()).toEqual([b.t.selfId, c.t.selfId].sort());
    expect(c.joined.sort()).toEqual([a.t.selfId, b.t.selfId].sort());
    a.t.send({ t: 'ping', ts: 1 }, b.t.selfId);
    a.t.send({ t: 'pong', ts: 2 });
    await flush();
    expect(b.got).toEqual([
      { msg: { t: 'ping', ts: 1 }, from: a.t.selfId },
      { msg: { t: 'pong', ts: 2 }, from: a.t.selfId },
    ]);
    expect(c.got).toEqual([{ msg: { t: 'pong', ts: 2 }, from: a.t.selfId }]);
    c.t.leave();
    await flush();
    expect(a.left).toEqual([c.t.selfId]);
  });

  it('holds messages until connected', async () => {
    const a = device();
    await flush();
    const b = device();
    // b isn't connected yet: queue rather than drop
    b.t.send({ t: 'pong', ts: 9 }, a.t.selfId);
    await flush();
    expect(a.got.map((g) => g.msg)).toEqual([{ t: 'pong', ts: 9 }]);
  });

  it('reconnects after the relay drops, with backoff, and finds everyone again', async () => {
    const a = device();
    const b = device();
    await flush();
    relay.crash();
    await flush();
    expect(a.left).toEqual([b.t.selfId]);
    expect(b.left).toEqual([a.t.selfId]);
    // still down: retries keep failing quietly
    await vi.advanceTimersByTimeAsync(3000);
    relay.up = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(a.joined).toEqual([b.t.selfId, b.t.selfId]);
    a.t.send({ t: 'ping', ts: 3 }, b.t.selfId);
    await flush();
    expect(b.got.at(-1)).toEqual({ msg: { t: 'ping', ts: 3 }, from: a.t.selfId });
  });

  it('keeps the connection alive and reports its status', async () => {
    const a = device();
    await flush();
    expect(a.t.relays()).toEqual({ up: 1, total: 1, direct: 0 });
    const sent = vi.spyOn(FakeSocket.prototype, 'send');
    await vi.advanceTimersByTimeAsync(26_000);
    expect(sent).toHaveBeenCalledWith('ping');
    a.t.leave();
    expect(a.t.relays().up).toBe(0);
  });

  it('tables are separate', async () => {
    const a = device('AAAA');
    const b = device('BBBB');
    await flush();
    expect([...relay.sockets].map((s) => s.room).sort()).toEqual(['/room/lamplight-v1-AAAA', '/room/lamplight-v1-BBBB']);
    expect(a.joined).toEqual([]);
    expect(b.joined).toEqual([]);
  });
});

describe('one host per table code', () => {
  it('a second host on a code in use is told so, and stops trying', async () => {
    const first = new RelayTransport('BCDFG', 'ws://relay.test', { hostKey: 'first-host-key' });
    await flush();
    const second = new RelayTransport('BCDFG', 'ws://relay.test', { hostKey: 'other-host-key' });
    let taken = 0;
    second.onTaken = () => taken++;
    await flush();
    expect(taken).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(taken).toBe(1); // no reconnect attempts
    // guests and the first host are unaffected
    const guest = new RelayTransport('BCDFG', 'ws://relay.test');
    const seen: string[] = [];
    guest.onPeerJoin = (p) => seen.push(p);
    await flush();
    expect(seen).toEqual([first.selfId]);
    first.leave();
    guest.leave();
  });
});
