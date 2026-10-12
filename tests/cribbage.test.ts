import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/engine/cards';
import { describeShow, pegPoints, scoreHand } from '../src/engine/lib/cribbageScore';

const h = (s: string) => s.split(' ');

/** These tests rig hands for a known dealer, the last seat: pick a seed whose cut gives that. */
function setupLastDeals(players: { name: string; bot?: boolean }[], seed: number, options: Record<string, number | boolean>) {
  for (let k = seed; ; k += 1000) {
    const s = crib.setup(players, k, options);
    if (s.dealer === players.length - 1) return s;
  }
}

describe('cribbage hand counting', () => {
  it.each([
    // the perfect 29: three 5s + jack of the starter's suit, starter a 5
    ['5C 5D 5H JS', '5S', false, 29],
    ['5C 5D 5H 5S', 'JD', false, 28],
    // double double run 3-4-4-5-5: runs 12 + two pairs 4 (no fifteens)
    ['3C 4D 4H 5S', '5C', false, 16],
    // run of 4 + fifteens 2-4-9 and A-2-3-9
    ['AC 2D 3H 4S', '9C', false, 8],
    ['2H 4H 6H 8H', 'KC', false, 4], // four-card flush; all even, so no fifteens
    ['2H 4H 6H 8H', 'KC', true, 0], // the crib needs all five for a flush
    ['2H 4H 6H 8H', 'TH', true, 5], // five-card flush counts in the crib
    ['4C 5D 5H 6S', '6C', false, 24], // the classic double-double: 4 fifteens (8) + runs 12 + pairs 4
    ['9C TD QH KS', 'AC', false, 0], // nineteen
  ])('%s + %s (crib %s) = %i', (hand, starter, crib, total) => {
    expect(scoreHand(h(hand), starter, crib).total).toBe(total);
  });

  it('breaks a hand into its parts', () => {
    const s = scoreHand(h('5C 5D JH QS'), 'KH');
    // fifteens: each 5 with each of J, Q, K = 6 combos = 12; pair of 5s = 2; nobs (JH, starter ♥) = 1
    expect(s).toMatchObject({ fifteens: 12, pairs: 2, runs: 3, flush: 0, nobs: 1 });
    expect(s.total).toBe(18);
    expect(describeShow(s)).toBe('fifteen 12 · pair 2 · run 3 · nobs 1 = 18');
    expect(describeShow(scoreHand(h('9C TD QH KS'), 'AC'))).toMatch(/nineteen/);
  });
});

describe('cribbage pegging', () => {
  it.each([
    ['5H TC', 2, 'fifteen'],
    ['KH 5C 6D QS', 2, 'thirty-one'],
    ['7H 7C', 2, 'pair'],
    ['7H 7C 7D', 6, 'three of a kind'],
    ['3H 4C 5D', 3, 'run of 3'],
    ['4H 6C 5D', 5, 'fifteen'], // 4+6+5 = 15 and a run of 3
    ['2H 4C 3D 5S', 4, 'run of 4'],
    ['8H 3C 4D 3S', 0, ''], // 3s not adjacent: no pair; 3,4,3 not a run
  ])('%s → %i', (seq, pts, reason) => {
    const r = pegPoints(h(seq));
    expect(r.points).toBe(pts);
    if (reason) expect(r.reasons.join(' ')).toContain(reason);
  });
});

import type { CribData } from '../src/engine/families/cribbage';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const crib = GAMES.cribbage as GameModule<CribData>;
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

function play(s: GameState<CribData>, onShow?: (s: GameState<CribData>) => void) {
  for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
    const sys = crib.system!(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    if (s.phase === 'roundOver') {
      onShow?.(s);
      crib.apply(s, 0, { type: 'next' });
      continue;
    }
    const seat = s.players.findIndex((p) => crib.bot!(s, p.seat));
    if (seat < 0) throw new Error(`stuck in ${s.phase}`);
    crib.apply(s, seat, crib.bot!(s, seat)!);
  }
}

describe('cribbage game', () => {
  it.each([2, 3, 4])('%i players play to 121 with every card accounted for', (n) => {
    const s = setupLastDeals(bots(n), 30 + n, {});
    expect(s.zones['hand:0'].cards).toHaveLength(n === 2 ? 6 : 5);
    let hands = 0;
    play(s, (r) => {
      hands++;
      expect(cardsIn(r)).toBe(52);
      // everyone kept 4, the crib has 4
      expect(r.data.kept.every((k) => k.length === 4)).toBe(true);
    });
    expect(s.phase).toBe('gameOver');
    expect(Math.max(...s.data.scores)).toBe(121);
    expect(hands).toBeGreaterThan(2);
    if (n === 4) expect(s.winner).toHaveLength(2);
  });

  it('pegs 15s, pairs, go and last card', () => {
    const s = setupLastDeals(bots(2), 1, {});
    // rig: after the cut, pone (seat 0) and dealer (seat 1) each hold 4 cards
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['hand:0'].cards = ['5H', 'KC', '9D', '2S'].map((id) => ({ id }));
    s.zones['hand:1'].cards = ['TS', '5C', 'QD', '3H'].map((id) => ({ id }));
    s.zones.starter.cards = [{ id: '4D', up: true }];
    s.data.kept = [['5H', 'KC', '9D', '2S'], ['TS', '5C', 'QD', '3H']];
    Object.assign(s.data, { count: 0, goes: [false, false], lastPlayer: null });
    s.phase = 'peg';
    s.turn = 0;
    const p = (seat: number, card: string) => crib.apply(s, seat, { type: 'play', cards: [card] });
    p(0, '5H');
    p(1, 'TS'); // 15 for 2 to the dealer
    expect(s.data.scores).toEqual([0, 2]);
    p(0, 'KC'); // 25
    p(1, '3H'); // 28
    // pone holds 9 and 2: 2 makes 30
    p(0, '2S'); // 30
    // dealer has 5 and Q: can't play → must say go
    expect(crib.actions(s, 1).map((a) => a.type)).toEqual(['go']);
    crib.apply(s, 1, { type: 'go' });
    // pone can't play the 9 either → go; pone was last to play: 1 for go
    expect(s.turn).toBe(0);
    crib.apply(s, 0, { type: 'go' });
    expect(s.data.scores).toEqual([1, 2]);
    expect(s.data.count).toBe(0);
    // dealer leads the new count
    expect(s.turn).toBe(1);
    p(1, '5C');
    p(0, '9D'); // 14
    p(1, 'QD'); // 24, last card → 1
    expect(s.data.scores).toEqual([1, 3]);
    expect(s.phase).toBe('show');
  });

  it('counts the show, pone first, and gives the dealer his heels', () => {
    const s = setupLastDeals(bots(2), 2, {});
    // force a jack starter
    const deck = s.zones.deck.cards;
    s.players.forEach((_, i) => crib.apply(s, i, { type: 'crib', cards: s.zones[`hand:${i}`].cards.slice(0, 2).map((c) => c.id) }));
    expect(s.phase).toBe('cut');
    expect(s.turn).toBe(0); // pone cuts
    for (const c of deck) if (c.id.startsWith('J')) {
      deck.splice(deck.indexOf(c), 1);
      deck.splice(Math.floor(deck.length / 2), 0, c);
      break;
    }
    // make every remaining deck card the jack position-independent: replace the deck with jacks first
    s.zones.deck.cards = s.zones.deck.cards.filter((c) => c.id.startsWith('J')).concat(s.zones.deck.cards.filter((c) => !c.id.startsWith('J')));
    const jacks = s.zones.deck.cards.filter((c) => c.id.startsWith('J')).length;
    s.zones.deck.cards = s.zones.deck.cards.slice(0, jacks); // only jacks left to cut
    crib.apply(s, 0, { type: 'cut' });
    expect(s.zones.starter.cards[0].id[0]).toBe('J');
    expect(s.data.scores).toEqual([0, 2]);
  });
});

describe('cribbage: counting your own hands (muggins)', () => {
  const PONE = ['5H', '5C', 'TD', 'JS'];
  const DEALER = ['2C', '3C', '4H', '9S'];
  const CRIB = ['AD', 'KH', '7C', '8D'];
  const STARTER = '5D';
  /** A two-player hand at the start of the show, pone (seat 0) about to count. */
  function atShow(scores = [0, 0]) {
    const s = setupLastDeals(bots(2), 3, { muggins: true });
    s.players.forEach((p) => (p.bot = false));
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['played:0'].cards = PONE.map((id) => ({ id, up: true }));
    s.zones['played:1'].cards = DEALER.map((id) => ({ id, up: true }));
    s.zones.crib.cards = CRIB.map((id) => ({ id }));
    s.zones.starter.cards = [{ id: STARTER, up: true }];
    s.zones.deck.cards = buildDeck({}).filter((c) => ![...PONE, ...DEALER, ...CRIB, STARTER].includes(c)).map((id) => ({ id }));
    Object.assign(s.data, { kept: [PONE, DEALER], scores: [...scores], prev: [...scores] });
    s.phase = 'show';
    s.data.showStep = 0;
    crib.system!(s)!.run(s);
    return s;
  }
  const worth = scoreHand(PONE, STARTER).total;

  it('asks the player to count, then the opponent to check', () => {
    const s = atShow();
    expect(s.phase).toBe('count');
    expect(crib.actions(s, 0).map((a) => a.type)).toEqual(['count']);
    expect(crib.actions(s, 1)).toEqual([]);
    crib.apply(s, 0, { type: 'count', amount: worth });
    expect(crib.actions(s, 1).map((a) => a.type)).toEqual(['accept', 'muggins']);
    // the true value is never shown before it's settled
    expect(JSON.stringify(crib.status(s, 1))).not.toContain(describeShow(scoreHand(PONE, STARTER)));
    crib.apply(s, 1, { type: 'accept' });
    expect(s.data.scores).toEqual([worth, 0]);
    expect(s.phase).toBe('show');
  });

  it('gives missed points to the opponent who spots them (no more than were missed)', () => {
    let s = atShow();
    crib.apply(s, 0, { type: 'count', amount: worth - 4 });
    crib.apply(s, 1, { type: 'muggins', amount: worth });
    expect(s.data.scores).toEqual([worth - 4, 4]);
    s = atShow();
    crib.apply(s, 0, { type: 'count', amount: worth - 4 });
    crib.apply(s, 1, { type: 'muggins', amount: worth + 2 });
    expect(s.data.scores).toEqual([worth - 4, 4]);
  });

  it('cuts an overcount back and gives the excess to the opponent', () => {
    const s = atShow();
    crib.apply(s, 0, { type: 'count', amount: worth + 3 });
    crib.apply(s, 1, { type: 'muggins', amount: worth });
    expect(s.data.scores).toEqual([worth, 3]);
  });

  it('a wrong muggins call gives the counter the difference', () => {
    const s = atShow();
    crib.apply(s, 0, { type: 'count', amount: worth });
    crib.apply(s, 1, { type: 'muggins', amount: worth + 2 });
    expect(s.data.scores).toEqual([worth + 2, 0]);
  });

  it('an unchallenged miscount stands', () => {
    const s = atShow();
    crib.apply(s, 0, { type: 'count', amount: worth + 5 });
    crib.apply(s, 1, { type: 'accept' });
    expect(s.data.scores).toEqual([worth + 5, 0]);
  });

  it('counts the dealer hand and the crib the same way, then ends the hand', () => {
    const s = atShow();
    crib.apply(s, 0, { type: 'count', amount: worth });
    crib.apply(s, 1, { type: 'accept' });
    crib.system!(s)!.run(s);
    expect(s.data.claim).toMatchObject({ seat: 1, crib: false });
    crib.apply(s, 1, { type: 'count', amount: 0 });
    crib.apply(s, 0, { type: 'accept' });
    crib.system!(s)!.run(s);
    expect(s.data.claim).toMatchObject({ seat: 1, crib: true });
    const cribWorth = scoreHand(CRIB, STARTER, true).total;
    crib.apply(s, 1, { type: 'count', amount: cribWorth });
    crib.apply(s, 0, { type: 'accept' });
    expect(s.phase).toBe('roundOver');
    expect(s.data.scores).toEqual([worth, cribWorth]); // the dealer's hand was counted 0 and accepted
  });

  it('bots count correctly and catch mistakes', () => {
    const s = atShow();
    s.players[1].bot = true;
    crib.apply(s, 0, { type: 'count', amount: worth - 2 });
    expect(crib.bot!(s, 1)).toEqual({ type: 'muggins', amount: worth });
  });

  it('in partnerships only the other side checks the count', () => {
    const s = setupLastDeals(bots(4), 9, { muggins: true });
    while (s.phase !== 'count') {
      const sys = crib.system!(s);
      if (sys) sys.run(s);
      else {
        const seat = s.players.findIndex((p) => crib.bot!(s, p.seat));
        crib.apply(s, seat, crib.bot!(s, seat)!);
      }
    }
    const who = s.data.claim!.seat;
    crib.apply(s, who, { type: 'count', amount: 1 });
    expect(crib.actions(s, (who + 2) % 4)).toEqual([]);
    expect(crib.actions(s, (who + 1) % 4).map((a) => a.type)).toEqual(['accept', 'muggins']);
    expect(crib.actions(s, (who + 3) % 4).map((a) => a.type)).toEqual(['accept', 'muggins']);
  });

  it.each([2, 3, 4])('%i players play a whole game with bots counting', (n) => {
    const s = setupLastDeals(bots(n), 50 + n, { muggins: true });
    let hands = 0;
    play(s, (r) => {
      hands++;
      expect(cardsIn(r)).toBe(52);
    });
    expect(s.phase).toBe('gameOver');
    expect(hands).toBeGreaterThan(2);
  });
});
