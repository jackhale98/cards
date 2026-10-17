import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayTransport } from '../src/net/relayTransport';
import { EventLink } from '../src/net/eventLink';
import { newSecret } from '../src/net/eventCrypto';

/** An in-memory stand-in for the relay (same protocol as relay/src/index.ts). */
class FakeRelay {
  sockets = new Set<FakeSocket>();
  up = true;
  /** Host handoff, per room: the host's claim and the key it left (as relay/src/index.ts). */
  claims = new Map<string, { key: string; seen: number }>();
  escrow = new Map<string, string>();
  /** Hash of the takeover token, per room. */
  gates = new Map<string, string>();
  /** Open sockets at the same table as `s` (not `s` itself). */
  mates(s: FakeSocket) {
    return [...this.sockets].filter((o) => o !== s && o.room === s.room && o.readyState === 1);
  }
  connect(s: FakeSocket) {
    if (!this.up) return queueMicrotask(() => s.drop());
    // a peer id belongs to whoever holds its secret
    if ([...this.sockets].some((o) => o.room === s.room && o.peer === s.peer && o.readyState === 1 && o.secret !== s.secret))
      return queueMicrotask(() => s.drop());
    if (s.host && [...this.sockets].some((o) => o.room === s.room && o.host && o.host !== s.host && o.readyState === 1)) {
      // another host has this code
      return queueMicrotask(() => {
        s.readyState = 1;
        s.deliver({ t: 'taken' });
        s.drop();
      });
    }
    const claim = s.host ? this.claims.get(s.room) : undefined;
    if (s.host && claim && claim.key !== s.host && Date.now() - claim.seen < 30 * 60_000) {
      return queueMicrotask(() => {
        s.readyState = 1;
        s.deliver({ t: 'taken' });
        s.drop();
      });
    }
    if (s.host) this.claims.set(s.room, { key: s.host, seen: Date.now() });
    this.sockets.add(s);
    queueMicrotask(() => {
      s.readyState = 1;
      s.onopen?.();
      const host = this.mates(s).find((o) => o.host);
      s.deliver({ t: 'welcome', v: 2, peers: this.mates(s).map((o) => o.peer), ...(host ? { host: host.peer } : {}) });
      for (const o of this.mates(s)) o.deliver({ t: 'join', peer: s.peer });
    });
  }
  receive(from: FakeSocket, text: string) {
    if (text === 'ping') return from.deliver('pong');
    const env = JSON.parse(text);
    if (env.k === 'deposit') {
      if (from.host && this.claims.get(from.room)?.key === from.host) {
        this.escrow.set(from.room, env.key);
        if (env.gate) this.gates.set(from.room, env.gate);
        else this.gates.delete(from.room);
      }
      from.alive = Date.now();
      return;
    }
    if (env.k === 'takeover') {
      const hostHere = this.mates(from).some((o) => o.host && Date.now() - (o.alive ?? 0) < 40_000);
      const key = this.escrow.get(from.room);
      const claim = this.claims.get(from.room);
      if (hostHere) return from.deliver({ t: 'takeover', error: 'host-here' });
      if (!key) return from.deliver({ t: 'takeover', error: 'no-backup' });
      if (claim && Date.now() - claim.seen < 20_000) return from.deliver({ t: 'takeover', error: 'too-soon' });
      const gate = this.gates.get(from.room);
      if (gate && (!env.token || createHash('sha256').update(env.token).digest('hex') !== gate)) return from.deliver({ t: 'takeover', error: 'not-a-player' });
      this.escrow.delete(from.room);
      this.gates.delete(from.room);
      this.claims.set(from.room, { key: env.host, seen: Date.now() });
      return from.deliver({ t: 'takeover', key });
    }
    const out = { t: 'msg', from: from.peer, ...(from.host ? { h: 1 } : {}), ...(env.s ? { s: env.s } : { d: env.d }) };
    for (const o of this.mates(from)) if (!env.to || o.peer === env.to) o.deliver(out);
  }
  close(s: FakeSocket) {
    if (!this.sockets.has(s)) return;
    if (s.host && this.claims.get(s.room)?.key === s.host) this.claims.set(s.room, { key: s.host, seen: Date.now() });
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
  secret: string | null;
  alive?: number;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(url: string) {
    this.peer = new URL(url).searchParams.get('peer')!;
    this.room = new URL(url).pathname;
    this.host = new URL(url).searchParams.get('host');
    this.secret = new URL(url).searchParams.get('secret');
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

describe('host handoff through the relay', () => {
  it('releases the backup key only once the host has been gone a while, to one device', async () => {
    const host = new RelayTransport('HNDFF', 'ws://relay.test', { hostKey: 'old-host-key' });
    await host.deposit('k'.repeat(43));
    const a = new RelayTransport('HNDFF', 'ws://relay.test');
    const b = new RelayTransport('HNDFF', 'ws://relay.test');
    await flush();
    // the host is here: no takeover
    expect(await a.takeover('new-host-key-a')).toEqual({ t: 'takeover', error: 'host-here' });
    host.leave();
    await flush();
    // it only just left
    expect(await a.takeover('new-host-key-a')).toEqual({ t: 'takeover', error: 'too-soon' });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await a.takeover('new-host-key-a')).toEqual({ t: 'takeover', key: 'k'.repeat(43) });
    // someone else asking second gets nothing
    expect(await b.takeover('new-host-key-b')).toEqual({ t: 'takeover', error: 'no-backup' });
    // the code now belongs to the new host; the old one coming back is turned away
    const back = new RelayTransport('HNDFF', 'ws://relay.test', { hostKey: 'old-host-key' });
    let taken = 0;
    back.onTaken = () => taken++;
    await flush();
    expect(taken).toBe(1);
    const fresh = new RelayTransport('HNDFF', 'ws://relay.test', { hostKey: 'new-host-key-a' });
    let refused = 0;
    fresh.onTaken = () => refused++;
    await flush();
    expect(refused).toBe(0);
    for (const t of [a, b, fresh]) t.leave();
  });

  it('a host whose phone fell asleep (socket open, no heartbeat) counts as gone', async () => {
    const host = new RelayTransport('SLEEP', 'ws://relay.test', { hostKey: 'sleepy-host-key' });
    await host.deposit('z'.repeat(43));
    const a = new RelayTransport('SLEEP', 'ws://relay.test');
    await flush();
    // heartbeats keep it present
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await a.takeover('taker-host-key')).toEqual({ t: 'takeover', error: 'host-here' });
    // the phone sleeps: its socket stays open but its timers stop
    vi.spyOn(FakeSocket.prototype, 'send').mockImplementation(function (this: FakeSocket, text: string) {
      if (this.host === 'sleepy-host-key') return;
      if (this.readyState === 1) relay.receive(this, text);
    });
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await a.takeover('taker-host-key')).key).toBe('z'.repeat(43));
    vi.restoreAllMocks();
    host.leave();
    a.leave();
  });

  it('only a player holding the token from their backups may take over', async () => {
    const host = new RelayTransport('GATED', 'ws://relay.test', { hostKey: 'gated-host-key' });
    await host.deposit('g'.repeat(43), 'the-token');
    const stranger = new RelayTransport('GATED', 'ws://relay.test');
    await flush();
    host.leave();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await stranger.takeover('stranger-host-key')).toEqual({ t: 'takeover', error: 'not-a-player' });
    expect(await stranger.takeover('stranger-host-key', 'a-guess')).toEqual({ t: 'takeover', error: 'not-a-player' });
    expect((await stranger.takeover('player-host-key', 'the-token')).key).toBe('g'.repeat(43));
    stranger.leave();
  });
});

describe('who is who on the relay', () => {
  it('vouches for the host, and for nobody else', async () => {
    const host = new RelayTransport('VOUCH', 'ws://relay.test', { hostKey: 'vouch-host-key' });
    const guest = new RelayTransport('VOUCH', 'ws://relay.test');
    const other = new RelayTransport('VOUCH', 'ws://relay.test');
    await flush();
    // (the welcome named the host)
    expect(guest.vouch(host.selfId)).toBe(true);
    expect(guest.vouch(other.selfId)).toBe(false);
    for (const t of [host, guest, other]) t.leave();
  });

  it("can't be fooled by a device using someone else's peer id", async () => {
    const host = new RelayTransport('SPOOF', 'ws://relay.test', { hostKey: 'spoof-host-key' });
    await flush();
    const before = relay.sockets.size;
    // a copycat with the host's id (but not its secret) is refused; the host keeps its socket
    new FakeSocket(`ws://relay.test/room/lamplight-v1-SPOOF?peer=${host.selfId}&secret=nope`);
    await flush();
    expect(relay.sockets.size).toBe(before);
    expect([...relay.sockets].some((s) => s.peer === host.selfId && s.readyState === 1)).toBe(true);
    host.leave();
  });

  it('an older relay that marks nothing leaves it to the client', async () => {
    const guest = new RelayTransport('OLDER', 'ws://relay.test');
    await flush();
    (guest as unknown as { marks: boolean }).marks = false;
    expect(guest.vouch('anyone')).toBeUndefined();
    guest.leave();
  });
});

describe('a tournament’s rooms on the relay', () => {
  it('a phone heeds only the director (the room’s host), not another phone pretending', async () => {
    const director = new RelayTransport('EVBCDF', 'ws://relay.test', { hostKey: 'director-host-key' });
    const said: unknown[] = [];
    director.onMessage = (m) => said.push(m);
    const stranger = new RelayTransport('EVBCDF', 'ws://relay.test');
    await flush();
    const link = new EventLink((code) => new RelayTransport(code, 'ws://relay.test'), { code: 'EVBCDF', cid: 'ann', name: 'Ann', secret: newSecret() });
    await flush();
    // (its hello went to the director, not to the other phone)
    expect(said.some((m) => (m as { t: string }).t === 'evJoin')).toBe(true);
    const phone = [...relay.sockets].find((s) => s.peer !== director.selfId && s.peer !== stranger.selfId)!.peer;
    const board = {
      name: 'Fake',
      format: 'swiss',
      game: { id: 'hearts', options: {} },
      phase: 'done',
      round: 9,
      entrants: [],
      standings: [],
      tables: [],
      byes: [],
    };
    stranger.send({ t: 'evBoard', board, people: [] } as never, phone);
    stranger.send({ t: 'evRefused', why: 'go away' } as never, phone);
    stranger.send({ t: 'evRoom', code: 'QRSTV' } as never, phone);
    await flush();
    expect(link.board).toBeNull();
    expect(link.refused).toBeNull();
    director.send({ t: 'evBoard', board, people: [] } as never, phone);
    await flush();
    expect(link.board?.board.round).toBe(9);
    link.close();
    director.leave();
    stranger.leave();
  });
});
