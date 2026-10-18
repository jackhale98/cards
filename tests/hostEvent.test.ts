import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { Host, type HostSnapshot } from '../src/net/host';
import type { EventTable, TableNews } from '../src/net/host/event';
import { Bus, MemTransport } from './netHarness';
import { GAMES } from './games';

/**
 * A tournament table: its director decides who sits where (each seat held by its player's key),
 * what's dealt and when it moves on; nobody at the table can change any of that.
 */

const info = { code: 'BCDFGH', name: 'Friday Swiss', round: 1, table: 3 };
function hearts(seats: EventTable['seats'], more: Partial<EventTable> = {}): EventTable {
  return { info, game: { id: 'hearts', options: {} }, seats, ...more };
}
const member = (id: string, name: string) => ({ id, name, key: `key-${id}` });

/** A table the director hosts (its device is the table's screen), and phones that join it. */
function directorTable() {
  const bus = new Bus();
  const ht = new MemTransport(bus, 'dir-peer');
  const host = new Host(ht, 'TABLE', { cid: 'dir', name: 'Director' });
  bus.join(ht);
  const join = (id: string, key: string) => {
    const t = new MemTransport(bus, `${id}-peer-${Math.random().toString(36).slice(2, 6)}`);
    const c = new Client(t, id, id.toUpperCase(), undefined, false, key);
    bus.join(t);
    // (a phone says hello, is asked for its seat's key, and shows it: hellos are paced)
    vi.advanceTimersByTime(1000);
    return { c, t };
  };
  return { host, join };
}

const seatOf = (host: Host, id: string) => host.lobby.seats.find((s) => s.id === id);

describe('a tournament table', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seats each player where the director says, by their seat’s key, and deals once everyone is here', () => {
    const { host, join } = directorTable();
    host.seatTable(hearts([member('ann', 'Ann'), null, member('bo', 'Bo'), null]));
    // the director's device is the screen: it doesn't play
    expect(seatOf(host, 'dir')).toMatchObject({ host: true, screen: true, out: true });
    expect(host.lobby.event).toEqual(info);
    join('ann', 'key-ann');
    expect(seatOf(host, 'ann')?.connected).toBe(true);
    expect(host.state).toBeNull();
    // the wrong key only watches
    const wrong = join('bo', 'not-bo');
    expect(seatOf(host, 'bo')?.connected).toBe(false);
    wrong.t.leave();
    join('bo', 'key-bo');
    expect(host.state?.phase).toBeDefined();
    expect(host.state!.players.map((p) => p.name)).toEqual(['Ann', expect.any(String), 'Bo', expect.any(String)]);
    expect(host.state!.players.map((p) => !!p.bot)).toEqual([false, true, false, true]);
    host.close();
  });

  it('keeps a seat for its player who leaves before the deal; a stranger only watches', () => {
    const { host, join } = directorTable();
    host.seatTable(hearts([member('ann', 'Ann'), null, member('bo', 'Bo'), null]));
    const ann = join('ann', 'key-ann');
    ann.t.leave();
    expect(seatOf(host, 'ann')).toMatchObject({ connected: false });
    join('zed', 'whatever');
    expect(seatOf(host, 'zed')).toBeUndefined();
    expect(host.lobby.seats).toHaveLength(5);
    host.close();
  });

  it('nobody at the table changes the game, its settings or its seats', () => {
    const { host, join } = directorTable();
    host.seatTable(hearts([member('ann', 'Ann'), null, member('bo', 'Bo'), null]));
    join('ann', 'key-ann');
    const before = JSON.stringify(host.lobby.seats);
    host.setGame('gin-rummy');
    host.setOption('target', 50);
    host.addBot();
    host.removeSeat('ann');
    host.moveSeat('ann', 1);
    host.setPlaying('ann', false);
    host.setTakeBacks(true);
    expect(host.lobby.gameId).toBe('hearts');
    expect(host.lobby.options.target).not.toBe(50);
    expect(JSON.stringify(host.lobby.seats)).toBe(before);
    expect(host.lobby.takeBacks).toBeUndefined();
    // the director's device is the screen, but no player holds the table's controls
    expect(host.captain).toBeNull();
    expect(host.lobby.captain).toBeUndefined();
    host.close();
  });

  it('after a while, bots play for whoever isn’t here, and they have their seat back when they come', () => {
    const { host, join } = directorTable();
    host.seatTable(hearts([member('ann', 'Ann'), null, member('bo', 'Bo'), null], { grace: 5000 }));
    join('ann', 'key-ann');
    expect(host.state).toBeNull();
    vi.advanceTimersByTime(4000);
    expect(host.state).not.toBeNull();
    expect(host.state!.players[2]).toMatchObject({ name: 'Bo', bot: true });
    expect(seatOf(host, 'bo')?.standIn).toBe(true);
    join('bo', 'key-bo');
    expect(host.state!.players[2].bot).toBe(false);
    host.close();
  });

  it('deals from the director’s seed and hands the game its private inputs', () => {
    const setup = vi.spyOn(GAMES.hearts, 'setup');
    const deal = () => {
      const host = new Host(null, 'TABLE', { cid: 'dir', name: 'Director' });
      host.seatTable(hearts([null, null, null, null], { seed: 42, setup: { chips: [1, 2, 3, 4] } }));
      host.start();
      const hand = host.state!.zones['hand:0'].cards.map((c) => c.id);
      host.close();
      return hand;
    };
    expect(deal()).toEqual(deal());
    expect(setup.mock.calls.at(-1)?.[3]).toEqual({ chips: [1, 2, 3, 4] });
    setup.mockRestore();
  });

  it('tells the director how each hand and the game went, and never deals the game again itself', () => {
    const host = new Host(null, 'TABLE', { cid: 'dir', name: 'Director' });
    const news: TableNews[] = [];
    host.onTable = (n) => news.push(n);
    // (a short game: to 25)
    host.seatTable({ ...hearts([null, null, null, null], { seed: 7 }), game: { id: 'hearts', options: { target: 25 } } });
    host.start();
    for (let i = 0; i < 20_000 && host.state!.phase !== 'gameOver'; i++) if (!host.step()) break;
    expect(host.state!.phase).toBe('gameOver');
    // (nothing more: rematch isn't on at a tournament table)
    expect(host.step()).toBe(false);
    expect(host.state!.phase).toBe('gameOver');
    expect(news.filter((n) => n.kind === 'hand').length).toBeGreaterThan(1);
    const over = news.filter((n) => n.kind === 'over');
    expect(over).toHaveLength(1);
    const result = (over[0] as Extract<TableNews, { kind: 'over' }>).result;
    expect(result.places).toHaveLength(4);
    expect(result.places).toContain(0);
    expect(result.scores).toHaveLength(4);
    host.close();
  });

  it('a table of bots alone plays on by itself: a bot deals each next hand, to the end of the game', () => {
    // (as the director's device hosts a tournament's table of bots: nobody there to press "Next hand")
    const host = new Host(null, 'TABLE', { cid: 'dir', name: 'Director' });
    const news: TableNews[] = [];
    host.onTable = (n) => news.push(n);
    host.seatTable(
      hearts(
        [0, 1, 2, 3].map((i) => ({ bot: true as const, name: `Bot ${i}` })),
        { game: { id: 'hearts', options: { target: 25 } } },
      ),
    );
    for (let i = 0; i < 2000 && !news.some((n) => n.kind === 'over'); i++) vi.advanceTimersByTime(1000);
    expect(news.filter((n) => n.kind === 'hand').length).toBeGreaterThan(1);
    expect(news.some((n) => n.kind === 'over')).toBe(true);
    expect(host.state!.phase).toBe('gameOver');
    host.close();
  });

  it('a hold stops the table at the end of the hand, until the director lets it go', () => {
    const host = new Host(null, 'TABLE', { cid: 'dir', name: 'Director' });
    const news: TableNews[] = [];
    host.onTable = (n) => news.push(n);
    host.seatTable(hearts([null, null, null, null], { seed: 7 }));
    host.start();
    host.hold(true);
    let steps = 0;
    while (host.step()) steps++;
    expect(steps).toBeGreaterThan(10);
    expect(['handOver', 'roundOver']).toContain(host.state!.phase);
    expect(news.some((n) => n.kind === 'held')).toBe(true);
    // (a change only between hands; hearts has nothing to change)
    expect(host.adjust({ blinds: { sb: 1, bb: 2 } })).toBe('Nothing to change');
    host.hold(false);
    expect(host.step()).toBe(true);
    host.close();
  });

  it('keeps its place in the event through a reload or a player taking over', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'ann-host');
    // a player hosts this table (Swiss of any game): Ann's phone
    const host = new Host(ht, 'TABLE', { cid: 'ann', name: 'Ann' });
    bus.join(ht);
    let snap: HostSnapshot | null = null;
    host.onPersist = (s) => (snap = structuredClone(s));
    host.seatTable(hearts([member('ann', 'Ann'), null, member('bo', 'Bo'), null], { grace: 1000 }));
    expect(seatOf(host, 'ann')).toMatchObject({ host: true, connected: true });
    expect(seatOf(host, 'ann')?.screen).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(host.state).not.toBeNull();
    host.close();
    // Bo takes the table over from a backup
    const taken = new Host(null, 'TABLE', { cid: 'bo', name: 'Bo' }, snap!, { takeover: true });
    expect(taken.lobby.event).toEqual(info);
    taken.setGame('gin-rummy');
    expect(taken.lobby.gameId).toBe('hearts');
    expect(seatOf(taken, 'bo')?.host).toBe(true);
    taken.close();
  });
});
