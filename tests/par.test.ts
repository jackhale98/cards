import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boardDealer, vulSides } from '../src/engine/lib/duplicate';
import { par } from '../src/engine/lib/par';

/**
 * Par: a deal's score with perfect bidding, every card known. Checked against endplay's (Bo
 * Haglund's DDS) on random deals (tests/fixtures/par-endplay.jsonl, from tools/par_deals.py).
 */

/** A table (strains ♠ ♥ ♦ ♣ NT, seats N E S W) where North–South take `ns[strain]` tricks with either hand. */
const tableOf = (ns: number[]) => ns.map((t) => [t, 13 - t, t, 13 - t]);

describe('par', () => {
  it('agrees with endplay’s par on 96 random deals, each dealer and vulnerability', () => {
    const rows = readFileSync('tests/fixtures/par-endplay.jsonl', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { deal: string; board: number; t: Record<string, Record<string, number>>; par: number });
    for (const r of rows) {
      const table = ['S', 'H', 'D', 'C', 'NT'].map((x) => [0, 1, 2, 3].map((h) => r.t['NESW'[h]][x]));
      expect(par(table, boardDealer(r.board), vulSides(r.board)).ns, `${r.deal} board ${r.board}`).toBe(r.par);
    }
  });

  it('is the game a side makes, at its lowest (overtricks count)', () => {
    // North–South take eleven tricks in spades, seven or fewer elsewhere
    const p = par(tableOf([11, 7, 6, 6, 7]), 0, [false, false]);
    expect(p).toEqual({ n: 0, contract: '4S', declarer: 0, tricks: 11, ns: 450 });
  });

  it('is a sacrifice when going down doubled costs less than the other side’s game', () => {
    // North–South make 4♥ (420); East–West take eight tricks in spades: 4♠ doubled, two down, 300
    const sac = par(tableOf([5, 10, 6, 6, 6]), 0, [false, false]);
    expect(sac).toMatchObject({ contract: '4SX', tricks: 8, ns: 300 });
    expect([1, 3]).toContain(sac.declarer);
    // vulnerable, two down doubled is 500: more than the game, so no sacrifice
    expect(par(tableOf([5, 10, 6, 6, 6]), 0, [false, true])).toMatchObject({ contract: '4H', ns: 420 });
  });
});
