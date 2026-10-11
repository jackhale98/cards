import { describe, expect, it } from 'vitest';
import { GAME_LIST } from '../src/games';
import type { GameModule, GameState } from '../src/engine/types';

/**
 * A bot that proposes a move the rules don't offer would freeze a real table (the host can only
 * fall back to a passive move), so every bot move in every game must be one that's on offer and
 * that the rules accept. Bots use randomness, so play plenty of deals.
 */
function playDeal(g: GameModule, seed: number, n: number): string | null {
  const s: GameState = g.setup(
    Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })),
    seed,
    { ...Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])), botLevel: 0 },
  );
  const start = s.phase;
  for (let i = 0; i < 2000; i++) {
    if (i > 0 && s.phase === 'handOver') return null; // an all-bot poker table deals on by itself
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
    if (seat < 0) return null; // the deal is over (or waits on a person)
    const a = g.bot!(s, seat)!;
    const offered = g.actions(s, seat);
    if (!offered.some((o) => o.type === a.type))
      return `seed ${seed}: ${JSON.stringify(a)} not offered in ${s.phase} (offered ${offered.map((o) => o.type).join(', ')})`;
    try {
      g.apply(s, seat, a);
    } catch (e) {
      return `seed ${seed}: ${JSON.stringify(a)} rejected in ${s.phase}: ${(e as Error).message}`;
    }
  }
  return `seed ${seed}: still in ${s.phase} after 2000 moves (started in ${start})`;
}

describe('bots only make moves the rules allow', () => {
  for (const g of GAME_LIST.filter((g) => g.bot)) {
    it(g.config.id, () => {
      const n = Math.max(g.config.players.min, Math.min(g.config.players.max, g.config.id === 'holdem' || g.config.id === 'omaha' ? 3 : 4));
      const problems: string[] = [];
      for (let seed = 1; seed <= 400 && problems.length < 3; seed++) {
        const p = playDeal(g, seed, n);
        if (p) problems.push(p);
      }
      expect(problems).toEqual([]);
    }, 60000); // (400 deals of the slower games take a few seconds)
  }
});
