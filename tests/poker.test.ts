import { describe, expect, it } from 'vitest';
import * as bet from '../src/engine/lib/betting';
import { bestHand, eval5 } from '../src/engine/lib/pokerEval';

const h = (s: string) => s.split(' ');

describe('poker evaluator', () => {
  it.each([
    ['AS KS QS JS TS', 'Straight flush'],
    ['9C 9D 9H 9S 2C', 'Four of a kind'],
    ['3C 3D 3H 7S 7C', 'Full house'],
    ['2H 8H JH KH 4H', 'Flush'],
    ['AS 2D 3H 4S 5C', 'Straight'],
    ['QC QD QH 7S 2C', 'Three of a kind'],
    ['QC QD 7H 7S 2C', 'Two pair'],
    ['QC QD 8H 7S 2C', 'Pair'],
    ['AC QD 8H 7S 2C', 'High card'],
  ])('%s is %s', (cards, name) => {
    expect(eval5(h(cards)).name).toBe(name);
  });

  it('ranks hands correctly', () => {
    const cmp = (a: string, b: string) => Math.sign(eval5(h(a)).score - eval5(h(b)).score);
    expect(cmp('AS 2D 3H 4S 5C', '2S 3D 4H 5S 6C')).toBe(-1); // wheel is lowest straight
    expect(cmp('KC KD 4H 4S 2C', 'KH KS 4C 4D AC')).toBe(-1); // kicker
    expect(cmp('AC AD 2H 2S 3C', 'KC KD QH QS JC')).toBe(1);
    expect(cmp('2H 3H 4H 5H 7H', 'AS KD QC JH TS')).toBe(1);
    expect(cmp('TC TD TH 2S 2C', 'TS TC TH 2D 2H')).toBe(0);
  });

  it('finds the best 5 of 7', () => {
    expect(bestHand(h('AS KS 2D 3C QS JS TS')).name).toBe('Straight flush');
    expect(bestHand(h('2C 2D 2H 5S 5C 5D AH')).name).toBe('Full house');
  });
});

describe('betting', () => {
  it('builds side pots from all-ins', () => {
    const b = bet.newBetting(3, [false, false, false]);
    b.committed = [50, 200, 200];
    expect(bet.pots(b)).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ]);
  });

  it('includes folded chips but not folded eligibility', () => {
    const b = bet.newBetting(3, [false, false, false]);
    b.committed = [30, 100, 100];
    b.folded[0] = true;
    expect(bet.pots(b)).toEqual([{ amount: 230, eligible: [1, 2] }]);
  });

  it('completes a street when everyone has matched', () => {
    const chips = [100, 100, 100];
    const b = bet.newBetting(3, [false, false, false]);
    bet.post(b, chips, 1, 5);
    bet.post(b, chips, 2, 10);
    b.minRaise = 10;
    bet.act(b, chips, 0, { type: 'call' });
    bet.act(b, chips, 1, { type: 'call' });
    expect(bet.streetComplete(b)).toBe(false); // big blind has the option
    bet.act(b, chips, 2, { type: 'check' });
    expect(bet.streetComplete(b)).toBe(true);
    expect(chips).toEqual([90, 90, 90]);
  });

  it('lets nobody raise once everyone else is all in: call or fold (as PokerKit agrees)', () => {
    const c = bet.newBetting(3, [false, false, false]);
    const stacks = [500, 60, 40];
    c.minRaise = 10;
    bet.act(c, stacks, 1, { type: 'allin' });
    bet.act(c, stacks, 2, { type: 'allin' });
    const o = bet.options(c, stacks, 0);
    expect(o.canRaise).toBe(false);
    expect(o.toCall).toBe(60);
    expect(() => bet.act(c, stacks, 0, { type: 'raise', to: 150 })).toThrow();
  });

  it('reopens action after a raise and enforces the minimum raise', () => {
    const chips = [100, 100];
    const b = bet.newBetting(2, [false, false]);
    b.minRaise = 10;
    bet.act(b, chips, 0, { type: 'raise', to: 20 });
    expect(() => bet.act(b, chips, 1, { type: 'raise', to: 25 })).toThrow();
    bet.act(b, chips, 1, { type: 'raise', to: 40 });
    expect(bet.streetComplete(b)).toBe(false);
    bet.act(b, chips, 0, { type: 'call' });
    expect(bet.streetComplete(b)).toBe(true);
  });
});
