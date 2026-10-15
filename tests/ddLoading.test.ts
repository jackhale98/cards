import { describe, expect, it, vi } from 'vitest';

// (the solver itself isn't needed here: only whether, and when, it's asked for)
const loadDds = vi.hoisted(() => vi.fn(() => Promise.resolve(false)));
vi.mock('../src/engine/bots/dds', () => ({ loadDds, solveCards: () => null, ddsReady: () => false }));

// (tests/setup.ts has loaded every game already, with the real solver: load them again)
vi.resetModules();
const { GAMES } = await import('./games');
// (counted now: each test starts with the count cleared)
const atLoad = loadDds.mock.calls.length;

describe('the Hard bots’ solver is fetched only when a Hard bot plays a partnership trick game', () => {
  const g = GAMES.bridge;
  const table = (botLevel: number) =>
    g.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
      1,
      { botLevel },
    );

  it('not for picking bridge, or for Easy and Normal bots', () => {
    expect(atLoad).toBe(0);
    for (const level of [0, 1]) {
      const s = table(level);
      g.bot!(s, s.turn!);
    }
    expect(loadDds).not.toHaveBeenCalled();
  });

  it('nor for Hard bots at games it can’t solve (Hearts: points, not tricks)', () => {
    const s = GAMES.hearts.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
      1,
      { botLevel: 2 },
    );
    GAMES.hearts.bot!(s, s.turn ?? 0);
    expect(loadDds).not.toHaveBeenCalled();
  });

  it('but for Hard bots at Spades, which plays like bridge', () => {
    const s = GAMES.spades.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
      1,
      { botLevel: 2 },
    );
    GAMES.spades.bot!(s, s.turn!);
    expect(loadDds).toHaveBeenCalled();
  });

  it('as soon as a Hard bot is asked to bid', () => {
    const s = table(2);
    expect(s.phase).toBe('call');
    g.bot!(s, s.turn!);
    expect(loadDds).toHaveBeenCalled();
  });
});
