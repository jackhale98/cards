import { describe, expect, it } from 'vitest';
import { bestMelds, fitsMeld, layOff } from '../src/engine/lib/melds';

const h = (s: string) => s.split(' ');

describe('melds', () => {
  it('finds sets and runs with the least deadwood', () => {
    const r = bestMelds(h('7H 8H 9H QC QD QS 4S 5S 6S 2D'));
    expect(r.points).toBe(2);
    expect(r.deadwood).toEqual(['2D']);
    expect(r.melds).toHaveLength(3);
  });

  it('chooses between a set and a run sharing a card', () => {
    // 5H can go in the 5s set or the 3-4-5 hearts run; the best total wins
    // run 3-4-5♥ leaves 5♣ 5♦ K♠ Q♠ (30); set of 5s leaves 3♥ 4♥ K♠ Q♠ (27)
    const r = bestMelds(h('3H 4H 5H 5C 5D KS QS'));
    expect(r.points).toBe(27);
    // with a third 5 both the run and a set of three 5s fit
    const r2 = bestMelds(h('3H 4H 5H 5C 5D 5S KS'));
    expect(r2.deadwood).toEqual(['KS']);
  });

  it('treats aces as low only', () => {
    expect(bestMelds(h('AS 2S 3S')).points).toBe(0);
    expect(bestMelds(h('QS KS AS')).points).toBe(21);
  });

  it('lays off onto runs and sets, including chains', () => {
    expect(fitsMeld('6H', h('3H 4H 5H'))).toBe(true);
    expect(fitsMeld('7H', h('3H 4H 5H'))).toBe(false);
    expect(fitsMeld('QH', h('QC QD QS'))).toBe(true);
    const melds = [h('3H 4H 5H')];
    expect(layOff(h('7H 6H 9C'), melds).sort()).toEqual(['6H', '7H']);
  });
});
