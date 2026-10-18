import { describe, expect, it } from 'vitest';
import { addEntrant, createEvent, standings, winners, type EventConfig, type EventState, type TableRound } from '../src/engine/events';
import { released, roundBoards } from '../src/engine/events/duplicate';
import { Director, type DirectorSnapshot } from '../src/net/director';
import { LocalTable } from '../src/net/director/tables';
import type { OtherResult } from '../src/engine/types';
import type { HostSnapshot } from '../src/net/host';
import { GAMES } from './games';

/**
 * Duplicate bridge tournaments run on one device, every seat a bot (stepped: the same each time):
 * pairs matchpointed across the room, teams whose two tables hear each other's results as they go,
 * and nothing of a board on the screens until every table has played it.
 */

function botEvent(format: 'pairs' | 'teams', entrants: number, more: Partial<EventConfig> = {}, seed = 1): EventState {
  const e = createEvent(
    {
      name: 'Club',
      format,
      game: { id: 'bridge', options: { ...GAMES.bridge.duplicate } },
      seats: 4,
      sides: GAMES.bridge.sides!(4)!,
      host: 'director',
      boards: 2,
      rounds: 1,
      ...more,
    },
    seed,
  );
  for (let i = 0; i < entrants; i++) addEntrant(e, { id: `b${i}`, name: `Bots ${i}`, members: [], bot: true });
  return e;
}

const makeTable = (round: number, t: TableRound, { restore }: { restore?: HostSnapshot } = {}) =>
  new LocalTable(round, t.table, { code: `R${round}T${t.table}`, restore });

function director(event: EventState, restore?: DirectorSnapshot) {
  const d = new Director({ event, code: 'BCDFGH', makeTable, keyFor: (m) => `key-${m}`, pause: null, restore });
  d.resume();
  return d;
}

/** Step the event (or `limit` steps), checking at every step that no board shows before every table has played it. */
function run(d: Director, limit = 200_000) {
  let n = 0;
  while (n < limit && d.step()) {
    n++;
    const r = d.event.rounds.at(-1)!;
    const shown = new Set(released(r));
    const view = JSON.stringify(d.view);
    for (const b of r.tables[0].setup!.boards!) if (!shown.has(b.n)) expect(view).not.toContain(JSON.stringify(b.hands[0]));
  }
  return n;
}

describe('a duplicate tournament on one device', () => {
  it('pairs: every table plays the round’s boards, each board matchpointed across the room', () => {
    const e = botEvent('pairs', 4, { rounds: 2 });
    const d = director(e);
    expect(d.start()).toBe(true);
    run(d);
    expect(e.phase).toBe('done');
    expect(e.rounds).toHaveLength(2);
    for (const r of e.rounds) {
      expect(roundBoards(r)).toHaveLength(2);
      for (const t of r.tables) expect(t.report?.boards?.map((b) => b.n)).toEqual(roundBoards(r));
    }
    // (everyone played every board: the percentages average fifty)
    const rows = standings(e);
    expect(rows.reduce((s, r) => s + r.points, 0)).toBeCloseTo(200, 0);
    expect(rows.every((r) => r.played === 2)).toBe(true);
    expect(winners(e).length).toBeGreaterThan(0);
    expect(d.view.travellers!.map((t) => t.n)).toEqual([3, 4]);
    d.close();
  }, 60_000);

  it('teams: a match’s two tables hear each other’s results, and the match is won on IMPs', () => {
    const e = botEvent('teams', 2);
    const d = director(e);
    d.start();
    const [t1, t2] = e.rounds[0].tables;
    expect([t1.match, t2.match]).toEqual([1, 1]);
    while (e.phase === 'playing') run(d, 1);
    expect(e.phase).toBe('between');
    const rows = standings(e);
    expect(rows[0].score! + rows[1].score!).toBe(0);
    expect(rows.map((r) => r.points).sort()).toEqual(rows[0].score ? [0, 1] : [0.5, 0.5]);
    // each table saw the other's result beside its own, board by board
    for (const [t, other] of [
      [t1, t2],
      [t2, t1],
    ]) {
      const others = (d.snapshot().tables[t.table].state!.data as { others: OtherResult[] }).others;
      expect(others.map((o) => [o.n, o.at, o.ns])).toEqual(other.report!.boards!.map((b) => [b.n, `Table ${other.table}`, b.ns]));
    }
    run(d);
    expect(e.phase).toBe('done');
    d.close();
  }, 60_000);

  it('teams: the director back after a reload mid-match, the tables still hear each other', () => {
    const e = botEvent('teams', 2, {}, 3);
    const a = director(e);
    a.start();
    // (table 1 plays its first board; table 2 hasn't started)
    while (!e.rounds[0].tables[0].report?.boards?.length) a.step();
    const snap = structuredClone(a.snapshot());
    a.close();
    const b = director(snap.event, snap);
    run(b);
    expect(b.event.phase).toBe('done');
    for (const t of b.event.rounds[0].tables) expect(t.result).toBeDefined();
    b.close();
  }, 60_000);
});
