import { describe, expect, it } from 'vitest';
import { addEntrant, createEvent, formatsFor, publicView, standings, startEvent, type EventConfig, type EventState } from '../src/engine/events';
import { blindsAt, mttHand, mttPlan, mttReseat, mttTick } from '../src/engine/events/mtt';
import { nextRandom, seedState } from '../src/engine/rng';
import { getGame } from '../src/games';

/**
 * Multi-table poker (src/engine/events/mtt.ts): the draw, everyone's chips as tables report their
 * hands, the order players are knocked out in, the tables kept even and broken up down to the
 * final table, and the blind clock.
 */

const config = (seats: number, more: Partial<EventConfig> = {}): EventConfig => ({
  name: 'Poker night',
  format: 'mtt',
  game: { id: 'holdem', options: { stack: 1000, bigBlind: 10 } },
  seats,
  sides: Array.from({ length: seats }, (_, i) => [i]),
  host: 'director',
  minutes: 10,
  ...more,
});

function event(seats: number, n: number, seed = 1): EventState {
  const e = createEvent(config(seats), seed);
  for (let i = 0; i < n; i++) expect(addEntrant(e, { id: `e${i}`, name: `E${i}`, members: [`p${i}`] })).toBeNull();
  startEvent(e, 0);
  return e;
}

const r = (e: EventState) => e.rounds.at(-1)!;
const sizes = (e: EventState) => r(e).tables.map((t) => t.seats.filter((s) => e.mtt!.chips[s.entrant!] > 0).length);

/** A hand at a table: the stacks after it (by seat), and before. */
function hand(e: EventState, table: number, after: (chips: number[]) => number[]) {
  const t = r(e).tables.find((x) => x.table === table)!;
  const before = t.seats.map((s) => e.mtt!.chips[s.entrant!]);
  return mttHand(e, r(e).n, table, { stacks: after(before), before, button: 0, hand: 1 });
}
/** Knock out these seats at a table: their chips to the first player left there. */
const knockOut = (e: EventState, table: number, seats: number[]) =>
  hand(e, table, (c) => {
    const next = [...c];
    const to = c.findIndex((_, i) => !seats.includes(i) && c[i] > 0);
    for (const i of seats) {
      next[to] += next[i];
      next[i] = 0;
    }
    return next;
  });

describe('multi-table poker', () => {
  it('is a format for flop poker games', () => {
    expect(formatsFor(getGame('holdem').config, config(6).sides)).toEqual(['mtt', 'swiss', 'knockout']);
    expect(formatsFor(getGame('omaha').config, config(6).sides)[0]).toBe('mtt');
  });

  it('the draw: tables as even as they can be, everyone’s chips, the first blinds', () => {
    const e = event(6, 20);
    expect(r(e).tables.map((t) => t.seats.length)).toEqual([5, 5, 5, 5]);
    const seated = r(e).tables.flatMap((t) => t.seats.map((s) => s.entrant));
    expect(new Set(seated).size).toBe(20);
    for (const t of r(e).tables) {
      expect(t.setup).toMatchObject({ chips: [1000, 1000, 1000, 1000, 1000], blinds: { sb: 5, bb: 10 } });
      expect(t.setup!.button).toBeGreaterThanOrEqual(0);
      expect(t.setup!.button).toBeLessThan(5);
      // (each seat is its entrant's one member)
      expect(t.seats.every((s) => s.member === `p${s.entrant!.slice(1)}`)).toBe(true);
    }
  });

  it('the blinds go up the ladder, with an ante from the fourth level', () => {
    const e = event(6, 6);
    expect([0, 1, 2, 3, 4, 7].map((l) => blindsAt(e, l))).toEqual([
      { sb: 5, bb: 10 },
      { sb: 10, bb: 20 },
      { sb: 15, bb: 30 },
      { sb: 20, bb: 40, ante: 4 },
      { sb: 30, bb: 60, ante: 6 },
      { sb: 75, bb: 150, ante: 15 },
    ]);
    // the clock: ten minutes a level
    expect(mttTick(e, 9 * 60_000)).toBe(false);
    expect(mttTick(e, 21 * 60_000)).toBe(true);
    expect(e.mtt!.level).toBe(2);
    expect(publicView(e).mtt).toMatchObject({
      level: 2,
      blinds: { sb: 15, bb: 30 },
      next: { sb: 20, bb: 40, ante: 4 },
      levelEnds: 30 * 60_000,
      left: 6,
      of: 6,
    });
  });

  it('knocked out in the same hand: the one who started it with more finishes higher', () => {
    const e = event(6, 6);
    const t = r(e).tables[0];
    const ids = t.seats.map((s) => s.entrant!);
    // seat 1 started the hand with 300, seat 2 with 1700: both lose everything to seat 0
    const out = mttHand(e, 1, 1, { stacks: [3000, 0, 0, 1000, 1000, 1000], before: [1000, 300, 1700, 1000, 1000, 1000], button: 0, hand: 4 });
    expect(out).toEqual([ids[1], ids[2]]);
    const rows = standings(e);
    expect(rows[0]).toMatchObject({ entrant: ids[0], points: 3000, rank: 1, alive: true });
    expect(rows.slice(-2).map((x) => [x.entrant, x.rank, x.alive])).toEqual([
      [ids[2], 5, false],
      [ids[1], 6, false],
    ]);
  });

  it('tables differing by two are evened: a player moves from the biggest to the smallest; the others carry on', () => {
    const e = event(9, 27);
    expect(sizes(e)).toEqual([9, 9, 9]);
    knockOut(e, 2, [3]);
    expect(mttPlan(e)).toBeNull();
    knockOut(e, 2, [5]);
    expect(sizes(e)).toEqual([9, 7, 9]);
    const plan = mttPlan(e)!;
    expect(plan).toEqual([1, 2]);
    const before = structuredClone(r(e).tables[2]);
    const round = mttReseat(e, plan);
    expect(round.n).toBe(2);
    expect(sizes(e)).toEqual([8, 8, 9]);
    // table 3 carries on as it was; tables 1 and 2 are dealt afresh, everyone with their chips
    expect(round.tables[2]).toMatchObject({ table: 3, carried: 1, seats: before.seats });
    for (const t of round.tables.slice(0, 2)) {
      expect(t.carried).toBeUndefined();
      expect(t.setup!.chips).toEqual(t.seats.map((s) => e.mtt!.chips[s.entrant!]));
      expect(t.seats.every((s) => e.mtt!.chips[s.entrant!] > 0)).toBe(true);
    }
    expect(mttPlan(e)).toBeNull();
  });

  it('a table breaks up as soon as everyone left fits at fewer, down to the final table', () => {
    const e = event(6, 18);
    expect(sizes(e)).toEqual([6, 6, 6]);
    knockOut(e, 1, [1, 2, 3]);
    knockOut(e, 2, [1, 2]);
    knockOut(e, 3, [4]);
    expect(sizes(e)).toEqual([3, 4, 5]);
    // twelve left: two tables of six
    const round = mttReseat(e, mttPlan(e)!);
    expect(round.tables.map((t) => t.table)).toEqual([2, 3]);
    expect(sizes(e)).toEqual([6, 6]);
    knockOut(e, 2, [0, 1, 2]);
    knockOut(e, 3, [0, 1, 2]);
    // six left: the final table
    mttReseat(e, mttPlan(e)!);
    expect(r(e).tables).toHaveLength(1);
    expect(sizes(e)).toEqual([6]);
    expect(mttPlan(e)).toBeNull();
    knockOut(e, r(e).tables[0].table, [1, 2, 3, 4, 5]);
    expect(e.phase).toBe('done');
    expect(standings(e)[0].rank).toBe(1);
  });

  it('played out at random: chips are kept, everyone still in has one seat, and tables are kept even', () => {
    for (const [seats, n, seed] of [
      [9, 30, 1],
      [6, 23, 2],
      [8, 50, 3],
    ]) {
      const e = event(seats, n, seed);
      const dice = { rng: seedState(seed * 7) };
      const total = n * 1000;
      for (let i = 0; i < 5000 && e.phase === 'playing'; i++) {
        const tables = r(e).tables;
        const t = tables[Math.floor(nextRandom(dice) * tables.length)];
        // two players in: one wins some (or all) of the other's chips
        hand(e, t.table, (c) => {
          const live = c.map((x, j) => (x > 0 ? j : -1)).filter((j) => j >= 0);
          const [a, b] = [live[Math.floor(nextRandom(dice) * live.length)], live[Math.floor(nextRandom(dice) * live.length)]];
          const next = [...c];
          if (a === b || a == null || b == null) return next;
          const won = nextRandom(dice) < 0.3 ? next[b] : Math.ceil(next[b] * nextRandom(dice));
          next[a] += won;
          next[b] -= won;
          return next;
        });
        // (the tables to change are held at their hand's end, and others play on meanwhile: the
        // plan can be a hand or two old by the time it's carried out)
        for (let k = 0; k < 10; k++) {
          const plan = mttPlan(e);
          if (!plan) break;
          if (nextRandom(dice) < 0.5) {
            const others = r(e).tables.filter((x) => !plan.includes(x.table));
            const t = others[Math.floor(nextRandom(dice) * others.length)];
            if (t)
              knockOut(
                e,
                t.table,
                t.seats.map((_, j) => j).filter((j) => j > 0 && nextRandom(dice) < 0.3 && e.mtt!.chips[t.seats[j].entrant!] > 0),
              );
          }
          if (e.phase !== 'playing') break;
          mttReseat(e, plan);
        }
        const chips = e.mtt!.chips;
        expect(Object.values(chips).reduce((s, x) => s + x, 0)).toBe(total);
        if (e.phase !== 'playing') break;
        const live = Object.keys(chips).filter((id) => chips[id] > 0);
        const seated = r(e).tables.flatMap((x) => x.seats.map((s) => s.entrant!).filter((id) => chips[id] > 0));
        expect(seated.sort()).toEqual(live.sort());
        expect(r(e).tables.every((x) => x.seats.length <= seats)).toBe(true);
        const sz = sizes(e);
        expect(Math.max(...sz) - Math.min(...sz)).toBeLessThan(2);
        expect(sz.length).toBe(Math.ceil(live.length / seats));
      }
      expect(e.phase).toBe('done');
      const rows = standings(e);
      expect(rows.map((x) => x.rank)).toEqual(rows.map((_, i) => i + 1));
      expect(e.mtt!.out).toHaveLength(n - 1);
    }
  });
});
