import { nextRandom, seedState } from '../src/engine/rng';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TrickData } from '../src/engine/families/trick';
import { ddTable, loadDds, solveCards } from '../src/engine/bots/dds';
import { bagWorth, ddBid, ddCard } from '../src/engine/families/trick/ddPlay';
import { quickTricks } from '../src/engine/families/trick/bots';
import { trickGame } from '../src/engine/families/trick/types';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['bridge'] as GameModule<TrickData>;
const RANKS = '23456789TJQKA';
const handsOf = (deal: string) =>
  deal
    .slice(2)
    .split(' ')
    .map((h) => h.split('.').map((x) => [...x].reduce((m, c) => m | (1 << RANKS.indexOf(c)), 0)));

beforeAll(async () => {
  expect(await loadDds()).toBe(true);
});

describe('DDS (the double-dummy solver), built to WebAssembly', () => {
  it('agrees with endplay’s DDS on every strain and declarer of 8 random deals', () => {
    // (tests/fixtures/dd-endplay.jsonl: deals and their tricks from tools/dd_deals.py)
    const rows = readFileSync('tests/fixtures/dd-endplay.jsonl', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { deal: string; t: Record<string, Record<string, number>> });
    for (const r of rows) {
      const table = ddTable(handsOf(r.deal))!;
      ['S', 'H', 'D', 'C', 'NT'].forEach((x, k) => [0, 1, 2, 3].forEach((h) => expect(table[k][h], `${r.deal} ${x} ${'NESW'[h]}`).toBe(r.t['NESW'[h]][x])));
    }
    // (a whole table is twenty solves: about half a second each)
  }, 60000);

  it('values every card the player to move may play, a trick part played', () => {
    // North on lead at no trumps with ♠A2 and dummy (South) ♠K ♥A: ♠2 first unblocks, two tricks
    const S = 0;
    const H = 1;
    const hands = [
      [(1 << 12) | (1 << 0), 0, 0, 0],
      [(1 << 10) | (1 << 9), 0, 0, 0],
      [1 << 11, 1 << 12, 0, 0],
      [0, (1 << 11) | (1 << 10), 0, 0],
    ];
    const v = solveCards({ hands, trump: 4, leader: 0, trick: [] })!;
    expect(v.find((c) => c.suit === S && c.rank === 0)!.tricks).toBe(2);
    expect(v.find((c) => c.suit === S && c.rank === 12)!.tricks).toBe(1);
    // (every card on offer is valued: dummy's ♥A isn't North's to play)
    expect(v.some((c) => c.suit === H)).toBe(false);
  });
});

describe('Hard bridge bots play by deals of the unseen cards, each solved double dummy', () => {
  it('find the unblocking play whatever the other hands hold, seeing only their own cards and dummy', () => {
    const tg = trickGame(g.config);
    const s = g.setup(
      ['N', 'E', 'S', 'W'].map((name) => ({ name, bot: true })),
      1,
      { botLevel: 2, system: 0 },
    ) as GameState<TrickData>;
    // the last two tricks: North (declarer) ♠A2, dummy ♠K ♥A; East and West hold ♠QJ ♥KQ between them
    const d = s.data;
    s.phase = 'play';
    s.turn = 0;
    d.trump = null;
    d.bridge = { level: 3, strain: 'NT', dbl: 0 };
    d.maker = 0;
    d.dummy = 2;
    d.dummyUp = true;
    d.voids = [[], [], [], []];
    const live = ['AS', '2S', 'KS', 'AH', 'QS', 'JS', 'KH', 'QH'];
    const rest = tg.deckCards.filter((c) => !live.includes(c));
    d.played = [0, 1, 2, 3].map((k) => rest.slice(k * 11, k * 11 + 11));
    for (const z of Object.keys(s.zones)) s.zones[z].cards = [];
    s.zones['hand:0'].cards = [{ id: 'AS' }, { id: '2S' }];
    s.zones['dummy'].cards = [{ id: 'KS' }, { id: 'AH' }];
    s.zones['hand:1'].cards = [{ id: 'QS' }, { id: 'KH' }];
    s.zones['hand:3'].cards = [{ id: 'JS' }, { id: 'QH' }];
    expect(ddCard(tg, s, 0, { samples: 6, ms: Infinity, least: 6 })).toBe('2S');
  });

  it('pass on to the usual search at Hearts (points, not tricks)', () => {
    const hearts = GAMES['hearts'] as GameModule<TrickData>;
    const s = hearts.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
      1,
      { botLevel: 2 },
    ) as GameState<TrickData>;
    expect(ddCard(trickGame(hearts.config), s, 0)).toBeNull();
  });
});

describe('Hard Spades bots bid from deals solved double dummy', () => {
  const spades = GAMES['spades'] as GameModule<TrickData>;
  const tg = trickGame(spades.config);
  const table = () => {
    const s = spades.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
      1,
      { botLevel: 2 },
    ) as GameState<TrickData>;
    expect(s.phase).toBe('bid');
    return s;
  };
  const give = (s: GameState<TrickData>, seat: number, cards: string) => {
    // (the other hands keep whatever's left: the bid deals them afresh anyway)
    const mine = cards.split(' ');
    const rest = tg.deckCards.filter((c) => !mine.includes(c));
    for (let i = 0, k = 0; i < 4; i++) s.zones[`hand:${i}`].cards = (i === seat ? mine : rest.slice(k, (k += 13))).map((id) => ({ id }));
  };
  // (each bid from the same few deals, so two bids differ only by what the test changed: four
  // random deals each made a bid move by one now and then on its own)
  const bid = (s: GameState<TrickData>, seat: number) => {
    const dice = { rng: seedState(11) };
    return ddBid(
      tg,
      s,
      seat,
      (c) => quickTricks(c, 'S'),
      () => nextRandom(dice),
    )!;
  };

  it('bids a strong hand high and a weak one low (never nil by mistake)', () => {
    const s = table();
    const seat = s.turn!;
    give(s, seat, 'AS KS QS JS TS 9S AH KH AD KD AC 2C 3C');
    expect(bid(s, seat)).toBeGreaterThanOrEqual(8);
    give(s, seat, '2S 3H 4H 5H 2D 3D 4D 5D 2C 3C 4C 5C 6C');
    expect(bid(s, seat)).toBe(1);
  });

  it('with partner in, bids the rest of what the side should take', () => {
    const s = table();
    const seat = s.turn!;
    give(s, seat, 'AS KS 4S AH KH 5H 2D 3D 4D 2C 3C 4C 5C');
    const alone = bid(s, seat);
    s.data.bids[(seat + 2) % 4] = 6;
    expect(bid(s, seat)).toBeLessThan(alone + 1);
    s.data.bids[(seat + 2) % 4] = 1;
    expect(bid(s, seat)).toBeGreaterThanOrEqual(alone);
  });
});

describe('Spades: Hard plays for the score, not the most tricks', () => {
  it('a trick past the bid is a bag (−9 net: ten lose 100), short of the bid is a set', () => {
    const spades = GAMES.spades as GameModule<TrickData>;
    const tg = trickGame(spades.config);
    const s = spades.setup(
      Array.from({ length: 4 }, (_, i) => ({ name: `B${i}`, bot: true })),
      1,
      {},
    );
    // our side (0 and 2) bid 6 and has 4; theirs bid 5 and has 4; 5 tricks left
    Object.assign(s.data, { bids: [3, 2, 3, 3], tricks: [2, 2, 2, 2] });
    for (let i = 0; i < 4; i++) s.zones[`hand:${i}`].cards = s.zones[`hand:${i}`].cards.slice(0, 5);
    const worth = bagWorth(tg, s, 0)!;
    // two more: we make 60 exactly; they take three, two over their bid: 50 less two bags
    expect(worth(2)).toBe(60 - (50 + 2 * -9));
    // a third: a bag for us, one fewer for them, so worse than two (28 against 10)
    expect(worth(3)).toBe(60 - 9 - (50 - 9));
    expect(worth(3)).toBeLessThan(worth(2));
    // four: two bags for us, and they make their bid exactly
    expect(worth(4)).toBe(60 - 18 - 50);
    // one: we're set
    expect(worth(1)).toBe(-60 - (50 + 3 * -9));
    expect(bagWorth(trickGame(g.config), s, 0)).toBeNull();
  });
});
