import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Host } from '../src/net/host';

/** A table dealt and left as it is: the Host's development options (`?seed=…&still`). */
function table(opts: { seed?: number; still?: boolean }) {
  const host = new Host(null, 'SEED', { cid: 'h', name: 'Hana' }, undefined, opts);
  host.setGame('hearts');
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
});
