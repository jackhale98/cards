import { afterEach, describe, expect, it, vi } from 'vitest';
import { addEntrant, createEvent, standings, type EventState, type TableRound } from '../src/engine/events';
import { Director, type DirectorSnapshot } from '../src/net/director';
import { LocalTable } from '../src/net/director/tables';
import type { HostSnapshot } from '../src/net/host';
import './games';

/**
 * Multi-table poker run on one device, every seat a bot (stepped): tables held at the end of a
 * hand and re-seated as players go out, the blinds going up on the clock, down to one winner.
 */

function botEvent(n: number, seats: number, seed = 1): EventState {
  const e = createEvent(
    {
      name: 'Poker',
      format: 'mtt',
      game: { id: 'holdem', options: { stack: 200, bigBlind: 20 } },
      seats,
      sides: Array.from({ length: seats }, (_, i) => [i]),
      host: 'director',
      minutes: 10,
    },
    seed,
  );
  for (let i = 0; i < n; i++) addEntrant(e, { id: `b${i}`, name: `Bot ${i}`, members: [], bot: true });
  return e;
}

const made: number[] = [];
const makeTable = (round: number, t: TableRound, { restore }: { restore?: HostSnapshot } = {}) => {
  made.push(t.table);
  return new LocalTable(round, t.table, { code: `R${round}T${t.table}`, restore });
};

function director(event: EventState, restore?: DirectorSnapshot) {
  const d = new Director({ event, code: 'BCDFGH', makeTable, keyFor: (m) => `key-${m}`, pause: null, restore });
  d.resume();
  return d;
}

describe('multi-table poker on one device', () => {
  afterEach(() => vi.useRealTimers());

  it('eighteen bots at three tables: re-seated as they go out, the blinds going up, down to one winner', () => {
    vi.useFakeTimers();
    const e = botEvent(18, 6);
    const d = director(e);
    expect(d.start()).toBe(true);
    expect(e.rounds[0].tables.map((t) => t.seats.length)).toEqual([6, 6, 6]);
    let steps = 0;
    while (e.phase === 'playing' && steps < 200_000) {
      if (!d.step()) break;
      // (the clock: up a level every few hundred moves)
      if (++steps % 400 === 0) d.clockOn(10 * 60_000);
      // never more at a table than it seats, and everyone still in at exactly one table
      const r = e.rounds.at(-1)!;
      const live = Object.keys(e.mtt!.chips).filter((id) => e.mtt!.chips[id] > 0);
      const seated = r.tables.flatMap((t) => t.seats.map((s) => s.entrant!)).filter((id) => e.mtt!.chips[id] > 0);
      expect(seated.sort()).toEqual(live.sort());
    }
    expect(e.phase).toBe('done');
    expect(e.mtt!.level).toBeGreaterThan(0);
    // re-seated along the way, down to the final table
    expect(e.rounds.length).toBeGreaterThan(2);
    const rows = standings(e);
    expect(rows.map((x) => x.rank)).toEqual(rows.map((_, i) => i + 1));
    expect(rows[0].points).toBe(18 * 200);
    expect(d.view.mtt).toMatchObject({ left: 1, of: 18 });
    d.close();
  }, 120_000);
});
