import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/engine/cards';
import { canSee, redact } from '../src/engine/redact';
import type { GameModule, GameState } from '../src/engine/types';
import { GAME_LIST } from '../src/games';

/**
 * `redact` hides cards in zones, but a game's `data` goes out as it is unless the family redacts
 * it. Play every game with bots and check that the data each player receives never names a card
 * that player hasn't been able to see at some point (in their hand, or face up on the table).
 */
function leaks(g: GameModule, seed: number, n: number, steps: number): string[] {
  const s: GameState = g.setup(
    Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })),
    seed,
    { ...Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])), botLevel: 0 },
  );
  const deck = [...new Set(buildDeck(g.config.deck))];
  const seen = s.players.map(() => new Set<string>());
  const found: string[] = [];
  for (let i = 0; i < steps && found.length < 3; i++) {
    for (const p of s.players) {
      for (const z of Object.values(s.zones)) for (const c of z.cards) if (canSee(z, c, p.seat)) seen[p.seat].add(c.id);
      const data = JSON.stringify(redact(g, s, p.seat).data ?? null);
      for (const c of deck)
        if (!seen[p.seat].has(c) && data.includes(`"${c}"`)) found.push(`step ${i} (${s.phase}): seat ${p.seat} is sent ${c} in data`);
    }
    if (s.phase === 'gameOver') break;
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
    if (seat < 0) break;
    g.apply(s, seat, g.bot!(s, seat)!);
  }
  return found;
}

describe('game data sent to a player never names cards hidden from them', () => {
  for (const g of GAME_LIST.filter((g) => g.bot)) {
    it(g.config.id, () => {
      const n = Math.max(g.config.players.min, Math.min(g.config.players.max, 4));
      const found: string[] = [];
      for (let seed = 1; seed <= 3 && !found.length; seed++) found.push(...leaks(g, seed, n, 300));
      expect(found).toEqual([]);
    }, 30000);
  }
});
