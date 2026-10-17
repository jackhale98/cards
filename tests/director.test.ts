import { afterEach, describe, expect, it, vi } from 'vitest';
import { addEntrant, createEvent, standings, winners, type EventConfig, type EventState, type TableRound } from '../src/engine/events';
import { Director, type DirectorSnapshot } from '../src/net/director';
import { LocalTable } from '../src/net/director/tables';
import type { HostSnapshot } from '../src/net/host';
import { GAMES } from './games';

/**
 * A tournament run on one device, every table hosted here and every seat a bot: the director seats
 * each round, hears the results, and moves on. Stepped (Host.step: Easy bots), so the same each time.
 */

function botEvent(game: string, seats: number, entrants: number, more: Partial<EventConfig> = {}, seed = 1): EventState {
  const sides = GAMES[game].sides?.(seats) ?? Array.from({ length: seats }, (_, i) => [i]);
  const e = createEvent({ name: 'Bots', format: 'swiss', game: { id: game, options: { target: 25 } }, seats, sides, host: 'director', ...more }, seed);
  for (let i = 0; i < entrants; i++) addEntrant(e, { id: `b${i}`, name: `Bot ${i}`, members: [], bot: true });
  return e;
}

const makeTable = (round: number, t: TableRound, restore?: HostSnapshot) => new LocalTable(round, t.table, { code: `R${round}T${t.table}`, restore });

function director(event: EventState, restore?: DirectorSnapshot) {
  return new Director({ event, code: 'BCDFGH', makeTable, keyFor: (m) => `key-${m}`, pause: null, restore });
}

/** Step the whole event (or `limit` steps). */
function run(d: Director, limit = 200_000) {
  let n = 0;
  while (n < limit && d.step()) n++;
  return n;
}

describe('a tournament on one device', () => {
  afterEach(() => vi.useRealTimers());

  it('a Swiss of Gin: three rounds, every table’s result in, one standings', () => {
    const e = botEvent('gin-rummy', 2, 6, { rounds: 3 });
    const d = director(e);
    expect(d.start()).toBe(true);
    run(d);
    expect(e.phase).toBe('done');
    expect(e.rounds).toHaveLength(3);
    for (const r of e.rounds) for (const t of r.tables) expect(t.result).toBeDefined();
    const rows = standings(e);
    expect(rows.reduce((s, r) => s + r.points, 0)).toBe(9);
    expect(winners(e).length).toBeGreaterThan(0);
    expect(d.view.phase).toBe('done');
    d.close();
  });

  it('a Swiss of Crazy Eights, four a table, bots filling a gap', () => {
    const e = botEvent('crazy-eights', 4, 7, { rounds: 2 });
    const d = director(e);
    d.start();
    expect(e.rounds[0].tables.map((t) => t.seats.filter((s) => s.entrant).length).sort()).toEqual([3, 4]);
    run(d);
    expect(e.phase).toBe('done');
    expect(standings(e)).toHaveLength(7);
    d.close();
  });

  it('a knockout of Euchre partnerships', () => {
    const e = botEvent('euchre', 4, 4, { format: 'knockout', game: { id: 'euchre', options: {} } });
    expect(e.config.sides).toEqual([
      [0, 2],
      [1, 3],
    ]);
    const d = director(e);
    d.start();
    run(d);
    expect(e.phase).toBe('done');
    expect(winners(e)).toHaveLength(1);
    d.close();
  }, 30_000);

  it('back after a reload in the middle of a round, its tables carry on where they were', () => {
    const e = botEvent('gin-rummy', 2, 4, { rounds: 2 }, 5);
    const b = director(e);
    b.start();
    run(b, 40);
    expect(e.phase).toBe('playing');
    const snap = structuredClone(b.snapshot());
    const games = Object.values(snap.tables).map((t) => t.state);
    expect(games).toHaveLength(2);
    b.close();
    const c = director(snap.event, snap);
    // (the same games, move for move, on the same tables)
    for (const t of [1, 2]) expect(JSON.stringify(c.link(t)!.snapshot()!.state!.zones)).toBe(JSON.stringify(snap.tables[t].state!.zones));
    expect(c.event.rounds[0]).toEqual(snap.event.rounds[0]);
    run(c);
    expect(c.event.phase).toBe('done');
    expect(c.event.rounds).toHaveLength(2);
    c.close();
  });

  it('between rounds it pauses for the standings, then goes on by itself, unless held', () => {
    vi.useFakeTimers();
    const e = botEvent('gin-rummy', 2, 4, { rounds: 2 });
    const d = new Director({ event: e, code: 'BCDFGH', makeTable, keyFor: (m) => m, pause: 5000 });
    d.start();
    while (e.phase === 'playing') d.step();
    expect(e.phase).toBe('between');
    d.hold(true);
    vi.advanceTimersByTime(10_000);
    expect(e.phase).toBe('between');
    d.hold(false);
    vi.advanceTimersByTime(5000);
    expect(e.phase).toBe('playing');
    expect(e.rounds).toHaveLength(2);
    d.close();
  });
});
