import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHidden } from '../src/engine/redact';
import { Client } from '../src/net/client';
import { Host, REPLAY_HANDS } from '../src/net/host';
import type { Frame, HostMsg } from '../src/net/protocol';
import { GAMES } from './games';
import { Bus, MemTransport } from './netHarness';

/** A host (Hana, seat 0) with three bots; Hana's moves are made by a bot too. */
function hearts(transport: MemTransport | null = null) {
  const host = new Host(transport, 'REPLAY', { cid: 'h', name: 'Hana', key: 'hk' });
  host.setGame('hearts');
  for (let i = 0; i < 3; i++) host.addBot();
  return host;
}

/** Play on (Hana's moves by a bot) until another hand is finished and kept for replay. */
function finishHand(host: Host) {
  // (a new latest hand: its first moment changes; the count stops at the limit)
  const latest = () => `${host.viewFor('h').replays ?? 0}:${host.frame('h', 0, 0)?.state.v}`;
  const before = latest();
  for (let i = 0; i < 5000 && latest() === before; i++) {
    const s = host.state!;
    const v = host.viewFor('h');
    if (v.actions.some((a) => a.type === 'next')) host.act('h', { type: 'next' });
    else if (s.turn === 0 || v.actions.length) {
      const a = GAMES.hearts.bot!(s, 0);
      if (a) host.act('h', a);
    }
    vi.advanceTimersByTime(1500);
  }
  expect(latest()).not.toBe(before);
}

describe('replaying a finished hand', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('steps from the deal to the result', () => {
    const host = hearts();
    host.start();
    expect(host.viewFor('h').replays).toBeUndefined();
    finishHand(host);
    const deal = host.frame('h', 0, 0)!;
    expect(deal.hands).toBe(1);
    expect(deal.steps).toBeGreaterThan(52); // (13 tricks of 4 cards, and the passing)
    expect(deal.state.zones['hand:0'].cards).toHaveLength(13);
    expect(deal.status.banner).toBeUndefined();
    const end = host.frame('h', 0, deal.steps - 1)!;
    expect(end.status.banner).toBeTruthy();
    // (out of range: the nearest moment there is)
    expect(host.frame('h', 9, 9999)!.step).toBe(deal.steps - 1);
    host.close();
  });

  it("shows each player only what they saw: never another hand's cards", () => {
    const host = hearts();
    host.start();
    finishHand(host);
    const steps = host.frame('h', 0, 0)!.steps;
    for (let step = 0; step < steps; step++) {
      const f = host.frame('h', 0, step)!;
      for (const seat of [1, 2, 3]) expect(f.state.zones[`hand:${seat}`].cards.every((c) => isHidden(c.id))).toBe(true);
      expect(f.state.zones['hand:0'].cards.every((c) => !isHidden(c.id))).toBe(true);
      expect(f.state.rng).toEqual([]);
    }
    // someone watching sees no hand at all
    const watching = host.frame(null, 0, 0)!;
    for (const seat of [0, 1, 2, 3]) expect(watching.state.zones[`hand:${seat}`].cards.every((c) => isHidden(c.id))).toBe(true);
    host.close();
  });

  it('keeps the last few hands, and forgets them with the game', () => {
    const host = hearts();
    host.start();
    for (let i = 0; i <= REPLAY_HANDS; i++) finishHand(host);
    expect(host.frame('h', 0, 0)!.hands).toBe(REPLAY_HANDS);
    host.endGame();
    expect(host.frame('h', 0, 0)).toBeNull();
    host.close();
  }, 60_000); // (six whole hands)

  it('reaches players over the network, as they saw it', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host-peer');
    const host = new Host(ht, 'REPLAY', { cid: 'h', name: 'Hana', key: 'hk' });
    bus.join(ht);
    const t = new MemTransport(bus, 'ann-peer');
    const ann = new Client(t, 'ann', 'Ann', undefined, false, 'ak');
    bus.join(t);
    host.setGame('hearts');
    for (let i = 0; i < 2; i++) host.addBot();
    host.start();
    // Ann (seat 1) plays by bot too
    for (let i = 0; i < 5000 && !host.viewFor('h').replays; i++) {
      const s = host.state!;
      for (const [cid, seat] of [
        ['h', 0],
        ['ann', 1],
      ] as const) {
        const v = host.viewFor(cid);
        if (v.actions.some((a) => a.type === 'next')) host.act(cid, { type: 'next' });
        else if (v.actions.length) {
          const a = GAMES.hearts.bot!(s, seat);
          if (a) host.act(cid, a);
        }
      }
      vi.advanceTimersByTime(1500);
    }
    let got: Frame | null = null;
    ann.onFrame = (f) => (got = f);
    ann.replay(0, 0);
    expect(got).not.toBeNull();
    const f = got! as Frame;
    expect(f.state.zones['hand:1'].cards.every((c) => !isHidden(c.id))).toBe(true);
    expect(f.state.zones['hand:0'].cards.every((c) => isHidden(c.id))).toBe(true);
    // and asking very fast is cut off after a few a second
    const frames: HostMsg[] = [];
    const rogue = new MemTransport(bus, 'rogue-peer');
    rogue.onMessage = (m) => (m as HostMsg).t === 'frame' && frames.push(m as HostMsg);
    bus.join(rogue);
    for (let i = 0; i < 100; i++) rogue.send({ t: 'replay', hand: 0, step: i }, 'host-peer');
    expect(frames.length).toBeLessThanOrEqual(20);
    host.close();
  });

  it("isn't kept for real-time games", () => {
    const host = new Host(null, 'REPLAY', { cid: 'h', name: 'Hana' });
    host.setGame('slapjack');
    host.addBot();
    host.start();
    vi.advanceTimersByTime(60_000);
    expect(host.viewFor('h').replays).toBeUndefined();
    host.close();
  });
});
