import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Host } from '../src/net/host';
import type { Transport } from '../src/net/transport';
import type { SlapData } from '../src/engine/families/slap';
import type { GameState } from '../src/engine/types';

const quiet: Transport = { kind: 'memory', selfId: 'host-peer', onMessage: () => {}, onPeerJoin: () => {}, onPeerLeave: () => {}, send: () => {}, leave: () => {} };

/** A host (seat 0, a person) and bots, playing a real-time game with the clock under our control. */
function game(id: string, bots: number) {
  const host = new Host(quiet, 'MAIN', { cid: 'h', name: 'Hana' });
  host.setGame(id);
  for (let i = 0; i < bots; i++) host.addBot();
  host.start();
  return host;
}
const state = (host: Host) => host.state as GameState<SlapData>;

describe('real-time host', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('bots act on their own timers, without waiting for each other', () => {
    // (a fixed deal: with some deals a jack is slapped early and the person is up again sooner)
    vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce((a) => (((a as Uint32Array)[0] = 7), a));
    const host = game('slapjack', 3);
    expect(state(host).turn).toBe(0);
    expect(host.act('h', { type: 'flip' })).toBeNull();
    const v = state(host).v;
    // the three bots turn over (and slap) on their own, until it's the person's turn again
    vi.advanceTimersByTime(20_000);
    expect(state(host).v).toBeGreaterThanOrEqual(v + 3);
    expect(state(host).log.filter((l) => /turns up/.test(l.text)).length).toBeGreaterThanOrEqual(4);
    host.close();
  });

  it('the quicker reaction wins even when it arrives later', () => {
    vi.setSystemTime(100_000);
    const host = game('slapjack', 1);
    const s = state(host);
    // stack a jack for the person to turn up
    const hand0 = s.zones['hand:0'].cards;
    const all = [...hand0, ...s.zones['hand:1'].cards];
    const jack = all.find((c) => c.id.startsWith('J'))!;
    const owner = hand0.includes(jack) ? hand0 : s.zones['hand:1'].cards;
    owner.splice(owner.indexOf(jack), 1);
    hand0.push(jack);
    s.turn = 0;
    expect(host.act('h', { type: 'flip' })).toBeNull();
    const race = state(host).data.race;
    const before = state(host).zones['hand:0'].cards.length;
    // the bot plans its slap now; the person's slap reaches the host 200 ms later but was quicker on their screen
    vi.advanceTimersByTime(200);
    expect(host.act('h', { type: 'slap', race, rt: 150 })).toBeNull();
    const slaps = state(host).data.slaps;
    expect(slaps.find((x) => x.seat === 0)?.rt).toBe(150);
    // the window runs from the first good slap's arrival on the host's clock
    expect(state(host).data.judgeAt).toBe(100_200 + 350);
    vi.advanceTimersByTime(2_000);
    // the bot's quickest slap (Normal) takes over 500 ms: the person wins
    expect(state(host).zones['hand:0'].cards.length).toBeGreaterThan(before);
    host.close();
  });

  it('clears every timer when the game ends', () => {
    const host = game('egyptian-rat-screw', 3);
    vi.advanceTimersByTime(3_000);
    host.endGame();
    expect((host as unknown as { botPlans: Map<number, unknown> }).botPlans.size).toBe(0);
    expect((host as unknown as { timer: unknown }).timer).toBeNull();
  });
});
