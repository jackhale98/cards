import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { standings } from '../src/engine/events';
import { LocalTable } from '../src/net/director/tables';
import { director, Net, Phone, settle } from './eventHarness';
import './games';

/**
 * Multi-table poker over the network (in memory), every table hosted on the director's device:
 * phones follow their moves to new tables as the tables are re-seated, and someone knocked out
 * goes back to the event's room to watch.
 */

describe('multi-table poker over the network', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('phones move to their new tables as the tables are re-seated, and leave when they’re out', async () => {
    const net = new Net();
    const { d, desk, registry } = director(net, {
      name: 'Poker',
      format: 'mtt',
      game: { id: 'holdem', options: { stack: 60, bigBlind: 20 } },
      seats: 6,
      sides: Array.from({ length: 6 }, (_, i) => [i]),
      host: 'director',
      minutes: 10,
    });
    const phones = ['Ann', 'Bo', 'Cy', 'Di'].map((n) => new Phone(net, n));
    await settle();
    for (let i = 0; i < 8; i++) registry.addBot();
    expect(desk.start()).toBeNull();
    await settle();
    expect(d.event.rounds[0].tables.map((t) => t.seats.length)).toEqual([6, 6]);
    const chips = () => d.event.mtt!.chips;
    for (let i = 0; i < 400 && d.event.phase === 'playing'; i++) {
      // a few hundred moves at the tables, then the blinds up a level (so it ends)
      for (let k = 0; k < 300; k++) {
        const tables = d.event.rounds
          .at(-1)!
          .tables.map((t) => d.link(t.table))
          .filter((l): l is LocalTable => l instanceof LocalTable);
        if (!tables.some((l) => l.step())) break;
      }
      d.clockOn(10 * 60_000);
      await settle(300);
      // everyone still in is in the room of their table now; anyone out, back at the event
      const r = d.event.rounds.at(-1)!;
      for (const p of phones) {
        const id = p.id.cid;
        const t = r.tables.find((x) => x.seats.some((s) => s.member === id));
        if (chips()[id] > 0 && t) expect(p.at?.room).toBe((d.link(t.table) as LocalTable).room);
        else if (chips()[id] === 0) expect(p.at?.table).toBe(0);
      }
    }
    expect(d.event.phase).toBe('done');
    expect(d.event.rounds.length).toBeGreaterThan(1);
    // the phones followed their moves (to the event's room in the end, but the winner's)
    expect(phones.some((p) => p.moves.length > 1)).toBe(true);
    const rows = standings(d.event);
    expect(rows[0].points).toBe(720);
    desk.close();
    phones.forEach((p) => p.leaveTable());
  }, 60_000);
});
