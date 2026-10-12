import { describe, expect, it } from 'vitest';
import type { RummyData } from '../src/engine/families/rummy';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const gin = GAMES['gin-rummy'] as GameModule<RummyData>;
const h = (s: string) => s.split(' ').map((id) => ({ id }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const bots = [{ name: 'A', bot: true }, { name: 'B', bot: true }];

/** Put the game in seat 0's discard step with the given hands. */
function rig(seed: number, hand0: string, hand1: string) {
  const s = gin.setup(bots, seed, {});
  s.zones['hand:0'].cards = h(hand0);
  s.zones['hand:1'].cards = h(hand1);
  s.phase = 'discard';
  s.turn = 0;
  s.data.justTook = null;
  return s;
}

describe('gin rummy', () => {
  it('deals 10 each with an upcard and offers it to the non-dealer first', () => {
    const s = gin.setup(bots, 1, {});
    expect(ids(s, 'hand:0')).toHaveLength(10);
    expect(ids(s, 'hand:1')).toHaveLength(10);
    expect(ids(s, 'discard')).toHaveLength(1);
    expect(s.phase).toBe('firstPick');
    expect(s.turn).not.toBe(s.dealer);
    const first = s.turn!;
    gin.apply(s, first, { type: 'pass' });
    expect(s.turn).toBe(s.dealer);
    gin.apply(s, s.dealer, { type: 'pass' });
    // both passed: the non-dealer must draw from the stock
    expect(s.turn).toBe(first);
    expect(gin.actions(s, first).map((a) => a.type)).toEqual(['draw']);
    expect(() => gin.apply(s, first, { type: 'take' })).toThrow();
  });

  it('will not let you throw back the card you just took', () => {
    const s = gin.setup(bots, 2, {});
    const seat = s.turn!;
    const up = ids(s, 'discard')[0];
    gin.apply(s, seat, { type: 'take' });
    expect(() => gin.apply(s, seat, { type: 'discard', cards: [up] })).toThrow(/just took/);
  });

  it('scores a knock after the defender lays off', () => {
    // A: 2♥3♥4♥ 7♣7♦7♠ 9♠10♠J♠ + 5♦ deadwood (discards K♣) → knocks with 5
    // B: deadwood 5♥ (lays off on 2-3-4♥) and K♦ Q♦ 8♦ … : 30 left
    const s = rig(3, '2H 3H 4H 7C 7D 7S 9S TS JS 5D KC', 'QC QD QH 5H KD 8D 2C 3C 6S 6D');
    gin.apply(s, 0, { type: 'knock', cards: ['KC'] });
    expect(s.phase).toBe('handOver');
    // B: QC QD QH meld; 5H laid off; deadwood KD 8D 2C 3C 6S 6D = 10+8+2+3+6+6 = 35
    expect(s.data.scores).toEqual([30, 0]);
    expect(ids(s, 'show:1')).toContain('5H');
  });

  it('awards an undercut to the defender', () => {
    const s = rig(4, '2H 3H 4H 7C 7D 7S 9S TS JS 9D KC', 'QC QD QH AS AC AD 2S 3S 4S 5C');
    gin.apply(s, 0, { type: 'knock', cards: ['KC'] });
    // knocker 9, defender 5 → defender gets 4 + 10 (pagat)
    expect(s.data.scores).toEqual([0, 14]);
  });

  it('scores gin with the bonus and no layoffs', () => {
    const s = rig(5, '2H 3H 4H 7C 7D 7S 9S TS JS QS KC', 'QC QD QH 5H KD 8D 2C 3C 6S 6D');
    gin.apply(s, 0, { type: 'gin', cards: ['KC'] });
    // defender: QC QD QH meld, deadwood 5H KD 8D 2C 3C 6S 6D = 40 (no layoff onto gin)
    expect(s.data.scores).toEqual([60, 0]); // 40 + the gin bonus of 20
  });

  it('plays complete games between bots with consistent cards and scores', () => {
    for (const seed of [6, 7, 8]) {
      const s = gin.setup(bots, seed, { target: 100 });
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          const total = Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);
          expect(total).toBe(52);
          gin.apply(s, 0, { type: 'next' });
          continue;
        }
        const a = gin.bot!(s, s.turn!)!;
        gin.apply(s, s.turn!, a);
      }
      expect(s.phase).toBe('gameOver');
      expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(100);
    }
  });
});
