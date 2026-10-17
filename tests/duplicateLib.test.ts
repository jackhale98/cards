import { describe, expect, it } from 'vitest';
import { boardDealer, boardVul, imps, matchpointTop, matchpoints, vulSides } from '../src/engine/lib/duplicate';

describe('duplicate bridge arithmetic', () => {
  it('the sixteen-board cycle: dealer and vulnerability', () => {
    expect(Array.from({ length: 16 }, (_, i) => boardVul(i + 1))).toEqual([
      'None',
      'NS',
      'EW',
      'All',
      'NS',
      'EW',
      'All',
      'None',
      'EW',
      'All',
      'None',
      'NS',
      'All',
      'None',
      'NS',
      'EW',
    ]);
    expect(Array.from({ length: 8 }, (_, i) => boardDealer(i + 1))).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    // (board 17 starts the cycle again)
    expect(boardVul(17)).toBe('None');
    expect(vulSides(4)).toEqual([true, true]);
    expect(vulSides(2)).toEqual([true, false]);
  });

  it('IMPs: the WBF scale, either way', () => {
    expect(imps(0)).toBe(0);
    expect(imps(10)).toBe(0);
    expect(imps(20)).toBe(1);
    expect(imps(420 - 170)).toBe(6);
    expect(imps(-620 - 100)).toBe(-12);
    expect(imps(5000)).toBe(24);
  });

  it('matchpoints: two for each score beaten, one for each tied', () => {
    expect(matchpoints([100, 100, 50, -50])).toEqual([5, 5, 2, 0]);
    expect(matchpointTop(4)).toBe(6);
  });
});
