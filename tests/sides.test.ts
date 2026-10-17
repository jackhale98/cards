import { describe, expect, it } from 'vitest';
import { GAME_LIST } from './games';
import { standingsOf } from '../src/engine/state';
import type { GameModule, GameState } from '../src/engine/types';
import { formatsFor } from '../src/engine/events';

/** Every table size a game allows. */
const sizes = (m: GameModule) =>
  m.config.players.counts ?? Array.from({ length: m.config.players.max - m.config.players.min + 1 }, (_, i) => m.config.players.min + i);

describe('sides: who partners whom (a tournament pairs sides)', () => {
  for (const m of GAME_LIST) {
    it(`${m.config.id}: every seat on exactly one side, partners sharing a place at the end`, () => {
      for (const n of sizes(m)) {
        const sides = m.sides?.(n) ?? Array.from({ length: n }, (_, i) => [i]);
        expect(sides.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
        expect(new Set(sides.map((s) => s.length)).size).toBe(1);
        if (sides[0].length === 1) continue;
        // a finished game ranks partners together (a few random endings)
        const s = m.setup(
          Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true })),
          n,
          {},
        ) as GameState;
        s.winner = sides[0];
        const places = standingsOf(m, s);
        for (const side of sides) expect(new Set(side.map((i) => places[i])).size).toBe(1);
      }
    });
  }
});

describe('the tournaments a game can be played in', () => {
  it('Swiss and knockout for any game with a result; round robin only two sides a table; not the free table', () => {
    for (const m of GAME_LIST) {
      const n = m.config.players.recommended ?? m.config.players.min;
      const sides = m.sides?.(n) ?? Array.from({ length: n }, (_, i) => [i]);
      const f = formatsFor(m.config, sides);
      if (m.config.id === 'freetable') expect(f).toEqual([]);
      else {
        expect(f).toEqual(expect.arrayContaining(['swiss', 'knockout']));
        expect(f.includes('roundRobin')).toBe(sides.length === 2);
      }
    }
  });
});
