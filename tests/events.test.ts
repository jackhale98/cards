import { describe, expect, it } from 'vitest';
import {
  addEntrant,
  createEvent,
  nextRound,
  publicView,
  personalView,
  recordResult,
  standings,
  startEvent,
  tableSizes,
  winners,
  withdraw,
} from '../src/engine/events';
import type { EventConfig, EventState, FormatId } from '../src/engine/events';
import { bracketSeeds } from '../src/engine/events/pairing';
import { sideResults } from '../src/engine/events/standings';
import { seedState, nextRandom } from '../src/engine/rng';

const solo = (n: number) => Array.from({ length: n }, (_, i) => [i]);
const config = (format: FormatId, seats: number, more: Partial<EventConfig> = {}): EventConfig => ({
  name: 'Test',
  format,
  game: { id: 'hearts', options: {} },
  seats,
  sides: solo(seats),
  host: 'player',
  ...more,
});

function event(cfg: EventConfig, n: number, seed = 1): EventState {
  const e = createEvent(cfg, seed);
  const per = cfg.sides[0].length;
  for (let i = 0; i < n; i++) expect(addEntrant(e, { id: `e${i}`, name: `E${i}`, members: Array.from({ length: per }, (_, j) => `p${i}.${j}`) })).toBeNull();
  return e;
}

/** Play the round out: each table's sides finish in a random order (partners share their place). */
function playRound(e: EventState, dice: { rng: number[] }, opts: { ties?: boolean } = {}) {
  const r = e.rounds.at(-1)!;
  let done = false;
  for (const t of r.tables) {
    const sides = e.config.sides;
    const order = sides.map((_, i) => i).sort(() => nextRandom(dice) - 0.5);
    const placeOf = sides.map((_, i) => (opts.ties ? 0 : order.indexOf(i)));
    const places = Array<number>(e.config.seats).fill(0);
    sides.forEach((side, i) => side.forEach((seat) => (places[seat] = placeOf[i])));
    done = recordResult(e, r.n, t.table, { places, scores: places.map((p) => 100 - p * 10) });
  }
  return done;
}

/** Everyone still in is at exactly one table or has a bye, every round. */
function everyoneOnce(e: EventState) {
  for (const r of e.rounds) {
    const seen = [...r.byes, ...r.tables.flatMap((t) => [...new Set(t.seats.map((s) => s.entrant).filter(Boolean))])];
    expect(new Set(seen).size).toBe(seen.length);
  }
}

const pairsMet = (e: EventState) => e.rounds.flatMap((r) => r.tables.map((t) => [...new Set(t.seats.map((s) => s.entrant).filter(Boolean))].sort().join('-')));

describe('standings', () => {
  it('a point for every side you finish ahead of, a half for each you tie with', () => {
    const e = event(config('swiss', 4, { rounds: 1 }), 4);
    startEvent(e);
    const r = e.rounds[0];
    recordResult(e, 1, 1, { places: [0, 0, 2, 3] });
    const pts = sideResults(e, r.tables[0]).map((s) => s.points);
    expect(pts).toEqual([2.5, 2.5, 1, 0]);
    const rows = standings(e);
    expect(rows.map((x) => x.rank)).toEqual([1, 1, 3, 4]);
  });
});

describe('Swiss', () => {
  it('two a table: everyone plays every round, nobody meets the same opponent twice, byes go round', () => {
    for (const n of [7, 8, 12, 13]) {
      const e = event(config('swiss', 2, { rounds: 4 }), n, n);
      const dice = { rng: seedState(n) };
      startEvent(e);
      while (e.phase !== 'done') {
        playRound(e, dice);
        nextRound(e);
      }
      expect(e.rounds).toHaveLength(4);
      everyoneOnce(e);
      const met = pairsMet(e);
      expect(new Set(met).size).toBe(met.length);
      const byes = e.rounds.flatMap((r) => r.byes);
      expect(byes).toHaveLength(n % 2 ? 4 : 0);
      expect(new Set(byes).size).toBe(byes.length);
      // (a bye is worth a win)
      const total = standings(e).reduce((s, r) => s + r.points, 0);
      expect(total).toBe(4 * Math.floor(n / 2) + byes.length);
    }
  });

  it('four a table: tables as even as can be, bots in the gaps, players on similar points together', () => {
    const e = event(config('swiss', 4, { rounds: 3 }), 10);
    const dice = { rng: seedState(3) };
    startEvent(e);
    expect(e.rounds[0].tables.map((t) => t.seats.filter((s) => s.entrant).length).sort()).toEqual([3, 3, 4]);
    while (e.phase !== 'done') {
      playRound(e, dice);
      nextRound(e);
    }
    everyoneOnce(e);
    expect(winners(e).length).toBeGreaterThan(0);
  });

  it('partnerships: each side’s two players sit opposite, and share a place', () => {
    const e = event(
      config('swiss', 4, {
        sides: [
          [0, 2],
          [1, 3],
        ],
        rounds: 2,
      }),
      5,
    );
    startEvent(e);
    const r = e.rounds[0];
    expect(r.tables).toHaveLength(2);
    expect(r.byes).toHaveLength(1);
    for (const t of r.tables) {
      expect(t.seats[0].entrant).toBe(t.seats[2].entrant);
      expect(t.seats[1].entrant).toBe(t.seats[3].entrant);
      const x = e.entrants.find((y) => y.id === t.seats[0].entrant)!;
      expect([t.seats[0].member, t.seats[2].member]).toEqual(x.members);
    }
    // a person can only sign up once, and a partnership as a pair
    expect(
      addEntrant(
        createEvent(
          config('swiss', 4, {
            sides: [
              [0, 2],
              [1, 3],
            ],
          }),
          1,
        ),
        { id: 'x', name: 'X', members: ['a'] },
      ),
    ).toBe('Sign up as a pair');
  });

  it('someone who withdraws isn’t paired again; their results stand', () => {
    const e = event(config('swiss', 2, { rounds: 3 }), 6);
    const dice = { rng: seedState(9) };
    startEvent(e);
    playRound(e, dice);
    withdraw(e, 'e0');
    nextRound(e);
    expect(e.rounds[1].tables.flatMap((t) => t.seats.map((s) => s.entrant))).not.toContain('e0');
    expect(e.rounds[1].byes).toHaveLength(1);
    expect(standings(e).find((r) => r.entrant === 'e0')!.played).toBe(1);
  });

  it('a result that’s late, repeated, or the wrong shape is ignored', () => {
    const e = event(config('swiss', 2, { rounds: 2 }), 4);
    startEvent(e);
    expect(recordResult(e, 2, 1, { places: [0, 1] })).toBe(false);
    expect(recordResult(e, 1, 9, { places: [0, 1] })).toBe(false);
    expect(recordResult(e, 1, 1, { places: [0] })).toBe(false);
    expect(recordResult(e, 1, 1, { places: [0, Number.NaN] })).toBe(false);
    expect(recordResult(e, 1, 1, { places: [0, 1] })).toBe(false);
    expect(recordResult(e, 1, 1, { places: [1, 0] })).toBe(false);
    expect(e.rounds[0].tables[0].result!.places).toEqual([0, 1]);
    expect(recordResult(e, 1, 2, { places: [1, 0] })).toBe(true);
    expect(e.phase).toBe('between');
  });
});

describe('round robin', () => {
  it('everyone plays everyone once; with an odd number each sits out one round', () => {
    for (const n of [5, 6]) {
      const e = event(config('roundRobin', 2), n);
      const dice = { rng: seedState(n) };
      startEvent(e);
      while (e.phase !== 'done') {
        playRound(e, dice);
        nextRound(e);
      }
      expect(e.rounds).toHaveLength(n % 2 ? n : n - 1);
      everyoneOnce(e);
      const met = pairsMet(e);
      expect(met).toHaveLength((n * (n - 1)) / 2);
      expect(new Set(met).size).toBe(met.length);
      const byes = e.rounds.flatMap((r) => r.byes).sort();
      expect(byes).toEqual(n % 2 ? e.entrants.map((x) => x.id).sort() : []);
    }
  });
});

describe('knockout', () => {
  it('the top seeds meet only in the final', () => {
    expect(bracketSeeds(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('two a table: a bracket with byes for the top seeds, halving each round to one winner', () => {
    const e = event(config('knockout', 2), 6);
    const dice = { rng: seedState(4) };
    startEvent(e);
    expect(e.rounds[0].tables).toHaveLength(2);
    expect(e.rounds[0].byes).toHaveLength(2);
    while (e.phase !== 'done') {
      playRound(e, dice);
      nextRound(e);
    }
    expect(e.rounds.map((r) => r.tables.length)).toEqual([2, 2, 1]);
    const champ = winners(e);
    expect(champ).toHaveLength(1);
    expect(e.order).toEqual(champ);
    const view = publicView(e);
    expect(view.bracket!.at(-1)!.tables[0].through).toEqual(champ);
    expect(standings(e)[0].entrant).toBe(champ[0]);
  });

  it('a tie at a table is settled by the game’s score, then by lot', () => {
    const e = event(config('knockout', 2), 4);
    const dice = { rng: seedState(5) };
    startEvent(e);
    playRound(e, dice, { ties: true });
    nextRound(e);
    expect(e.rounds[1].tables).toHaveLength(1);
  });

  it('four a table: the top two of each go through, until one table plays the final', () => {
    const e = event(config('knockout', 4, { advance: 2 }), 10);
    const dice = { rng: seedState(6) };
    startEvent(e);
    while (e.phase !== 'done') {
      playRound(e, dice);
      nextRound(e);
    }
    expect(e.rounds.map((r) => r.tables.length)).toEqual([3, 2, 1]);
    expect(winners(e)).toHaveLength(1);
  });
});

describe('what the screens and phones see', () => {
  it('the round’s tables and the standings, never a table’s deal', () => {
    const e = event(config('swiss', 4, { rounds: 2 }), 8);
    startEvent(e);
    e.rounds[0].tables[0].setup = { chips: [1, 2, 3, 4] };
    const view = publicView(e);
    expect(JSON.stringify(view)).not.toContain('seed');
    expect(JSON.stringify(view)).not.toContain('chips');
    expect(view.tables).toHaveLength(2);
    const t = e.rounds[0].tables[1];
    const me = personalView(e, t.seats[2].member!);
    expect(me).toMatchObject({ table: 2, seat: 2, round: 1, bye: false });
  });

  it('tables are as even as can be', () => {
    expect(tableSizes(10, 4)).toEqual([4, 3, 3]);
    expect(tableSizes(8, 4)).toEqual([4, 4]);
    expect(tableSizes(3, 4)).toEqual([3]);
  });
});
