import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { standings } from '../src/engine/events';
import { seedState } from '../src/engine/rng';
import type { OtherResult } from '../src/engine/types';
import { Registry } from '../src/net/director/registry';
import { newSecret } from '../src/net/eventCrypto';
import { director, Net, Phone, playOut, settle } from './eventHarness';
import { GAMES } from './games';

/**
 * Duplicate teams over the network (in memory), each table hosted on one of its players' phones: a
 * match's two tables hear each other's results through the director (the host's link to it), and
 * the director's screens show no table's scores while others may still be playing those boards.
 */

describe('signing up for duplicate teams', () => {
  it('partnerships two by two: those who asked to be on a team together, then the rest; a pair left over plays with bots', () => {
    const r = new Registry();
    for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal', 'Ivy', 'Jo']) r.add({ id: n.toLowerCase(), name: n, secret: newSecret() });
    const partners = (a: string, b: string) => (r.setPartner(a, b), r.setPartner(b, a));
    partners('ann', 'bo');
    partners('cy', 'di');
    partners('ed', 'flo');
    partners('gus', 'hal');
    partners('ivy', 'jo');
    // (Hal would like Ann's pair on their team; a bot can't be asked for)
    r.setTeam('hal', 'ann');
    const bot = r.addBot();
    r.setTeam('cy', bot.id);
    expect(r.members.get('cy')!.team).toBeUndefined();
    const teams = r.entrants(2, { rng: seedState(3) }, true);
    expect(teams).toHaveLength(4);
    const people = teams.filter((x) => !x.bot);
    expect(people.map((x) => x.members.filter(Boolean).length).sort()).toEqual([2, 4, 4]);
    const hal = people.find((x) => x.members.includes('hal'))!;
    expect([...hal.members].sort()).toEqual(['ann', 'bo', 'gus', 'hal']);
    // (each pair sits together: a team's first two members are one partnership, its last two the other)
    for (const x of people) expect([x.members.slice(0, 2), x.members.slice(2)].map((p) => p.join('+'))).not.toContain('bo+gus');
    const alone = people.find((x) => x.members.filter(Boolean).length === 2)!;
    expect(alone.members.slice(2)).toEqual(['', '']);
    expect(alone.name).toMatch(/and two bots$/);
    // each bot the director put in is a whole team, four named bots
    const bots = teams.find((x) => x.bot)!;
    expect(new Set(bots.names).size).toBe(4);
  });
});

describe('duplicate teams over the network', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a match’s two tables, each hosted on a phone, hear each other’s results through the director', async () => {
    const net = new Net();
    const { d, desk } = director(net, {
      name: 'Teams',
      format: 'teams',
      game: { id: 'bridge', options: { ...GAMES.bridge.duplicate } },
      seats: 4,
      sides: GAMES.bridge.sides!(4)!,
      rounds: 1,
      boards: 2,
    });
    const phones = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'].map((n) => new Phone(net, n));
    await settle();
    expect(desk.start()).toBeNull();
    await settle();
    expect(d.event.entrants).toHaveLength(2);
    const hosts = phones.filter((p) => p.host);
    expect(hosts).toHaveLength(2);
    // (each table is told where its teammates are)
    for (const p of hosts) expect(p.host!.lobby.event?.note).toMatch(/teammates play these boards at table [12]/);
    for (let i = 0; i < 20 && d.event.phase === 'playing'; i++) {
      await playOut(phones);
      // (the director's tiles: never a score, while another table may still be playing those boards)
      for (const t of desk.tiles().values()) expect(t.tile?.totals ?? null).toBeNull();
    }
    expect(d.event.phase).toBe('between');
    const [t1, t2] = d.event.rounds[0].tables;
    for (const p of hosts) {
      const here = p.at!.table;
      const other = here === t1.table ? t2 : t1;
      expect(p.host!.state!.phase).toBe('gameOver');
      expect((p.host!.state!.data as { others: OtherResult[] }).others.map((o) => [o.n, o.at, o.ns])).toEqual(
        other.report!.boards!.map((b) => [b.n, `Table ${other.table}`, b.ns]),
      );
    }
    const rows = standings(d.event);
    expect(rows[0].score! + rows[1].score!).toBe(0);
    expect(d.view.travellers!.map((t) => t.rows.length)).toEqual([2, 2]);
    desk.close();
    phones.forEach((p) => p.leaveTable());
  }, 60_000);
});
