import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { Host } from '../src/net/host';
import type { View } from '../src/net/protocol';
import { Bus, MemTransport } from './netHarness';

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
      const c = new Client(t, id, name, { emoji: '🦊', color: '#e9c46a' });
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
    expect(host.lobby.seats[1].avatar).toEqual({ emoji: '🦊', color: '#e9c46a' });
  });

  it('rejects unsafe avatars and lets players update theirs', () => {
    const { host, mk } = setup();
    const a = mk('a', 'Ann');
    a.c.updateProfile('Annie', { emoji: '<img>', color: 'red' });
    expect(host.lobby.seats[1].name).toBe('Annie');
    expect(host.lobby.seats[1].avatar).toEqual({ emoji: '🦊', color: '#e9c46a' });
    a.c.updateProfile('Annie', { emoji: '🐙', color: '#5fb3d9' });
    expect(host.lobby.seats[1].avatar).toEqual({ emoji: '🐙', color: '#5fb3d9' });
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
    const c2 = new Client(again, 'a', 'Ann', undefined);
    bus.join(again);
    expect(host.lobby.seats[1].connected).toBe(true);
    expect(c2.view!.you).toBe(1);
    expect(c2.view!.state!.zones['hand:1'].cards.every((c) => !c.id.startsWith('?'))).toBe(true);
  });

  it('falls back to a safe move when a bot proposes an illegal one', () => {
    const { host } = setup();
    host.addBot();
    host.addBot();
    host.start();
    // a broken bot: always asks for something the rules won't allow
    const m = (host as any).module;
    (host as any).module = { ...m, bot: (st: any, seat: number) => (st.phase === 'betting' && st.turn === seat ? { type: 'shuffleTheTable' } : null) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // get past the human seat so a bot is to act
    if (host.state!.turn === 0) host.act('h', { type: 'call' });
    const turnBefore = host.state!.turn;
    expect(turnBefore).not.toBe(0);
    for (let i = 0; i < 5 && host.state!.turn === turnBefore; i++) vi.advanceTimersByTime(1500);
    expect(host.state!.turn).not.toBe(turnBefore);
    warn.mockRestore();
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

describe('connection health', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reaches the host over several networks without duplicating the seat', async () => {
    const { MultiTransport } = await import('../src/net/multiTransport');
    const nostr = new Bus();
    const mqtt = new Bus();
    const mk = (bus: Bus, id: string, kind: string) => Object.assign(new MemTransport(bus, id), { kind });
    // host on both networks, guest on both
    const hostT = new MultiTransport();
    const hn = mk(nostr, 'h-n', 'nostr');
    const hm = mk(mqtt, 'h-m', 'mqtt');
    hostT.add(hn);
    hostT.add(hm);
    const host = new Host(hostT, 'ABCD', { cid: 'h', name: 'H', key: 'hk' });
    nostr.join(hn);
    mqtt.join(hm);
    const guestT = new MultiTransport();
    const gn = mk(nostr, 'g-n', 'nostr');
    guestT.add(gn);
    // (the seat's key lets the second network's connection sit in the same seat)
    const guest = new Client(guestT, 'g', 'G', undefined, false, 'gk');
    nostr.join(gn);
    expect(guest.connected).toBe(true);
    // the guest adds a backup network later: same seat, not a new player
    const gm = mk(mqtt, 'g-m', 'mqtt');
    guestT.add(gm);
    mqtt.join(gm);
    expect(host.lobby.seats.map((s) => s.id)).toEqual(['h', 'g']);
    // losing one network: the guest carries on over the other (its hello timer says hello again
    // within a couple of seconds; nudged here), showing its key to the host there
    gn.leave();
    guest.nudge();
    expect(guest.connected).toBe(true);
    expect(host.lobby.seats.map((s) => [s.id, s.connected])).toEqual([['h', true], ['g', true]]);
    expect(guest.view!.lobby.seats).toHaveLength(2);
    expect(hostT.status().networks.map((n) => n.kind)).toEqual(['nostr', 'mqtt']);
  });

  it('measures ping and drops a silent peer, then welcomes it back', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    let pings: (number | null)[] = [];
    host.onPings = (p) => (pings = p);
    bus.join(ht);
    const gt = new MemTransport(bus, 'guest');
    const guest = new Client(gt, 'g', 'G', undefined);
    let guestPings: (number | null)[] = [];
    guest.onPings = (p) => (guestPings = p);
    bus.join(gt);
    vi.advanceTimersByTime(3100);
    expect(pings).toHaveLength(2);
    expect(pings[0]).toBe(0);
    expect(typeof pings[1]).toBe('number');
    expect(guestPings).toEqual(pings);

    // the guest's phone goes to sleep: silent both ways, but WebRTC hasn't noticed yet
    const receive = gt.onMessage;
    const send = gt.send.bind(gt);
    gt.onMessage = () => {};
    gt.send = () => {};
    vi.advanceTimersByTime(16000);
    // before the game starts, a vanished player's seat is freed
    expect(host.lobby.seats.map((s) => s.id)).toEqual(['h']);
    // the guest also notices the host has gone quiet
    expect(guest.connected).toBe(false);

    // the phone wakes up and says hello: back at the table
    gt.onMessage = receive;
    gt.send = send;
    guest.nudge();
    expect(guest.connected).toBe(true);
    expect(host.lobby.seats.map((s) => s.id)).toEqual(['h', 'g']);
  });

  it('keeps a sleeping player’s seat during a game', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    bus.join(ht);
    const gt = new MemTransport(bus, 'guest');
    const guest = new Client(gt, 'g', 'G', undefined);
    bus.join(gt);
    host.start();
    gt.onMessage = () => {};
    gt.send = () => {};
    vi.advanceTimersByTime(16000);
    expect(host.lobby.seats[1]).toMatchObject({ id: 'g', connected: false });
    void guest;
  });
});
