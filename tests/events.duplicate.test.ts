import { describe, expect, it } from 'vitest';
import {
  addEntrant,
  createEvent,
  formatsFor,
  nextRound,
  publicView,
  personalView,
  recordReport,
  recordResult,
  showable,
  standings,
  startEvent,
  startProblem,
  type EventConfig,
  type EventState,
  type TableRound,
} from '../src/engine/events';
import { imps } from '../src/engine/lib/duplicate';
import { getGame } from '../src/games';
import type { BoardResult } from '../src/engine/types';

/**
 * Duplicate bridge tournaments (src/engine/events/duplicate.ts): every table of a round plays the
 * same boards; pairs are matchpointed against everyone sitting their way, teams net their two
 * tables' results in IMPs; nothing of a board shows until every table has played it.
 */

const config = (format: 'pairs' | 'teams', more: Partial<EventConfig> = {}): EventConfig => ({
  name: 'Club night',
  format,
  game: { id: 'bridge', options: { style: 2 } },
  seats: 4,
  sides: [
    [0, 2],
    [1, 3],
  ],
  host: 'director',
  ...more,
});

function event(cfg: EventConfig, n: number, seed = 1): EventState {
  const e = createEvent(cfg, seed);
  const per = cfg.format === 'teams' ? 4 : 2;
  for (let i = 0; i < n; i++) expect(addEntrant(e, { id: `e${i}`, name: `E${i}`, members: Array.from({ length: per }, (_, j) => `p${i}.${j}`) })).toBeNull();
  return e;
}

const result = (n: number, ns: number): BoardResult => ({ n, contract: ns ? '4S' : null, declarer: ns ? 0 : null, tricks: ns ? 10 : null, ns });

/** A table plays its boards: North–South scoring `ns(board, table)` on each, then the game is over. */
function play(e: EventState, t: TableRound, ns: (n: number, t: TableRound) => number, upTo = Infinity) {
  const r = e.rounds.at(-1)!;
  const boards: BoardResult[] = [];
  for (const b of t.setup!.boards!) {
    if (boards.length >= upTo) return false;
    boards.push(result(b.n, ns(b.n, t)));
    recordReport(e, r.n, t.table, { boards: [...boards] });
  }
  return recordResult(e, r.n, t.table, { places: [0, 1, 0, 1] }, { boards });
}

const entrantsAt = (t: TableRound) => [...new Set(t.seats.map((s) => s.entrant))];

describe('duplicate pairs', () => {
  it('every table of a round plays the same boards, numbered on from round to round', () => {
    const e = event(config('pairs', { rounds: 3, boards: 3 }), 6);
    startEvent(e);
    const seen: number[] = [];
    for (let round = 1; round <= 3; round++) {
      const r = e.rounds.at(-1)!;
      expect(r.tables).toHaveLength(3);
      const boards = r.tables.map((t) => JSON.stringify(t.setup!.boards));
      expect(new Set(boards).size).toBe(1);
      const b = r.tables[0].setup!.boards!;
      expect(b.map((x) => x.n)).toEqual([1, 2, 3].map((k) => (round - 1) * 3 + k));
      for (const x of b) expect(x.hands.flat().sort()).toHaveLength(52);
      seen.push(...b.map((x) => x.n));
      for (const t of r.tables) play(e, t, () => 0);
      nextRound(e);
    }
    expect(e.phase).toBe('done');
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('pairs meet someone new each round, and take turns sitting North–South', () => {
    const e = event(config('pairs', { rounds: 5, boards: 2 }), 6, 3);
    startEvent(e);
    const met = new Set<string>();
    while (e.phase !== 'done') {
      for (const t of e.rounds.at(-1)!.tables) {
        const key = entrantsAt(t).sort().join('-');
        expect(met.has(key)).toBe(false);
        met.add(key);
        // (partners sit opposite: a pair's two members at North and South, or East and West)
        expect(t.seats[0].entrant).toBe(t.seats[2].entrant);
        expect(t.seats[1].entrant).toBe(t.seats[3].entrant);
        play(e, t, (n) => (n % 2 ? 420 : -50));
      }
      nextRound(e);
    }
    const ns = new Map<string, number>();
    for (const r of e.rounds) for (const t of r.tables) ns.set(t.seats[0].entrant!, (ns.get(t.seats[0].entrant!) ?? 0) + 1);
    // (five rounds: each pair North–South two or three times)
    for (const x of e.entrants) expect([2, 3]).toContain(ns.get(x.id) ?? 0);
  });

  it('matchpoints: two for each pair beaten sitting your way, one for each tied, as a percentage', () => {
    const e = event(config('pairs', { rounds: 1, boards: 2 }), 6);
    startEvent(e);
    const [t1, t2, t3] = e.rounds[0].tables;
    // board 1: North–South score 420, 420, 170; board 2: −50, 100, 100
    const scores: Record<number, number[]> = { 1: [420, 420, 170], 2: [-50, 100, 100] };
    for (const [i, t] of [t1, t2, t3].entries()) play(e, t, (n) => scores[n][i]);
    const rows = new Map(standings(e).map((r) => [r.entrant, r]));
    // top 4 a board: t1 North–South 3 + 0, t2 3 + 3, t3 0 + 3; East–West the rest
    const ns = (t: TableRound) => rows.get(t.seats[0].entrant!)!;
    const ew = (t: TableRound) => rows.get(t.seats[1].entrant!)!;
    expect([ns(t1), ns(t2), ns(t3)].map((r) => r.score)).toEqual([3, 6, 3]);
    expect([ew(t1), ew(t2), ew(t3)].map((r) => r.score)).toEqual([5, 2, 5]);
    expect(ns(t2).points).toBe(75);
    expect(ew(t2).points).toBe(25);
    expect(standings(e)[0].entrant).toBe(t2.seats[0].entrant);
    // (equal percentages share a rank)
    expect(ew(t1).rank).toBe(ew(t3).rank);
  });

  it('a board counts, and shows, only once every table has played it', () => {
    const e = event(config('pairs', { rounds: 1, boards: 3 }), 4);
    startEvent(e);
    const r = e.rounds[0];
    const [t1, t2] = r.tables;
    const [b1, b2, b3] = t1.setup!.boards!;
    play(e, t1, () => 420);
    play(e, t2, () => 170, 1);
    let v = publicView(e);
    // board 1 is done everywhere: its traveller, with the hands; boards 2 and 3, nothing of them
    expect(v.travellers!.map((t) => t.n)).toEqual([b1.n]);
    expect(v.travellers![0].hands).toEqual(b1.hands);
    expect(v.travellers![0].rows.map((x) => [x.table, x.score, x.mp])).toEqual([
      [1, 420, 2],
      [2, 170, 0],
    ]);
    const text = JSON.stringify(v);
    for (const b of [b2, b3]) expect(text).not.toContain(JSON.stringify(b.hands[0]));
    expect(text).not.toContain('"seed"');
    expect(standings(e).map((x) => x.score)).toEqual([2, 2, 0, 0]);
    expect(v.tables.map((t) => [t.done ?? false, t.board ?? null, t.places ?? null])).toEqual([
      [true, null, null],
      [false, b2.n, null],
    ]);
    // a table may be shown live only on a board every other table has played
    expect(showable(e, 2)).toBe(true);
    const e2 = event(config('pairs', { rounds: 1, boards: 3 }), 4);
    startEvent(e2);
    // (table 2 has played board 1 and is on board 2; table 1, still on board 1)
    play(e2, e2.rounds[0].tables[1], () => 0, 1);
    expect(showable(e2, 1)).toBe(true);
    expect(showable(e2, 2)).toBe(false);
    play(e2, e2.rounds[0].tables[0], () => 0, 1);
    expect([showable(e2, 1), showable(e2, 2)]).toEqual([false, false]);
    v = publicView(e);
    expect(v.units).toEqual({ points: '%', score: 'MPs' });
    expect(v.boards).toBe(3);
  });

  it('a table that ends early leaves the boards it didn’t play to the others', () => {
    const e = event(config('pairs', { rounds: 1, boards: 2 }), 6);
    startEvent(e);
    const [t1, t2, t3] = e.rounds[0].tables;
    play(e, t1, () => 100);
    play(e, t2, () => 200);
    // table 3 ended after one board
    recordReport(e, 1, t3.table, { boards: [result(t3.setup!.boards![0].n, 300)] });
    recordResult(e, 1, t3.table, { places: [0, 1, 0, 1] }, { boards: [result(t3.setup!.boards![0].n, 300)] });
    const v = publicView(e);
    expect(v.travellers!.map((t) => t.rows.length)).toEqual([3, 2]);
    expect(v.travellers![1].top).toBe(2);
  });

  it('starts with two tables to compare at least', () => {
    const e = event(config('pairs'), 3);
    expect(startProblem(e)).toMatch(/four pairs/);
    addEntrant(e, { id: 'x', name: 'X', members: ['x1', 'x2'] });
    expect(startProblem(e)).toBeNull();
  });
});

describe('duplicate teams', () => {
  it('a match is two tables: each team’s pairs sit North–South at one and East–West at the other', () => {
    const e = event(config('teams', { rounds: 1, boards: 4 }), 2);
    startEvent(e);
    const r = e.rounds[0];
    expect(r.tables.map((t) => [t.table, t.match])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    const [t1, t2] = r.tables;
    expect(t1.setup).toMatchObject({ compared: true });
    expect(JSON.stringify(t1.setup)).toBe(JSON.stringify(t2.setup));
    const a = e.entrants.find((x) => x.id === t1.seats[0].entrant)!;
    const b = e.entrants.find((x) => x.id === t1.seats[1].entrant)!;
    expect(t1.seats.map((s) => s.member)).toEqual([a.members[0], b.members[2], a.members[1], b.members[3]]);
    expect(t2.seats.map((s) => s.member)).toEqual([b.members[0], a.members[2], b.members[1], a.members[3]]);
    // each player knows their own table
    expect(personalView(e, a.members[3])).toMatchObject({ table: 2, seat: 3, entrant: a.id });
  });

  it('each board nets the two tables’ results in IMPs; the match is won on IMPs', () => {
    const e = event(config('teams', { rounds: 1, boards: 2 }), 2);
    startEvent(e);
    const [t1, t2] = e.rounds[0].tables;
    // board 1: 4♠ made at one table (+420), one down at the other (−50): 470 to the first table's North–South team
    const ns: Record<number, number[]> = { [t1.setup!.boards![0].n]: [420, -50], [t1.setup!.boards![1].n]: [-100, -140] };
    play(e, t1, (n) => ns[n][0]);
    expect(standings(e).every((x) => x.played === 0)).toBe(true);
    play(e, t2, (n) => ns[n][1]);
    const net = imps(470) + imps(40);
    const rows = new Map(standings(e).map((x) => [x.entrant, x]));
    expect(rows.get(t1.seats[0].entrant!)).toMatchObject({ points: 1, score: net, wins: 1, rank: 1 });
    expect(rows.get(t1.seats[1].entrant!)).toMatchObject({ points: 0, score: -net, rank: 2 });
    const v = publicView(e);
    expect(v.units).toEqual({ points: 'Pts', score: 'IMPs' });
    expect(v.travellers![0].rows.map((x) => x.imps)).toEqual([imps(470), -imps(470)]);
  });

  it('teams sign up four at a time; two teams can start', () => {
    const e = createEvent(config('teams'), 1);
    expect(addEntrant(e, { id: 'a', name: 'A', members: ['a1', 'a2'] })).toMatch(/team of four/);
    expect(addEntrant(e, { id: 'a', name: 'A', members: ['a1', 'a2', 'a3', 'a4'] })).toBeNull();
    expect(startProblem(e)).toMatch(/two/);
    expect(addEntrant(e, { id: 'b', name: 'B', members: [], bot: true })).toBeNull();
    expect(startProblem(e)).toBeNull();
    startEvent(e);
    const [t1, t2] = e.rounds[0].tables;
    // (a team of bots: nobody in its seats)
    const bots = (t: TableRound) => t.seats.filter((s) => s.entrant === 'b').map((s) => s.member);
    expect([...bots(t1), ...bots(t2)]).toEqual([null, null, null, null]);
  });
});

describe('formats for a game', () => {
  it('pairs and teams for a game played duplicate, two partnerships a table', () => {
    const bridge = getGame('bridge').config;
    const sides = [
      [0, 2],
      [1, 3],
    ];
    expect(formatsFor(bridge, sides, true)).toEqual(['swiss', 'roundRobin', 'knockout', 'pairs', 'teams']);
    expect(formatsFor(bridge, sides)).toEqual(['swiss', 'roundRobin', 'knockout']);
  });
});
