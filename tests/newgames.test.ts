import { describe, expect, it } from 'vitest';
import { handTotal, type BlackjackData } from '../src/engine/families/blackjack';
import type { CheatData } from '../src/engine/families/cheat';
import type { GoFishData } from '../src/engine/families/gofish';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

function playOut<D>(g: GameModule<D>, s: GameState<D>, each?: (s: GameState<D>) => void, max = 100000) {
  for (let i = 0; i < max && s.phase !== 'gameOver'; i++) {
    each?.(s);
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    if (s.phase === 'roundOver') {
      g.apply(s, 0, { type: 'next' });
      continue;
    }
    const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
    expect(seat, `stuck in ${s.phase}`).toBeGreaterThanOrEqual(0);
    const a = g.bot!(s, seat)!;
    expect(g.actions(s, seat).map((o) => o.type)).toContain(a.type);
    g.apply(s, seat, a);
  }
  expect(s.phase).toBe('gameOver');
}

describe('blackjack (pagat)', () => {
  const g = GAMES.blackjack as GameModule<BlackjackData>;
  /** Stack the shoe so cards come off in this order. */
  const stack = (s: GameState<BlackjackData>, order: string[]) => {
    s.zones.deck.cards = s.zones.deck.cards.filter((c) => !order.includes(c.id));
    s.zones.deck.cards.push(...[...order].reverse().map((id) => ({ id })));
  };

  it('counts aces as 11 unless that busts', () => {
    expect(handTotal(['AS', 'KH'])).toEqual({ total: 21, soft: true });
    expect(handTotal(['AS', 'AH', '9C'])).toEqual({ total: 21, soft: true });
    expect(handTotal(['AS', '6H', 'TC'])).toEqual({ total: 17, soft: false });
  });

  it('a natural pays 3:2; the dealer draws to 17; wins pay even money', () => {
    const s = g.setup(people(2), 1, { stack: 1000, minBet: 10, rounds: 3, decks: 1 });
    // P0: A K (blackjack), P1: 9 7 then hits a 4; dealer: 6 up, T down, draws 5 → 21? no: give 2 → 18
    stack(s, ['AS', '9H', '6D', 'KH', '7C', 'TS', '4D', '2C']);
    g.apply(s, 0, { type: 'bet', amount: 100 });
    g.apply(s, 1, { type: 'bet', amount: 50 });
    expect(s.players[0].chips).toBe(1150); // paid at once
    expect(s.turn).toBe(1);
    g.apply(s, 1, { type: 'hit' }); // 20
    g.apply(s, 1, { type: 'stand' });
    expect(s.phase).toBe('dealer');
    while (g.system!(s)) g.system!(s)!.run(s);
    // dealer 6 + 10 = 16, draws 2 = 18: P1's 20 wins
    expect(s.players[1].chips).toBe(1050);
    expect(s.phase).toBe('roundOver');
    // the summary leads with what the dealer finished on (the banner hides the dealer's cards on a TV)
    expect(s.data.result!.lines[0]).toBe('The dealer has 18');
  });

  it('double down takes one card; split makes two hands', () => {
    const s = g.setup(people(1), 2, { stack: 1000, minBet: 10, rounds: 3, decks: 1 });
    stack(s, ['8S', '5D', '8H', 'TS', '3C', '2H', '9C', 'KD', '2S']); // the dealer's 15 draws the 2: 17
    g.apply(s, 0, { type: 'bet', amount: 20 });
    expect(g.actions(s, 0).map((a) => a.type)).toEqual(['hit', 'stand', 'double', 'split']);
    g.apply(s, 0, { type: 'split' });
    expect(s.data.hands[0].map((h) => h.cards)).toEqual([['8S', '3C'], ['8H', '2H']]);
    expect(s.players[0].chips).toBe(960);
    g.apply(s, 0, { type: 'double' }); // 11 + 9 = 20
    expect(s.data.hands[0][0]).toMatchObject({ bet: 40, done: true });
    expect(s.data.active).toBe(1);
    g.apply(s, 0, { type: 'hit' }); // 10 + K = 20
    g.apply(s, 0, { type: 'stand' });
    while (g.system!(s)) g.system!(s)!.run(s);
    expect(s.data.hands[0].map((h) => h.result)).toEqual(['win', 'win']);
  });

  it('insurance with an ace up; the dealer’s blackjack ends the round', () => {
    const s = g.setup(people(1), 3, { stack: 1000, minBet: 10, rounds: 3, decks: 1 });
    stack(s, ['9S', 'AD', '8H', 'KC']);
    g.apply(s, 0, { type: 'bet', amount: 20 });
    expect(s.phase).toBe('insurance');
    g.apply(s, 0, { type: 'insure' });
    // lose 20, insurance 10 pays 2:1 → back to 1000
    expect(s.phase).toBe('roundOver');
    expect(s.players[0].chips).toBe(1000);
    expect(s.data.result!.lines[0]).toBe('The dealer has blackjack');
  });

  it('bots play whole games; chips only move between players and the house', () => {
    for (const n of [1, 4, 7]) {
      const s = g.setup(bots(n), n, { stack: 500, minBet: 10, rounds: 12, decks: 2 });
      playOut(g, s, (x) => expect(cardsIn(x)).toBe(104));
      expect(s.data.round).toBeLessThanOrEqual(12);
    }
  });
});

describe('cheat (pagat)', () => {
  const g = GAMES.cheat as GameModule<CheatData>;

  it('deals everything; aces first, then twos', () => {
    const s = g.setup(people(4), 1, {});
    expect([0, 1, 2, 3].map((i) => ids(s, `hand:${i}`).length)).toEqual([13, 13, 13, 13]);
    expect(s.data.rank).toBe(14);
    const p = s.turn!;
    g.apply(s, p, { type: 'play', cards: ids(s, `hand:${p}`).slice(0, 2) });
    expect(s.data.rank).toBe(2);
    expect(s.zones.pile.cards.every((c) => c.up === false)).toBe(true);
  });

  it('a caught liar takes the pile; a wrong call costs the caller', () => {
    const s = g.setup(people(3), 2, {});
    const p = s.turn!;
    const lie = ids(s, `hand:${p}`).find((c) => !c.startsWith('A'))!;
    g.apply(s, p, { type: 'play', cards: [lie] });
    const caller = (p + 2) % 3;
    const before = ids(s, `hand:${p}`).length;
    g.apply(s, caller, { type: 'cheat' });
    expect(s.data.reveal).toMatchObject({ lied: true, player: p });
    expect(ids(s, 'shown')).toEqual([lie]); // turned up for everyone to see
    expect(s.turn).toBe((p + 1) % 3);
    // the shown card joins the liar's hand when play moves on
    const next = s.turn!;
    g.apply(s, next, { type: 'play', cards: [ids(s, `hand:${next}`)[0]] });
    expect(ids(s, `hand:${p}`)).toHaveLength(before + 1);

    const t = g.setup(people(3), 2, {});
    const q = t.turn!;
    const ace = ids(t, `hand:${q}`).find((c) => c.startsWith('A'));
    if (ace) {
      g.apply(t, q, { type: 'play', cards: [ace] });
      const c = (q + 1) % 3;
      const had = ids(t, `hand:${c}`).length;
      g.apply(t, c, { type: 'cheat' });
      expect(t.data.reveal).toMatchObject({ lied: false });
      expect(ids(t, `hand:${c}`)).toHaveLength(had); // takes the (now empty) rest of the pile; the ace follows
    }
  });

  it('going out wins only once nobody challenges', () => {
    const s = g.setup(people(3), 3, {});
    const p = s.turn!;
    // leave p with one card, a true ace
    s.zones[`hand:${p}`].cards = [{ id: 'AS' }];
    g.apply(s, p, { type: 'play', cards: ['AS'] });
    expect(s.phase).toBe('play');
    const next = s.turn!;
    expect(g.actions(s, next).map((a) => a.type)).toEqual(['play', 'cheat', 'accept']);
    g.apply(s, next, { type: 'cheat' });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([p]);
  });

  it('bots play whole games with every card accounted for', () => {
    for (const n of [3, 6, 8]) {
      const s = g.setup(bots(n), n, {});
      playOut(g, s, (x) => expect(cardsIn(x)).toBe(n >= 7 ? 104 : 52));
    }
  });
});

describe('go fish (pagat)', () => {
  const g = GAMES['go-fish'] as GameModule<GoFishData>;

  it('five cards each, seven for two', () => {
    expect(ids(g.setup(people(4), 1, {}), 'hand:0')).toHaveLength(5);
    expect(ids(g.setup(people(2), 1, {}), 'hand:0').length + ids(g.setup(people(2), 1, {}), 'books:0').length).toBeGreaterThanOrEqual(7);
  });

  it('a hit means ask again; a miss means go fish and the turn passes (unless the fish is lucky)', () => {
    const s = g.setup(people(3), 2, {});
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['hand:0'].cards = ['7S', '9H', 'KD'].map((id) => ({ id }));
    s.zones['hand:1'].cards = ['7H', '7C', '2D'].map((id) => ({ id }));
    s.zones['hand:2'].cards = ['5S', '6S'].map((id) => ({ id }));
    s.zones.deck.cards = ['3C', 'JD', 'QH'].map((id) => ({ id }));
    s.turn = 0;
    g.apply(s, 0, { type: 'ask', cards: ['7S'], seat: 1 });
    expect(ids(s, 'hand:0')).toEqual(expect.arrayContaining(['7S', '7H', '7C']));
    expect(s.turn).toBe(0);
    expect(() => g.apply(s, 0, { type: 'ask', cards: ['5S'], seat: 2 })).toThrow(); // must hold the rank
    g.apply(s, 0, { type: 'ask', cards: ['9H'], seat: 2 });
    expect(ids(s, 'hand:0')).toContain('QH'); // fished the top of the pond
    expect(s.turn).toBe(1);
  });

  it('books of four go down; the game ends when someone runs out', () => {
    const s = g.setup(people(2), 3, {});
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['hand:0'].cards = ['7S', '7H', '7D'].map((id) => ({ id }));
    s.zones['hand:1'].cards = ['7C', '2D'].map((id) => ({ id }));
    s.zones.deck.cards = ['3C', 'JD'].map((id) => ({ id }));
    s.turn = 0;
    g.apply(s, 0, { type: 'ask', cards: ['7S'], seat: 1 });
    expect(s.data.books[0]).toBe(1);
    expect(ids(s, 'books:0')).toHaveLength(4);
    // seat 0 has no cards left: the game is over
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([0]);
  });

  it('bots play to the end, short game and every-book game', () => {
    for (const allBooks of [false, true]) {
      for (const n of [2, 4, 6]) {
        const s = g.setup(bots(n), n, { allBooks });
        playOut(g, s, (x) => expect(cardsIn(x)).toBe(52));
        if (allBooks) expect(s.data.books.reduce((a, b) => a + b, 0)).toBe(13);
      }
    }
  });
});
