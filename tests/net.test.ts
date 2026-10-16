import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { DEAD_AFTER_MS, HEARTBEAT_MS, Host, PING_AFTER_MS, STAND_IN } from '../src/net/host';
import type { View } from '../src/net/protocol';
import { loadRules } from '../src/games';
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

  it('a host opens its table before its connection is ready, and seats players once it is', () => {
    const bus = new Bus();
    const host = new Host(null, 'ABCD', { cid: 'h', name: 'Hana' });
    let hostView: View | null = null;
    host.onLocalView = (v) => (hostView = v);
    host.broadcast();
    // the host's own screen: the lobby, at once
    expect(hostView!.lobby.seats.map((s) => s.name)).toEqual(['Hana']);
    // the connection arrives; a player joins over it
    const ht = new MemTransport(bus, 'host-peer');
    host.attach(ht);
    bus.join(ht);
    const t = new MemTransport(bus, 'a-peer');
    const a = new Client(t, 'a', 'Ann', { emoji: '🦊', color: '#e9c46a' });
    bus.join(t);
    expect(host.lobby.seats.map((s) => s.name)).toEqual(['Hana', 'Ann']);
    expect(a.view?.lobby.seats).toHaveLength(2);
  });

  it('sends players only what changed, and they end with the same table as a whole view', async () => {
    await loadRules('hearts');
    const { host, mk, bus } = setup();
    const a = mk('a', 'Ann');
    host.setGame('hearts');
    host.addBot();
    host.addBot();
    host.start();
    const hostSent = (bus.members.get('host-peer') as MemTransport).sent;
    hostSent.length = 0;
    for (let i = 0; i < 30; i++) {
      for (const [cid, c] of [
        ['h', null],
        ['a', a.c],
      ] as const) {
        const move = host.botMoveFor(cid);
        if (move && c) c.act(move);
        else if (move) host.act('h', move);
      }
      vi.advanceTimersByTime(1500);
    }
    // the player sees exactly what the host worked out for them, sent mostly as changes
    expect(a.c.view).toEqual(JSON.parse(JSON.stringify((host as unknown as { viewFor(c: string): View }).viewFor('a'))));
    const patches = hostSent.filter((m) => m.t === 'patch');
    expect(patches.length).toBeGreaterThan(10);
    expect(hostSent.filter((m) => m.t === 'view').length).toBeLessThan(patches.length / 5);
  });

  it('a lobby change the host makes in place reaches the player', () => {
    const { host, mk, bus } = setup();
    const a = mk('a', 'Ann');
    host.setGame('gin-rummy');
    expect(a.c.view?.lobby.gameId).toBe('gin-rummy');
    // a small one, after: sent as a patch, against the lobby as it was last sent
    const hostSent = (bus.members.get('host-peer') as MemTransport).sent;
    hostSent.length = 0;
    host.setGame('cribbage');
    expect(a.c.view?.lobby.gameId).toBe('cribbage');
  });

  it('a patch that doesn\u2019t fit (a lost message) brings the whole view again', async () => {
    await loadRules('hearts');
    const { host, mk } = setup();
    const a = mk('a', 'Ann');
    host.setGame('hearts');
    host.addBot();
    host.addBot();
    host.start();
    // the player misses one change: the next patch is built on a view it never had
    const deliver = a.t.onMessage;
    let dropped = false;
    a.t.onMessage = (msg, from) => {
      if (!dropped && msg.t === 'patch') return void (dropped = true);
      deliver(msg, from);
    };
    for (let i = 0; i < 12; i++) {
      for (const [cid, c] of [
        ['h', null],
        ['a', a.c],
      ] as const) {
        const move = host.botMoveFor(cid);
        if (move && c) c.act(move);
        else if (move) host.act('h', move);
      }
      vi.advanceTimersByTime(1500);
    }
    expect(dropped).toBe(true);
    expect(a.c.view).toEqual(JSON.parse(JSON.stringify((host as unknown as { viewFor(c: string): View }).viewFor('a'))));
  });

  it('rejects unsafe avatars and lets players update theirs', () => {
    const { host, mk } = setup();
    const a = mk('a', 'Ann');
    a.c.updateProfile('Annie', { emoji: '<img>', color: 'red' });
    // (hellos from one connection are spaced out: see HELLO_GAP_MS)
    vi.advanceTimersByTime(500);
    expect(host.lobby.seats[1].name).toBe('Annie');
    expect(host.lobby.seats[1].avatar).toEqual({ emoji: '🦊', color: '#e9c46a' });
    a.c.updateProfile('Annie', { emoji: '🐙', color: '#5fb3d9' });
    vi.advanceTimersByTime(500);
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

  it('lets a bot play for a player who drops out, and gives the seat back when they return', () => {
    const { bus, host, mk } = setup();
    const a = mk('a', 'Ann');
    host.setGame('hearts');
    host.addBot();
    host.addBot();
    host.start();
    const three = (seat: number) => host.state!.zones[`hand:${seat}`].cards.slice(0, 3).map((c) => c.id);
    expect(host.act('h', { type: 'pass', cards: three(0) })).toBeNull();
    // Ann's phone dies before she passes: the table waits on her
    a.t.leave();
    vi.advanceTimersByTime(5000);
    expect(host.state!.phase).toBe('pass');
    // only for someone who has dropped out, and only by someone at the table
    expect(host.act('stranger', { type: STAND_IN, seat: 1 })).toBe('You are not at the table');
    expect(host.act('h', { type: STAND_IN, seat: 1 })).toBeNull();
    expect(host.lobby.seats[1].standIn).toBe(true);
    expect(host.state!.players[1].bot).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(host.state!.phase).toBe('play');
    // she's back: her seat (and her hand) are hers again
    const again = new MemTransport(bus, 'a-peer-2');
    const c2 = new Client(again, 'a', 'Ann', undefined);
    bus.join(again);
    expect(host.lobby.seats[1].standIn).toBeUndefined();
    expect(host.state!.players[1].bot).toBeFalsy();
    expect(c2.view!.you).toBe(1);
    // and nobody can hand her seat to a bot while she's connected
    expect(host.act('h', { type: STAND_IN, seat: 1 })).toBe('Ann is back');
  });

  it('take-backs: a player may undo their move until anyone else moves, but never a move that showed them a card', () => {
    const { host, hostView } = setup();
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.setTakeBacks(true);
    host.start();
    const hand = () => host.state!.zones['hand:0'].cards.map((c) => c.id);
    const before = hand();
    expect(host.act('h', { type: 'pass', cards: before.slice(0, 3) })).toBeNull();
    expect(hostView().actions.some((a) => a.label === 'Take back')).toBe(true);
    expect(host.act('h', { type: '__undo' })).toBeNull();
    expect(hand()).toEqual(before);
    // once the table moves on, it's too late
    expect(host.act('h', { type: 'pass', cards: before.slice(3, 6) })).toBeNull();
    vi.advanceTimersByTime(8000);
    expect(host.state!.phase).toBe('play');
    expect(hostView().actions.some((a) => a.label === 'Take back')).toBe(false);
    expect(host.act('h', { type: '__undo' })).toBe('Too late to take that back');
  });

  it('take-backs never undo a draw (it showed you a card)', () => {
    const { host, hostView } = setup();
    host.setGame('gin-rummy');
    host.addBot();
    host.setTakeBacks(true);
    host.start();
    for (let i = 0; i < 40 && !hostView().actions.some((a) => a.zone === 'deck'); i++) {
      // (the bot moves first, or the upcard is offered: decline it until the stock is ours to draw)
      const pass = hostView().actions.find((a) => a.type === 'pass');
      if (pass) host.act('h', { type: 'pass' });
      vi.advanceTimersByTime(3000);
    }
    const draw = hostView().actions.find((a) => a.zone === 'deck')!;
    expect(draw).toBeTruthy();
    expect(host.act('h', { type: draw.type })).toBeNull();
    expect(hostView().actions.some((a) => a.label === 'Take back')).toBe(false);
  });

  it('passes a reaction from someone at the table to everyone, a second apart at most', () => {
    const { host, mk } = setup();
    const a = mk('a', 'Ann');
    const b = mk('b', 'Ben');
    const seen: [string, number][] = [];
    b.c.onReact = (id, e) => seen.push([id, e]);
    a.c.react(2);
    a.c.react(3);
    // (only the fixed few, from people at the table)
    a.c.react(99);
    expect(host.react('stranger', 0)).toBe(false);
    expect(seen).toEqual([['a', 2]]);
    vi.advanceTimersByTime(1100);
    a.c.react(3);
    expect(seen).toEqual([
      ['a', 2],
      ['a', 3],
    ]);
  });

  it('a host resuming in a new browser session (a new client id) keeps its seat in the game', () => {
    const { host } = setup();
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    const snap = structuredClone({ lobby: host.lobby, state: host.state, keys: { h: 'old-key' } });
    host.close();
    const resumed = new Host(null, 'ABCD', { cid: 'h2', name: 'Hana', key: 'new-key' }, snap);
    expect(resumed.viewFor('h2').you).toBe(0);
    const mine = resumed.state!.zones['hand:0'].cards.slice(0, 3).map((c) => c.id);
    expect(resumed.act('h2', { type: 'pass', cards: mine })).toBeNull();
    resumed.close();
  });

  it('a host that has closed deals no game and saves nothing more', () => {
    const { host } = setup();
    host.addBot();
    let saved = 0;
    host.onPersist = () => saved++;
    host.close();
    host.start();
    host.broadcast();
    expect(host.state).toBeNull();
    expect(saved).toBe(0);
  });

  it('lets bots finish a hold’em hand, and keeps the chips hand by hand for the score chart', () => {
    const { host, hostView } = setup();
    host.addBot();
    host.addBot();
    host.start();
    expect(host.lobby.scores).toEqual({ names: ['Hana', 'Ada', 'Bix'], totals: [[1000, 1000, 1000]] });
    for (let i = 0; i < 200 && host.state!.phase !== 'handOver'; i++) {
      const v = hostView();
      if (v.state!.turn === 0) host.act('h', { type: v.actions.some((a) => a.type === 'check') ? 'check' : 'fold' });
      vi.advanceTimersByTime(1500);
    }
    expect(host.state!.phase).toBe('handOver');
    const { totals } = hostView().lobby.scores!;
    expect(totals).toHaveLength(2);
    expect(totals[1]).toEqual(host.state!.players.map((p) => p.chips));
    expect(totals[1].reduce((a, b) => a + b)).toBe(3000);
    // a new game starts a new history
    host.endGame();
    expect(host.lobby.scores).toBeUndefined();
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
    expect(host.lobby.seats.map((s) => [s.id, s.connected])).toEqual([
      ['h', true],
      ['g', true],
    ]);
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
    // the guest hears the round trips with its next ping (when it has been quiet a while)
    vi.advanceTimersByTime(PING_AFTER_MS + HEARTBEAT_MS);
    expect(guestPings).toEqual(pings);

    // the guest's phone goes to sleep: silent both ways, but WebRTC hasn't noticed yet
    const receive = gt.onMessage;
    const send = gt.send.bind(gt);
    gt.onMessage = () => {};
    gt.send = () => {};
    vi.advanceTimersByTime(DEAD_AFTER_MS + HEARTBEAT_MS * 2);
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

  it('pings only a connection that has gone quiet, and carries the latency lights only when they change', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    bus.join(ht);
    const gt = new MemTransport(bus, 'guest');
    new Client(gt, 'g', 'G', undefined);
    bus.join(gt);
    vi.advanceTimersByTime(3100); // (the first ping: the round trip is known)
    const pings = () => ht.sent.filter((m) => m.t === 'ping');
    let before = pings().length;
    // a quiet table: a ping every 9 seconds (three beats), not every beat
    vi.advanceTimersByTime(36_000);
    expect(pings().length - before).toBe(4);
    // a busy one (the host sends a change and hears from the guest every half second): only the
    // round-trip refresh, every 30 seconds
    before = pings().length;
    for (let i = 0; i < 120; i++) {
      host.updateSelf(`H${i}`);
      gt.send({ t: 'replay', hand: 0, step: 0 }, 'host');
      vi.advanceTimersByTime(500);
    }
    expect(pings().length - before).toBe(2);
    // the lights went out once (with the first ping after the round trip was known), then not again: nothing changed
    expect(pings().filter((m) => m.t === 'ping' && m.pings).length).toBe(2);
    expect(ht.sent.some((m) => (m.t as string) === 'pings')).toBe(false);
    host.close();
  });

  it('sends nothing when nothing a player can see has changed', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    bus.join(ht);
    const gt = new MemTransport(bus, 'guest');
    const guest = new Client(gt, 'g', 'G', undefined);
    bus.join(gt);
    vi.advanceTimersByTime(1000); // (the guest is seated)
    expect(guest.view?.lobby.seats.map((s) => s.id)).toEqual(['h', 'g']);
    const views = () => ht.sent.filter((m) => m.t === 'view' || m.t === 'patch').length;
    const before = views();
    host.broadcast();
    host.broadcast();
    expect(views()).toBe(before);
    // and the next real change still fits what the guest has
    host.updateSelf('Hana');
    expect(views()).toBe(before + 1);
    expect(guest.view!.lobby.seats[0].name).toBe('Hana');
    expect(guest.view!.v).toBe(host.viewFor('g').v);
    host.close();
  });

  it('sends a person’s views on one of their networks, and moves to another when that one goes quiet', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    bus.join(ht);
    const nets = ['g-relay', 'g-p2p'].map((peer) => {
      const t = new MemTransport(bus, peer);
      const c = new Client(t, 'g', 'G', undefined, false, 'k');
      bus.join(t);
      return { t, c, got: 0 };
    });
    for (const n of nets) {
      const receive = n.t.onMessage;
      n.t.onMessage = (m, from) => {
        if (m.t === 'view' || m.t === 'patch') n.got++;
        receive(m, from);
      };
    }
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 5; i++) host.updateSelf(`H${i}`);
    const [a, b] = nets;
    // one network carries them all
    expect(Math.min(a.got, b.got)).toBe(0);
    const [used, spare] = a.got ? [a, b] : [b, a];
    expect(used.c.view!.lobby.seats[0].name).toBe('H4');
    // that network goes quiet: the next change goes on the other, whole, and the player follows it
    used.t.onMessage = () => {};
    used.t.send = () => {};
    vi.advanceTimersByTime(PING_AFTER_MS + HEARTBEAT_MS * 3);
    spare.got = 0;
    host.updateSelf('Hana');
    host.updateSelf('Hana!');
    expect(spare.got).toBe(2);
    expect(spare.c.view!.lobby.seats[0].name).toBe('Hana!');
    host.close();
  });

  it('works out each person’s view once, however many networks reach them', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    bus.join(ht);
    for (const peer of ['g-relay', 'g-p2p']) {
      const t = new MemTransport(bus, peer);
      new Client(t, 'g', 'G', undefined, false, 'k');
      bus.join(t);
    }
    const spy = vi.spyOn(host, 'viewFor');
    host.broadcast();
    // the host's own, and the guest's (once, for two connections)
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['h', 'g']);
    host.close();
  });

  it('a host waking from sleep doesn’t drop everyone it couldn’t hear while it slept', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    bus.join(ht);
    const gt = new MemTransport(bus, 'guest');
    new Client(gt, 'g', 'G', undefined);
    bus.join(gt);
    vi.advanceTimersByTime(3100);
    // the host's phone locks for a minute: its timers don't run, then it wakes
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(3000);
    expect(host.lobby.seats.map((s) => s.id)).toEqual(['h', 'g']);
    host.close();
  });

  it('shows its seat’s key only to a host of the table it joined (networks that can’t vouch for the host)', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'H' });
    bus.join(ht);
    const gt = new MemTransport(bus, 'guest');
    const guest = new Client(gt, 'g', 'G', undefined, false, 'seat-secret');
    bus.join(gt);
    expect(guest.view!.lobby.tid).toBe(host.lobby.tid);
    // the host drops; someone who knows the code poses as the host and asks who we are
    host.close();
    const ft = new MemTransport(bus, 'faker');
    const heard: unknown[] = [];
    ft.onMessage = (m) => heard.push(m);
    bus.join(ft);
    heard.length = 0;
    ft.send({ t: 'view', view: { ...guest.view!, lobby: { ...guest.view!.lobby, tid: 'not-this-table' }, who: true } }, 'guest');
    vi.advanceTimersByTime(2500);
    expect(JSON.stringify(heard)).not.toContain('seat-secret');
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
    vi.advanceTimersByTime(DEAD_AFTER_MS + HEARTBEAT_MS * 2);
    expect(host.lobby.seats[1]).toMatchObject({ id: 'g', connected: false });
    void guest;
  });
});
