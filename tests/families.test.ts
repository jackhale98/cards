import { describe, expect, it } from 'vitest';
import type { PokerData } from '../src/engine/families/poker';
import type { TrickData } from '../src/engine/families/trick';
import { bestWithHole } from '../src/engine/lib/pokerEval';
import { seatRelation } from '../src/engine/state';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

/** Bots play every seat; "next hand" is pressed whenever a round ends. */
function playOut<D>(g: GameModule<D>, s: GameState<D>, onRound?: (s: GameState<D>) => void) {
  for (let i = 0; i < 100000 && s.phase !== 'gameOver'; i++) {
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    if (s.phase === 'roundOver' || s.phase === 'handOver') {
      onRound?.(s);
      g.apply(
        s,
        s.players.findIndex((p) => p.chips > 0 || !g.config.chips),
        { type: 'next' },
      );
      continue;
    }
    const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
    if (seat < 0) throw new Error(`stuck in ${s.phase}`);
    g.apply(s, seat, g.bot!(s, seat)!);
  }
  expect(s.phase).toBe('gameOver');
}
const totalCards = (s: GameState<any>) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));

describe('spades (config only)', () => {
  const g = GAMES.spades as GameModule<TrickData>;

  it('bids, plays as partnerships and reaches the target', () => {
    const s = g.setup(bots(4), 11, { target: 300 });
    expect(s.phase).toBe('bid');
    expect(s.data.trump).toBe('S');
    playOut(g, s, (r) => {
      expect(totalCards(r)).toBe(52);
      expect(r.data.tricks.reduce((a, b) => a + b, 0)).toBe(13);
    });
    expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(300);
    // winners are a partnership
    expect(s.winner!.length % 2).toBe(0);
    expect(
      [
        [0, 2],
        [1, 3],
      ].some((t) => t.every((i) => s.winner!.includes(i))),
    ).toBe(true);
  });

  it('cannot lead spades until broken', () => {
    const s = g.setup(bots(4), 3, {});
    while (s.phase === 'bid') g.apply(s, s.turn!, { type: 'bid', amount: 3 });
    const play = g.actions(s, s.turn!).find((a) => a.type === 'play')!;
    const hand = s.zones[`hand:${s.turn}`].cards.map((c) => c.id);
    if (hand.some((c) => !c.endsWith('S'))) expect(play.select!.cards.every((c) => !c.endsWith('S'))).toBe(true);
  });

  it('scores contracts, bags and nil', () => {
    const s = g.setup(bots(4), 5, {});
    Object.assign(s.data, { bids: [4, 3, 0, 2], tricks: [6, 3, 1, 3], scores: [0, 0], bags: [8, 0] });
    for (const z of Object.values(s.zones)) z.cards = [];
    ['AH', '2H', '3H', '4H'].forEach((id, i) => (s.zones[`hand:${i}`].cards = [{ id }]));
    Object.assign(s.data, { trickNo: 12, handSize: 13 });
    s.data.tricks[0] = 5; // seat 0 wins the last trick → 6
    s.phase = 'play';
    s.turn = 0;
    for (let i = 0; i < 4; i++) g.apply(s, i, { type: 'play', cards: [s.zones[`hand:${i}`].cards[0].id] });
    g.system!(s)!.run(s);
    // team 0: seat 0 bid 4 took 6 (2 bags), seat 2 nil failed (−100) and its trick is a bag too:
    // 8 + 3 = 11 bags → −100, 1 left over. 40 + 3 − 100 − 100
    // team 1: bid 5 took 6: 51
    expect(s.data.scores).toEqual([-157, 51]);
    expect(s.data.bags).toEqual([1, 1]);
  });
});

describe('oh hell (config only)', () => {
  const g = GAMES['oh-hell'] as GameModule<TrickData>;

  it('deals 10 down to 1 and back up by default (pagat)', () => {
    const s = g.setup(bots(4), 7, { ...Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])), botLevel: 0 });
    expect(s.data.handSize).toBe(10);
    const s6 = g.setup(bots(6), 7, { maxHand: 10 });
    expect(s6.data.handSize).toBe(8);
  });

  it('descends and climbs the ladder with a trump turn-up and the dealer hook', () => {
    const s = g.setup(bots(4), 7, { maxHand: 3 });
    const sizes: number[] = [];
    expect(s.zones.trump.cards).toHaveLength(1);
    expect(s.data.trump).not.toBeNull();
    // dealer may not make bids add up to the hand size
    while (s.turn !== s.dealer) g.apply(s, s.turn!, { type: 'bid', amount: 0 });
    expect(() => g.apply(s, s.dealer, { type: 'bid', amount: 3 })).toThrow(/dealer/i);
    g.apply(s, s.dealer, { type: 'bid', amount: 0 });
    playOut(g, s, (r) => sizes.push(r.data.handSize));
    sizes.push(s.data.handSize); // the final round ends the game
    expect(sizes).toEqual([3, 2, 1, 2, 3]);
  });

  it.each([
    [false, [2, 1, 10]],
    [true, [0, 0, 10]],
  ])('scores a point a trick plus 10 for an exact bid (exact bids only: %s)', (exactOnly, expected) => {
    const s = g.setup(bots(3), 1, { exactOnly });
    Object.assign(s.data, { bids: [1, 0, 0], tricks: [1, 1, 0] });
    for (const z of Object.values(s.zones)) if (z.id !== 'trump') z.cards = [];
    s.zones.trick.cards = [];
    s.data.trickNo = 1;
    s.data.handSize = 2;
    ['AS', '2D', '3D'].forEach((id, i) => (s.zones[`hand:${i}`].cards = [{ id }]));
    s.data.trump = 'S';
    s.phase = 'play';
    s.turn = 0;
    for (let i = 0; i < 3; i++) g.apply(s, i, { type: 'play', cards: [s.zones[`hand:${i}`].cards[0].id] });
    g.system!(s)!.run(s);
    // seat 0 took 2 (bid 1); seat 1 took 1 (bid 0); seat 2 took 0 (bid 0) → 10
    expect(s.data.scores).toEqual(expected);
  });
});

describe('oh hell: Hard bids by playing its bids out', () => {
  const g = GAMES['oh-hell'] as GameModule<TrickData>;

  it('bids the top trumps it holds, and never the dealer’s hooked bid', () => {
    const s = g.setup(bots(4), 3, { maxHand: 3, botLevel: 2 });
    const trump = s.data.trump!;
    const seat = s.turn!;
    const top = ['A', 'K', 'Q'].map((r) => `${r}${trump}`);
    // three top trumps: three sure tricks
    for (const z of Object.values(s.zones)) z.cards = z.cards.filter((c) => !top.includes(c.id));
    const spare = s.zones[`hand:${seat}`].cards.splice(0, 3);
    s.zones[`hand:${seat}`].cards.push(...top.map((id) => ({ id })));
    s.zones.deck.cards.push(...spare);
    expect(g.bot!(s, seat)).toEqual({ type: 'bid', amount: 3 });
    // the dealer, after bids of 0, 0 and 0, may not bid 3
    const d = g.setup(bots(4), 4, { maxHand: 3, botLevel: 2 });
    while (d.turn !== d.dealer) g.apply(d, d.turn!, { type: 'bid', amount: 0 });
    const last = g.bot!(d, d.dealer)!;
    expect(last.type).toBe('bid');
    expect(last.amount).not.toBe(3);
  });
});

describe('omaha (config only)', () => {
  it('must use exactly two hole cards', () => {
    // four spades in hand but only one on board: no flush in Omaha
    const hole = ['AS', 'KS', 'QS', 'JS'];
    const board = ['2S', '7D', '8C', '9H', '3D'];
    expect(bestWithHole(hole, board, 0).name).toBe('Flush');
    expect(bestWithHole(hole, board, 2).name).not.toBe('Flush');
  });

  it('deals four hole cards and conserves chips', () => {
    const g = GAMES.omaha as GameModule<PokerData>;
    const s = g.setup(bots(4), 4, { stack: 200, bigBlind: 20 });
    expect(s.zones['hand:1'].cards).toHaveLength(4);
    playOut(g, s, (r) => expect(r.players.reduce((n, p) => n + p.chips, 0)).toBe(800));
    expect(s.players[s.winner![0]].chips).toBe(800);
  });
});

describe('seat relations', () => {
  it('names neighbours from your point of view', () => {
    expect(seatRelation(0, 1, 4)).toBe('left');
    expect(seatRelation(0, 3, 4)).toBe('right');
    expect(seatRelation(0, 2, 4)).toBe('across');
    expect(seatRelation(2, 3, 5)).toBe('left');
    expect(seatRelation(2, 1, 5)).toBe('right');
    expect(seatRelation(2, 4, 5)).toBeNull();
    expect(seatRelation(0, 1, 2)).toBe('across');
  });
});
