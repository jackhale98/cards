import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { Host } from '../src/net/host';
import type { Msg, View } from '../src/net/protocol';
import type { Transport } from '../src/net/transport';

/** In-memory room: delivers messages synchronously between transports, JSON-cloned like the wire. */
class Bus {
  members = new Map<string, MemTransport>();
  join(t: MemTransport) {
    const others = [...this.members.values()];
    this.members.set(t.selfId, t);
    for (const other of others) {
      other.onPeerJoin(t.selfId);
      t.onPeerJoin(other.selfId);
    }
  }
  leave(t: MemTransport) {
    this.members.delete(t.selfId);
    for (const other of this.members.values()) other.onPeerLeave(t.selfId);
  }
}

class MemTransport implements Transport {
  kind = 'memory';
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  sent: Msg[] = [];
  constructor(
    private bus: Bus,
    readonly selfId: string,
  ) {}
  send(msg: Msg, to?: string) {
    const wire = JSON.parse(JSON.stringify(msg));
    this.sent.push(wire);
    for (const m of this.bus.members.values()) if (m !== this && (!to || to === m.selfId)) m.onMessage(wire, this.selfId);
  }
  leave() {
    this.bus.leave(this);
  }
}

describe('host ↔ clients', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host-peer');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'Hana' });
    let hostView: View | null = null;
    host.onLocalView = (v) => (hostView = v);
    bus.join(ht);
    const mk = (id: string, name: string) => {
      const t = new MemTransport(bus, `${id}-peer`);
      const c = new Client(t, id, name);
      bus.join(t);
      return { c, t };
    };
    return { bus, host, mk, hostView: () => hostView! };
  }

  it('seats players as they join and shares the lobby', () => {
    const { host, mk } = setup();
    const a = mk('a', 'Ann');
    const b = mk('b', 'Ben');
    expect(host.lobby.seats.map((s) => s.name)).toEqual(['Hana', 'Ann', 'Ben']);
    expect(a.c.view?.lobby.seats).toHaveLength(3);
    expect(b.c.connected).toBe(true);
  });

  it('runs a hearts game where clients only see their own cards', () => {
    const { host, mk, hostView } = setup();
    const a = mk('a', 'Ann');
    const b = mk('b', 'Ben');
    host.setGame('hearts');
    host.addBot();
    expect(host.canStart()).toBeNull();
    host.start();

    const view = a.c.view!;
    expect(view.you).toBe(1);
    const mine = view.state!.zones['hand:1'].cards.map((c) => c.id);
    expect(mine).toHaveLength(13);
    expect(mine.every((id) => !id.startsWith('?'))).toBe(true);
    // nothing about other hands leaks into the JSON a client receives
    const real = host.state!;
    const wire = JSON.stringify(view);
    for (const seat of [0, 2, 3]) for (const c of real.zones[`hand:${seat}`].cards) expect(wire).not.toContain(`"${c.id}"`);

    // everyone passes; the bot passes on a timer
    const three = (seat: number) => real.zones[`hand:${seat}`].cards.slice(0, 3).map((c) => c.id);
    expect(host.act('h', { type: 'pass', cards: three(0) })).toBeNull();
    a.c.act({ type: 'pass', cards: three(1) });
    b.c.act({ type: 'pass', cards: three(2) });
    vi.advanceTimersByTime(2000);
    expect(host.state!.phase).toBe('play');
    expect(hostView().state!.phase).toBe('play');

    // illegal move from a client is rejected with a message
    const errors: string[] = [];
    a.c.onError = (m) => errors.push(m);
    const card = host.state!.zones['hand:1'].cards.find((c) => c.id !== '2C')!.id;
    const before = host.state!.zones.trick.cards.length;
    a.c.act({ type: 'play', cards: [card] });
    expect(errors).toHaveLength(1);
    expect(host.state!.zones.trick.cards).toHaveLength(before);
  });

  it('keeps a seat across reconnects', () => {
    const { bus, host, mk } = setup();
    const a = mk('a', 'Ann');
    host.setGame('holdem');
    host.start();
    a.t.leave();
    expect(host.lobby.seats[1].connected).toBe(false);
    const again = new MemTransport(bus, 'a-peer-2');
    const c2 = new Client(again, 'a', 'Ann');
    bus.join(again);
    expect(host.lobby.seats[1].connected).toBe(true);
    expect(c2.view!.you).toBe(1);
    expect(c2.view!.state!.zones['hand:1'].cards.every((c) => !c.id.startsWith('?'))).toBe(true);
  });

  it('lets bots finish a hold’em hand', () => {
    const { host, hostView } = setup();
    host.addBot();
    host.addBot();
    host.start();
    for (let i = 0; i < 200 && host.state!.phase !== 'handOver'; i++) {
      const v = hostView();
      if (v.state!.turn === 0) host.act('h', { type: v.actions.some((a) => a.type === 'check') ? 'check' : 'fold' });
      vi.advanceTimersByTime(1500);
    }
    expect(host.state!.phase).toBe('handOver');
  });
});
