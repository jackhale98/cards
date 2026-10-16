import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/engine/cards';
import type { TrickData } from '../src/engine/families/trick';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';
import { solveSetback } from '../src/engine/families/trick/setbackSolve';
import { trickSearch } from '../src/engine/families/trick/bots';
import { trickGame } from '../src/engine/families/trick/types';

const g = GAMES.setback as GameModule<TrickData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
type S = GameState<TrickData>;

/** Give each seat these cards (six each), in a fresh hand ready to bid. */
function deal(s: S, hands: string[][]) {
  hands.forEach((h, i) => (s.zones[`hand:${i}`].cards = h.map((id) => ({ id }))));
  const used = new Set(hands.flat());
  s.zones.deck.cards = s.zones.deck.cards.filter((c) => !used.has(c.id));
}
/** Everyone bids in turn: a number, or null to pass. */
function bid(s: S, bids: (number | null)[]) {
  for (const b of bids) {
    const seat = s.turn!;
    g.apply(s, seat, b == null ? { type: 'decline' } : { type: 'pitchBid', amount: b });
  }
}
/** Play the hand out with the bots (system steps included). */
function playOut(s: S) {
  for (let i = 0; i < 300 && s.phase !== 'roundOver' && s.phase !== 'gameOver'; i++) {
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
    g.apply(s, seat, g.bot!(s, seat)!);
  }
}

describe('setback (pagat: Pitch)', () => {
  it('deals six each; bidding starts left of the dealer, one round, each bid higher', () => {
    const s = g.setup(people(4), 1, {});
    for (let i = 0; i < 4; i++) expect(s.zones[`hand:${i}`].cards).toHaveLength(6);
    expect(s.phase).toBe('pitch');
    expect(s.turn).toBe((s.dealer + 1) % 4);
    g.apply(s, s.turn!, { type: 'pitchBid', amount: 3 });
    // the next must bid more (or pass)
    expect(() => g.apply(s, s.turn!, { type: 'pitchBid', amount: 3 })).toThrow();
    expect(() => g.apply(s, s.turn!, { type: 'pitchBid', amount: 2 })).toThrow();
  });

  it('the dealer may take the bid by matching it, and pitches', () => {
    const s = g.setup(people(4), 2, {});
    bid(s, [2, 3, null, 3]);
    expect(s.data.maker).toBe(s.dealer);
    expect(s.data.pitch).toMatchObject({ bid: 3, by: s.dealer });
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(s.dealer);
  });

  it('if everyone else passes, the dealer must bid', () => {
    const s = g.setup(people(4), 3, {});
    bid(s, [null, null, null]);
    expect(s.turn).toBe(s.dealer);
    expect(g.actions(s, s.dealer).some((a) => a.type === 'decline')).toBe(false);
    expect(() => g.apply(s, s.dealer, { type: 'decline' })).toThrow();
    g.apply(s, s.dealer, { type: 'pitchBid', amount: 2 });
    expect(s.data.maker).toBe(s.dealer);
  });

  it('the pitcher’s first card names trumps; then follow suit or trump, as you like', () => {
    const s = g.setup(people(4), 4, {});
    // dealer is 3: bidding goes 0, 1, 2, 3
    deal(s, [
      ['AH', 'KH', '2S', '9C', '8C', '7C'],
      ['QH', '5S', '6S', '3C', '4D', '5D'],
      ['JH', '9S', '8S', 'TC', 'TD', '9D'],
      ['2H', '3S', '4S', 'QC', 'KD', 'AD'],
    ]);
    bid(s, [3, null, null, null]);
    expect(s.data.trump).toBeNull();
    g.apply(s, 0, { type: 'play', cards: ['9C'] });
    expect(s.data.trump).toBe('C');
    // seat 1 has the 3♣ to follow with; any club (or trump, the same here) — not a spade
    const legal1 = g.actions(s, 1).find((a) => a.type === 'play')!.select!.cards;
    expect(legal1).toEqual(['3C']);
    g.apply(s, 1, { type: 'play', cards: ['3C'] });
    g.apply(s, 2, { type: 'play', cards: ['TC'] });
    g.apply(s, 3, { type: 'play', cards: ['QC'] });
    g.system!(s)!.run(s);
    // a heart lead: seat 1 holds hearts but may trump instead (no clubs left there, so only hearts here)
    expect(s.turn).toBe(3);
    g.apply(s, 3, { type: 'play', cards: ['2H'] });
    const legal0 = g
      .actions(s, 0)
      .find((a) => a.type === 'play')!
      .select!.cards.sort();
    // seat 0 holds hearts and clubs (trumps): either is allowed, spades aren't
    expect(legal0).toEqual(['7C', '8C', 'AH', 'KH']);
  });

  it('scores High, Low, Jack and Game; the bidders make their bid, or are set back by it', () => {
    const s = g.setup(people(4), 5, {});
    deal(s, [
      ['AS', 'KS', 'JS', '2S', 'TH', 'TD'],
      ['3H', '4H', '5H', '6H', '7H', '8H'],
      ['3D', '4D', '5D', '6D', '7D', '8D'],
      ['3C', '4C', '5C', '6C', '7C', '8C'],
    ]);
    bid(s, [4, null, null, null]);
    // seat 0 holds every trump: all six tricks, so all four points
    playOut(s);
    expect(s.data.tricks[0]).toBe(6);
    expect(s.data.scores).toEqual([4, 0]);
    const lines = s.data.result!.lines.join('\n');
    expect(lines).toContain('High A♠');
    expect(lines).toContain('Low 2♠');
    expect(lines).toContain('Jack J♠');
    expect(lines).toMatch(/Game: P0 & P2/);
  });

  it('smudge: all six tricks scores five; four bid and all taken is still four', () => {
    const hands = [
      ['AS', 'KS', 'JS', '2S', 'TH', 'TD'],
      ['3H', '4H', '5H', '6H', '7H', '8H'],
      ['3D', '4D', '5D', '6D', '7D', '8D'],
      ['3C', '4C', '5C', '6C', '7C', '8C'],
    ];
    const s = g.setup(people(4), 6, {});
    deal(s, hands);
    bid(s, [5, null, null, null]);
    playOut(s);
    expect(s.data.scores).toEqual([5, 0]);
  });

  it('a side that misses its bid is set back; the other side scores what it took', () => {
    for (let seed = 1; seed < 80; seed++) {
      const s = g.setup(bots(4), seed, {});
      bid(s, [4, null, null, null]);
      playOut(s);
      const bidders = s.data.pitch!.by! % 2;
      if (s.data.scores[bidders] !== -4) continue;
      const others = 1 - bidders;
      expect(s.data.scores[others]).toBeGreaterThanOrEqual(1);
      expect(s.data.result!.lines.join('\n')).toContain('set back 4');
      return;
    }
    throw new Error('no failed bid of 4 in 80 seeds');
  });

  it('only a side that made its bid can win; reaching the target on defence plays on', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = g.setup(bots(4), seed, {});
      // the bidders (seat 0's side) can't get to 21 this hand; the other side is one point away
      s.data.scores = [0, 20];
      bid(s, [2, null, null, null]);
      playOut(s);
      if (s.data.scores[1] < 21) continue;
      expect(s.phase).toBe('roundOver');
      expect(s.winner).toBeUndefined();
      expect(s.data.result!.lines.join('\n')).toContain('Only the side that made the bid can win');
      return;
    }
    throw new Error('the defenders never scored in 40 seeds');
  });

  it('bidders who make it and reach the target win', () => {
    const s = g.setup(people(4), 7, {});
    deal(s, [
      ['AS', 'KS', 'JS', '2S', 'TH', 'TD'],
      ['3H', '4H', '5H', '6H', '7H', '8H'],
      ['3D', '4D', '5D', '6D', '7D', '8D'],
      ['3C', '4C', '5C', '6C', '7C', '8C'],
    ]);
    s.data.scores = [19, 0];
    bid(s, [2, null, null, null]);
    playOut(s);
    expect(s.phase).toBe('gameOver');
    expect(s.winner!.sort()).toEqual([0, 2]);
  });

  it('the cards that score are kept from the players until the hand is scored', () => {
    const s = g.setup(people(4), 8, {});
    bid(s, [2, null, null, null]);
    g.apply(s, s.turn!, { type: 'play', cards: [s.zones[`hand:${s.turn}`].cards[0].id] });
    expect(s.data.pitch!.low).not.toBeNull();
    for (let v = 0; v < 4; v++) expect(g.redactData!(s, v).pitch).toMatchObject({ high: null, low: null, jack: null });
  });

  it('nor who has taken them so far (that would say which trumps were dealt)', () => {
    const s = g.setup(people(4), 5, {});
    deal(s, [
      ['AS', 'KS', 'JS', '2S', 'TH', 'TD'],
      ['3H', '4H', '5H', '6H', '7H', '8H'],
      ['3D', '4D', '5D', '6D', '7D', '8D'],
      ['3C', '4C', '5C', '6C', '7C', '8C'],
    ]);
    bid(s, [4, null, null, null]);
    for (const [seat, card] of [
      [0, '2S'],
      [1, '3H'],
      [2, '3D'],
      [3, '3C'],
    ] as const)
      g.apply(s, seat, { type: 'play', cards: [card] });
    g.system!(s)!.run(s);
    expect(s.data.pitch!.lowTo).toBe(0);
    for (let v = 0; v < 4; v++) expect(g.redactData!(s, v).pitch).toMatchObject({ highBy: null, lowTo: null, jackTo: null });
  });

  it('the exact solver keeps the jack back until the king has fallen', () => {
    // head to head, spades trumps, two cards left: lead the ace to draw the king, then the jack is safe
    const solved = solveSetback({
      hands: [
        ['AS', 'JS'],
        ['KS', '3H'],
      ],
      trump: 'S',
      trick: [],
      turn: 0,
      side: [0, 1],
      me: 0,
      bidders: 0,
      bid: 2,
      game: [0, 0],
      lowTo: 0,
      jackTo: -1,
      tricks: [4, 0],
      highSide: 0,
      low: '2S',
      jack: 'JS',
      handSize: 6,
    })!;
    const v = Object.fromEntries(solved.map((x) => [x.card, x.value]));
    // the ace first: High, Low, Jack and Game (4 to 0); the jack first loses it and Game to the king
    expect(v.AS).toBe(4);
    expect(v.JS).toBeLessThan(v.AS);
  });

  it('imagined deals know which trumps score, from the cards placed in them', () => {
    const s = g.setup(bots(4), 5, { botLevel: 1 });
    bid(s, [4, null, null, null]);
    g.apply(s, s.turn!, { type: 'play', cards: [s.zones[`hand:${s.turn}`].cards[0].id] });
    const view = structuredClone(s);
    view.data = g.redactData!(s, 1) as TrickData;
    const deal = trickSearch(trickGame(g.config), g).determinize(view, 1);
    const trumps = Object.values(deal.zones)
      .filter((z) => z.id === 'trick' || z.id.startsWith('hand:'))
      .flatMap((z) => z.cards.map((c) => c.id))
      .filter((c) => parseCard(c).suit === deal.data.trump)
      .sort((a, b) => parseCard(a).rank - parseCard(b).rank);
    expect(deal.data.pitch).toMatchObject({ low: trumps[0], high: trumps[trumps.length - 1] });
  });

  it('Hard bots play a hand through (the end of it solved exactly)', () => {
    const s = g.setup(bots(4), 21, { botLevel: 2 });
    playOut(s);
    expect(s.phase).toMatch(/roundOver|gameOver/);
  }, 60_000);

  it('three play cutthroat (each for themselves), two head to head', () => {
    const three = g.setup(people(3), 9, {});
    expect(three.data.scores).toEqual([0, 0, 0]);
    const two = g.setup(people(2), 9, {});
    expect(two.data.scores).toEqual([0, 0]);
    for (let i = 0; i < 2; i++) expect(two.zones[`hand:${i}`].cards).toHaveLength(6);
  });

  it('bots play whole games, at every size', () => {
    for (const n of [2, 3, 4]) {
      const s = g.setup(bots(n), 10 + n, {});
      for (let i = 0; i < 5000 && s.phase !== 'gameOver'; i++) {
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
        expect(seat, `${n} players, phase ${s.phase}`).toBeGreaterThanOrEqual(0);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      const winners = new Set(s.winner!.map((w) => (n === 4 ? w % 2 : w)));
      expect(winners.size).toBe(1);
      for (const c of s.zones.trick.cards) expect(parseCard(c.id)).toBeTruthy();
    }
  }, 60_000);
});
