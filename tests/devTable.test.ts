import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Host } from '../src/net/host';

/** A table dealt and left as it is: the Host's development options (`?seed=…&still`). */
function table(opts: { seed?: number; still?: boolean }, game = 'hearts') {
  const host = new Host(null, 'SEED', { cid: 'h', name: 'Hana' }, undefined, opts);
  host.setGame(game);
  for (let i = 0; i < 3; i++) host.addBot();
  host.start();
  return host;
}
const hands = (h: Host) => [0, 1, 2, 3].map((p) => h.state!.zones[`hand:${p}`].cards.map((c) => c.id).join(' '));

describe('a table for looking at (development builds)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dealt from a seed, gets the same cards every time; without one, different cards', () => {
    const [a, b, c] = [table({ seed: 7 }), table({ seed: 7 }), table({})];
    expect(hands(a)).toEqual(hands(b));
    expect(hands(c)).not.toEqual(hands(a));
    for (const h of [a, b, c]) h.close();
  });

  it('held still, nothing moves by itself: the bots wait, however long', async () => {
    const still = table({ seed: 7, still: true });
    const moving = table({ seed: 7 });
    const v = still.state!.v;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(still.state!.v).toBe(v);
    expect(moving.state!.v).toBeGreaterThan(v);
    // (a person's move still counts)
    const mine = still.state!.zones['hand:0'].cards.slice(0, 3).map((c) => c.id);
    expect(still.act('h', { type: 'pass', cards: mine })).toBeNull();
    expect(still.state!.v).toBeGreaterThan(v);
    for (const h of [still, moving]) h.close();
  });

  it('stepped on from a seed, the same moves follow every time, to the hand’s end', () => {
    // (President's Easy bots look ahead a little: counted, not timed, while stepping)
    for (const game of ['hearts', 'president']) {
      const play = (busy: boolean) => {
        const h = table({ seed: 7, still: true }, game);
        for (let i = 0; i < 400 && !['handOver', 'roundOver'].includes(h.state!.phase); i++) {
          // (whatever else draws on Math.random between steps doesn't change them)
          if (busy) Math.random();
          if (!h.step()) break;
        }
        const end = { phase: h.state!.phase, zones: h.state!.zones, log: h.state!.log.map((l) => l.text) };
        h.close();
        return end;
      };
      const first = play(false);
      expect(first.phase, game).not.toBe('play');
      expect(play(true), game).toEqual(first);
    }
  });
});
