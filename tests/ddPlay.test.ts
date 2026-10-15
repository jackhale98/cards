import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TrickData } from '../src/engine/families/trick';
import { ddTable, loadDds, solveCards } from '../src/engine/bots/dds';
import { ddCard } from '../src/engine/families/trick/ddPlay';
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

  it('pass on to the usual search when the table isn’t bridge', () => {
    const hearts = GAMES['hearts'] as GameModule<TrickData>;
    const s = hearts.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
      1,
      { botLevel: 2 },
    ) as GameState<TrickData>;
    expect(ddCard(trickGame(hearts.config), s, 0)).toBeNull();
  });
});
