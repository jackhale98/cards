import { describe, expect, it } from 'vitest';
import type { Action, GameModule, GameState } from '../src/engine/types';
import { buildDeck } from '../src/engine/cards';
import type { TrickData } from '../src/engine/families/trick';
import type { PokerData } from '../src/engine/families/poker';
import { GAMES } from '../src/games';

const hearts = GAMES.hearts as GameModule<TrickData>;
const holdem = GAMES.holdem as GameModule<PokerData>;
const freetable = GAMES.freetable;
const legalCards = (s: GameState<TrickData>, seat: number) => hearts.actions(s, seat).find((a) => a.type === 'play')?.select?.cards ?? [];
type HeartsData = TrickData;
type HoldemData = PokerData;

/** Drive a game with bots for every seat (running system steps instantly). */
function simulate(g: GameModule, s: GameState, maxSteps = 5000, stopPhase = 'gameOver') {
  for (let step = 0; step < maxSteps; step++) {
    if (s.phase === stopPhase) return step;
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    let acted = false;
    for (const p of s.players) {
      const a = g.bot!(s, p.seat);
      if (a) {
        g.apply(s, p.seat, a);
        acted = true;
        break;
      }
    }
    if (!acted) {
      // phases where a human presses "next"
      const next = s.players.map((p) => g.actions(s, p.seat).find((x) => x.type === 'next')).find(Boolean);
      if (!next) throw new Error(`Stuck in phase ${s.phase}`);
      g.apply(s, 0, { type: 'next' });
    }
  }
  throw new Error('Did not finish');
}

const totalCards = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

describe('hearts', () => {
  const players = ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true }));

  it('deals 13 each and starts by passing left', () => {
    const s = hearts.setup(players, 1, { target: 100 });
    expect(s.phase).toBe('pass');
    expect(s.data.passDir).toBe('left');
    for (let i = 0; i < 4; i++) expect(s.zones[`hand:${i}`].cards).toHaveLength(13);
  });

  it('passes cards simultaneously and the 2♣ leads', () => {
    const s = hearts.setup(players, 2, {});
    const passes = [0, 1, 2, 3].map((i) => s.zones[`hand:${i}`].cards.slice(0, 3).map((c) => c.id));
    passes.forEach((cards, i) => hearts.apply(s, i, { type: 'pass', cards }));
    expect(s.phase).toBe('play');
    // seat 0 passed left, so seat 1 has seat 0's cards
    for (const c of passes[0]) expect(s.zones['hand:1'].cards.some((x) => x.id === c)).toBe(true);
    expect(s.zones[`hand:${s.turn}`].cards.some((c) => c.id === '2C')).toBe(true);
    expect(legalCards(s as GameState<HeartsData>, s.turn!)).toEqual(['2C']);
    // hearts can't be led before they're broken, and point cards can't go on the first trick
    expect(s.data.broken).toBe(false);
  });

  it('rejects illegal plays', () => {
    const s = hearts.setup(players, 3, {});
    s.players.forEach((_, i) => hearts.apply(s, i, { type: 'pass', cards: s.zones[`hand:${i}`].cards.slice(0, 3).map((c) => c.id) }));
    const seat = s.turn!;
    const other = s.zones[`hand:${seat}`].cards.find((c) => c.id !== '2C')!.id;
    expect(() => hearts.apply(s, seat, { type: 'play', cards: [other] })).toThrow();
    expect(() => hearts.apply(s, (seat + 1) % 4, { type: 'play', cards: ['2C'] })).toThrow();
  });

  it('scores 26 points per hand and plays to completion with bots', () => {
    const s = hearts.setup(players, 4, { target: 100 }) as GameState<HeartsData>;
    simulate(hearts, s, 20000, 'roundOver');
    const sum = s.data.scores.reduce((a, b) => a + b, 0);
    expect(sum === 26 || sum === 78).toBe(true);
    expect(totalCards(s)).toBe(52);
    hearts.apply(s, 0, { type: 'next' });
    simulate(hearts, s, 50000);
    expect(s.phase).toBe('gameOver');
    expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(100);
    expect(s.winner!.every((w) => s.data.scores[w] === Math.min(...s.data.scores))).toBe(true);
  });

  it.each([
    ['moonAdd', [10, 46, 56, 66]],
    ['moonSub', [-16, 20, 30, 40]],
  ])('lets the moon shooter choose (%s)', (choice, expected) => {
    const s = hearts.setup(players, 5, {}) as GameState<HeartsData>;
    // rig the last trick: seat 0 has taken every point so far and wins this one too
    for (const z of Object.values(s.zones)) z.cards = [];
    ['AC', '2C', '3C', '4C'].forEach((id, i) => (s.zones[`hand:${i}`].cards = [{ id }]));
    Object.assign(s.data, { trickNo: 12, points: [26, 0, 0, 0], scores: [10, 20, 30, 40], broken: true });
    s.phase = 'play';
    s.turn = 0;
    for (let i = 0; i < 4; i++) hearts.apply(s, i, { type: 'play', cards: [s.zones[`hand:${i}`].cards[0].id] });
    hearts.system!(s)!.run(s);
    expect(s.phase).toBe('moon');
    expect(hearts.actions(s, 0).map((x) => x.type)).toEqual(['moonSub', 'moonAdd']);
    hearts.apply(s, 0, { type: choice });
    expect(s.phase).toBe('roundOver');
    expect(s.data.scores).toEqual(expected);
  });
});

describe("texas hold'em", () => {
  it('posts blinds and deals two cards each', () => {
    const s = holdem.setup([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 1, { stack: 1000, bigBlind: 10 }) as GameState<HoldemData>;
    expect(s.players.map((p) => p.chips)).toEqual([1000, 995, 990]);
    for (let i = 0; i < 3; i++) expect(s.zones[`hand:${i}`].cards).toHaveLength(2);
    expect(s.turn).toBe(0); // under the gun is left of the big blind
  });

  it('conserves chips over a full bot game', () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, bot: true }));
    const s = holdem.setup(players, 9, { stack: 300, bigBlind: 20 }) as GameState<HoldemData>;
    let handsChecked = 0;
    for (let step = 0; step < 200000 && s.phase !== 'gameOver'; step++) {
      if (s.phase === 'handOver') {
        expect(s.players.reduce((n, p) => n + p.chips, 0)).toBe(1500);
        expect(totalCards(s)).toBe(52);
        handsChecked++;
        holdem.apply(s, s.players.find((p) => p.chips > 0)!.seat, { type: 'next' });
        continue;
      }
      const sys = holdem.system!(s);
      if (sys) {
        sys.run(s);
        continue;
      }
      const a = holdem.bot!(s, s.turn!) as Action;
      holdem.apply(s, s.turn!, a);
      // chips in front + behind always add up
      expect(s.players.reduce((n, p) => n + p.chips, 0) + s.data.b.committed.reduce((x, y) => x + y, 0)).toBe(1500);
    }
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toHaveLength(1);
    expect(s.players[s.winner![0]].chips).toBe(1500);
    expect(handsChecked).toBeGreaterThan(0);
  });

  it('splits a tied pot', () => {
    const s = holdem.setup([{ name: 'A' }, { name: 'B' }], 1, { stack: 100, bigBlind: 10 }) as GameState<HoldemData>;
    // rig: both players play the board
    s.zones['hand:0'].cards = [{ id: '2C' }, { id: '3D' }];
    s.zones['hand:1'].cards = [{ id: '2D' }, { id: '3C' }];
    // both players hold 2-3 offsuit; the board is a royal flush, so both play the board
    const board = ['AS', 'KS', 'QS', 'JS', 'TS'];
    const burns = ['4H', '5H', '6H'];
    s.zones.deck.cards = buildDeck()
      .filter((c) => ![...board, ...burns, '2C', '3D', '2D', '3C'].includes(c))
      .map((id) => ({ id }));
    // cards come off the end of the deck: burn, flop×3, burn, turn, burn, river
    const order = [burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4]];
    s.zones.deck.cards.push(...order.reverse().map((id) => ({ id })));
    const act = (type: string) => holdem.apply(s, s.turn!, { type });
    act('call');
    act('check');
    for (let street = 0; street < 3; street++) {
      act('check');
      act('check');
    }
    expect(s.phase).toBe('handOver');
    expect(s.zones.board.cards.map((c) => c.id).sort()).toEqual([...board].sort());
    expect(s.players.map((p) => p.chips)).toEqual([100, 100]);
  });
});

describe('free table', () => {
  it('deals, plays, bets and collects', () => {
    const s = freetable.setup([{ name: 'A' }, { name: 'B' }], 1, {});
    freetable.apply(s, 0, { type: 'deal', amount: 5 });
    expect(s.zones['hand:0'].cards).toHaveLength(5);
    const card = s.zones['hand:0'].cards[0].id;
    freetable.apply(s, 0, { type: 'play', cards: [card] });
    expect(s.zones.table.cards[0]).toMatchObject({ id: card, up: true, by: 0 });
    freetable.apply(s, 1, { type: 'take', cards: [card] });
    expect(s.zones['hand:1'].cards.some((c) => c.id === card)).toBe(true);
    expect(() => freetable.apply(s, 0, { type: 'take', cards: [s.zones['hand:1'].cards[0].id] })).toThrow();
    freetable.apply(s, 0, { type: 'bet', amount: 50 });
    freetable.apply(s, 1, { type: 'takePot' });
    expect(s.players.map((p) => p.chips)).toEqual([950, 1050]);
    freetable.apply(s, 0, { type: 'collect' });
    expect(s.zones.deck.cards).toHaveLength(52);
  });
});

describe('free table: rummy moves and deck placement', () => {
  const setup = () => {
    const s = freetable.setup([{ name: 'A' }, { name: 'B' }], 1, {});
    const a = ['7H', '8H', '9H', '6H', 'KS'];
    const b = ['TH', '2C'];
    s.zones.deck.cards = s.zones.deck.cards.filter((c) => ![...a, ...b].includes(c.id));
    s.zones['hand:0'].cards = a.map((id) => ({ id }));
    s.zones['hand:1'].cards = b.map((id) => ({ id }));
    return s;
  };

  it('lays down melds and lets anyone add to them', () => {
    const s = setup();
    freetable.apply(s, 0, { type: 'meld', cards: ['8H', '7H', '9H'] });
    expect(s.zones['melds:0'].cards.map((c) => c.id)).toEqual(['7H', '8H', '9H']);
    expect(s.zones['melds:0'].label).toBe("A's melds");
    // B adds 10♥ to A's meld by selecting one card of it
    freetable.apply(s, 1, { type: 'layoff', cards: ['TH', '8H'] });
    expect(s.zones['melds:0'].cards.map((c) => c.id)).toEqual(['7H', '8H', '9H', 'TH']);
    expect(s.zones['melds:0'].cards.every((c) => c.group === 0)).toBe(true);
    // a second meld is its own group
    freetable.apply(s, 0, { type: 'meld', cards: ['6H'] });
    expect(s.zones['melds:0'].cards.find((c) => c.id === '6H')!.group).toBe(1);
    // ambiguous layoff (no meld card selected) is rejected
    expect(() => freetable.apply(s, 1, { type: 'layoff', cards: ['2C', 'KS'] })).toThrow();
    expect(s.log.at(-1)?.seat).toBe(0);
  });

  it('discards face down and takes the top discard back', () => {
    const s = setup();
    freetable.apply(s, 0, { type: 'discardDown', cards: ['KS'] });
    expect(s.zones.discard.cards.at(-1)).toMatchObject({ id: 'KS', up: false });
    freetable.apply(s, 1, { type: 'takeDiscard' });
    expect(s.zones['hand:1'].cards.some((c) => c.id === 'KS')).toBe(true);
  });

  it('puts cards on the bottom or top of the deck', () => {
    const s = setup();
    const before = s.zones.deck.cards.length;
    freetable.apply(s, 0, { type: 'toBottom', cards: ['KS', '6H'] });
    expect(s.zones.deck.cards.length).toBe(before + 2);
    expect(s.zones.deck.cards.slice(0, 2).map((c) => c.id).sort()).toEqual(['6H', 'KS']);
    freetable.apply(s, 0, { type: 'toTop', cards: ['7H'] });
    expect(s.zones.deck.cards.at(-1)!.id).toBe('7H');
    // the next draw takes the card just put on top
    freetable.apply(s, 1, { type: 'draw' });
    expect(s.zones['hand:1'].cards.at(-1)!.id).toBe('7H');
  });
});

describe('free table: passing cards', () => {
  const four = () => {
    const s = freetable.setup(['A', 'B', 'C', 'D'].map((name) => ({ name })), 9, {});
    freetable.apply(s, 0, { type: 'deal', amount: 3 });
    return s;
  };

  it('offers left, then right, then everyone else', () => {
    const s = four();
    const give = freetable.actions(s, 0).find((a) => a.type === 'give')!;
    expect(give.target!.seats).toEqual([1, 3, 2]);
    expect(freetable.actions(s, 2).find((a) => a.type === 'give')!.target!.seats).toEqual([3, 1, 0]);
  });

  it('passes face down to the chosen player without naming the cards', () => {
    const s = four();
    const cards = s.zones['hand:0'].cards.slice(0, 2).map((c) => c.id);
    freetable.apply(s, 0, { type: 'give', cards, seat: 3 });
    expect(s.zones['hand:3'].cards.map((c) => c.id)).toEqual(expect.arrayContaining(cards));
    expect(s.zones['hand:0'].cards).toHaveLength(1);
    const entry = s.log.at(-1)!;
    expect(entry.text).toBe('A passes 2 cards right to D');
    expect(entry.to).toBe(3);
    expect(() => freetable.apply(s, 0, { type: 'give', cards: [s.zones['hand:0'].cards[0].id], seat: 0 })).toThrow();
    expect(() => freetable.apply(s, 0, { type: 'give', cards: [s.zones['hand:1'].cards[0].id], seat: 2 })).toThrow();
  });
});
