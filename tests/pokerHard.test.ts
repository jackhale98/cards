import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/engine/cards';
import { holdemShare, rangeEquity, type HardGame, type Move } from '../src/engine/families/pokerHard';
import type { PokerData } from '../src/engine/families/poker';
import { bestHand, bestWithHole, eval5 } from '../src/engine/lib/pokerEval';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES.holdem as GameModule<PokerData>;
const table = (n: number, options: Record<string, number> = {}) =>
  g.setup(
    Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })),
    3,
    { botLevel: 2, ...options },
  ) as GameState<PokerData>;
const give = (s: GameState<PokerData>, seat: number, cards: string) => (s.zones[`hand:${seat}`].cards = cards.split(' ').map((id) => ({ id })));

describe('Hard poker bots', () => {
  it('rank the starting hands: aces first, seven-deuce last, suited above offsuit', () => {
    expect(holdemShare(['AS', 'AH'])).toBeLessThan(0.01);
    expect(holdemShare(['7C', '2D'])).toBeGreaterThan(0.97);
    expect(holdemShare(['AS', 'KS'])).toBeLessThan(holdemShare(['AS', 'KD']));
    expect(holdemShare(['JS', 'TS'])).toBeLessThan(holdemShare(['JD', 'TC']));
  });

  it('open by the charts before the flop: aces raise, seven-deuce folds, from the first seat to act', () => {
    const s = table(4);
    const first = s.turn!;
    give(s, first, 'AS AH');
    expect(g.bot!(s, first)!.type).toBe('raise');
    give(s, first, '7C 2D');
    expect(g.bot!(s, first)).toEqual({ type: 'fold' });
  });

  it('with ten big blinds go all in or fold, where with a hundred they raise', () => {
    const deep = table(4);
    give(deep, deep.turn!, 'AS JD');
    expect(g.bot!(deep, deep.turn!)!.type).toBe('raise');
    const short = table(4, { stack: 100 });
    give(short, short.turn!, 'AS JD');
    expect(g.bot!(short, short.turn!)).toEqual({ type: 'allin' });
    give(short, short.turn!, '7C 2D');
    expect(g.bot!(short, short.turn!)).toEqual({ type: 'fold' });
  });

  it('read a big river raise as a stronger hand than checks all the way', () => {
    const hard: HardGame = {
      kind: 'holdem',
      holeCards: 2,
      boardAt: [0, 3, 4, 5],
      lastStreet: 3,
      evaluate: (h, b) => bestWithHole(h, b, 0),
      best: (c) => (c.length === 5 ? eval5(c) : bestHand(c)),
      deck: () => buildDeck({}),
      discards: () => [],
    };
    const s = table(2);
    s.zones.board.cards = 'KD 8C 5H 3S 2D'.split(' ').map((id) => ({ id, up: true }));
    give(s, 0, 'QS QH');
    s.data.street = 3;
    const eq = (moves: Move[]) => {
      s.data.history = moves;
      return rangeEquity(hard, s, 0, { samples: 60, ms: Infinity }).eq;
    };
    const check = (street: number): Move => ({ seat: 1, street, act: 'check', toCall: 0, bet: 0, pot: 40, to: 0 });
    const checks = eq([check(1), check(2), check(3)]);
    const raised = eq([check(1), check(2), { seat: 1, street: 3, act: 'raise', toCall: 0, bet: 0, pot: 40, to: 40 }]);
    expect(raised).toBeLessThan(checks - 0.1);
  });

  it('keep each player’s habits from the betting everyone saw', () => {
    const s = table(4);
    s.options.botLevel = 1;
    for (let i = 0; i < 200 && s.phase === 'betting'; i++) g.apply(s, s.turn!, g.bot!(s, s.turn!)!);
    const habits = s.data.habits!;
    expect(habits.map((h) => h.hands)).toEqual([1, 1, 1, 1]);
    const moves = s.data.history!;
    for (let seat = 0; seat < 4; seat++) {
      const own = moves.filter((m) => m.seat === seat);
      expect(habits[seat].raises).toBe(own.filter((m) => m.act === 'raise').length);
      expect(habits[seat].calls).toBe(own.filter((m) => m.act === 'call').length);
    }
  });
});
