import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrickData } from '../src/engine/families/trick';
import type { GameState } from '../src/engine/types';
import { Client } from '../src/net/client';
import { Host, type HostSnapshot } from '../src/net/host';
import type { HostMsg } from '../src/net/protocol';
import { parsHere } from '../src/net/solver';
import { Bus, MemTransport } from './netHarness';
import './games';

/**
 * Duplicate bridge in a room, outside any tournament: another table plays the same boards on the
 * host's device. Four here: a table of bots. More than four: whoever is sitting out, at a table of
 * their own. Each table hears the other's result on a board once it has played that board, and
 * every board is compared in IMPs.
 */

const data = (h: Host) => (h.state as GameState<TrickData>).data;

/** Rooms by code, each a bus; a connection joins a moment after it's made (as a real one would). */
function network() {
  const buses = new Map<string, Bus>();
  let n = 0;
  const open = (code: string, id = `p${++n}`) => {
    const bus = buses.get(code) ?? new Bus();
    buses.set(code, bus);
    const t = new MemTransport(bus, id);
    setTimeout(() => bus.join(t), 0);
    return t;
  };
  return { open, buses };
}

/** A duplicate game of `deals` boards set up in the lobby. */
function duplicate(host: Host, deals = 2, compare = 0) {
  host.setGame('bridge');
  host.setOption('style', 2);
  host.setOption('deals', deals);
  host.setOption('compare', compare);
}

/** Every move at both tables, the same each time (Host.step), to the end of the game here (not the next). */
const playOut = (host: Host) => {
  for (let i = 0; i < 40_000 && host.state?.phase !== 'gameOver' && host.step(); i++);
};

describe('duplicate in a room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function withBots(deals = 2) {
    const host = new Host(null, 'ROOMS', { cid: 'h', name: 'Hana', key: 'hk' }, undefined, { still: true, seed: 4 });
    duplicate(host, deals);
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    // (the other table is seated once its rules are in)
    await vi.advanceTimersByTimeAsync(0);
    return host;
  }

  it('four here: a table of bots plays the same boards, and each board is compared in IMPs', async () => {
    const host = await withBots();
    const bots = host.otherTable!;
    expect(bots.state).toBeTruthy();
    expect(bots.lobby.seats.filter((s) => s.bot)).toHaveLength(4);
    // (bots alone: no room, no network)
    expect(bots.lobby.code).toBe('TWIN');
    expect((bots.state as GameState<TrickData>).data.boards).toEqual(data(host).boards);
    playOut(host);
    expect(host.state!.phase).toBe('gameOver');
    expect(data(host).others!.map((o) => [o.n, o.at])).toEqual([
      [1, 'Bots'],
      [2, 'Bots'],
    ]);
    // the bots' table hears this one's results too
    expect((bots.state as GameState<TrickData>).data.others!.map((o) => o.at)).toEqual(['Table 1', 'Table 1']);
    expect(host.viewFor('h').status!.scoreboard!.columns).toEqual(['Here', 'Bots', 'IMPs N–S']);
    // tonight's tally keeps each player's IMPs (partners alike, the other side the opposite)
    const game = host.lobby.night!.games[0];
    expect(game.unit).toBe('IMPs');
    const imps = game.results.map((r) => r.score!);
    expect(imps[0]).toBe(imps[2]);
    expect(imps[1]).toBe(-imps[0]);
    host.close();
  });

  it('a table hears the other’s result on a board only once it has played that board', async () => {
    const host = await withBots();
    const bots = host.otherTable!;
    for (let i = 0; i < 4000 && !(bots.state as GameState<TrickData>).data.results!.length; i++) bots.step();
    expect((bots.state as GameState<TrickData>).data.results).toHaveLength(1);
    // board 1 is done there, not here: nothing of it here, not even in what this table is sent
    expect(data(host).others).toEqual([]);
    expect(JSON.stringify(host.viewFor('h'))).not.toContain('"at":"Bots"');
    for (let i = 0; i < 4000 && !data(host).results!.length; i++) host.step();
    expect(data(host).others!.map((o) => o.n)).toEqual([1]);
    host.close();
  });

  it('a new game deals new boards, and the other table plays them too', async () => {
    const host = await withBots();
    playOut(host);
    const first = data(host).boards;
    host.act('h', { type: 'rematch' });
    await vi.advanceTimersByTimeAsync(0);
    expect(data(host).boards).not.toEqual(first);
    const bots = host.otherTable!;
    expect(bots.lobby.event?.round).toBe(2);
    expect((bots.state as GameState<TrickData>).data.boards).toEqual(data(host).boards);
    expect(data(host).others).toEqual([]);
    playOut(host);
    expect(host.state!.phase).toBe('gameOver');
    host.close();
  });

  it('carries on after the host reloads, the other table with it', async () => {
    let snap: HostSnapshot | null = null;
    const host = await withBots(4);
    host.onPersist = (s) => (snap = JSON.parse(JSON.stringify(s)));
    for (let i = 0; i < 300; i++) host.step();
    host.broadcast();
    const there = host.otherTable!.state!.v;
    host.close();
    const back = new Host(null, 'ROOMS', { cid: 'h', name: 'Hana', key: 'hk' }, snap!, { still: true, seed: 4 });
    expect(back.otherTable!.state!.v).toBeGreaterThanOrEqual(there);
    playOut(back);
    expect(back.state!.phase).toBe('gameOver');
    expect(data(back).others).toHaveLength(4);
    back.close();
  });

  it('“compare with no one”: no other table, and most points wins', async () => {
    const host = new Host(null, 'ROOMS', { cid: 'h', name: 'Hana', key: 'hk' }, undefined, { still: true });
    duplicate(host, 2, 2);
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.otherTable).toBeNull();
    playOut(host);
    expect(host.state!.phase).toBe('gameOver');
    expect(data(host).others).toEqual([]);
    host.close();
  });

  it('compared with par: each board against the solver’s par, told as it’s played', async () => {
    // (the solver works in real time: DDS loads, and solves each board)
    vi.useRealTimers();
    let snap: HostSnapshot | null = null;
    const host = new Host(null, 'ROOMS', { cid: 'h', name: 'Hana', key: 'hk' }, undefined, { still: true, seed: 4, par: parsHere });
    host.onPersist = (x) => (snap = x);
    duplicate(host, 2, 1);
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    expect(host.otherTable).toBeNull();
    await vi.waitFor(() => expect(snap?.par).toHaveLength(2), { timeout: 30_000, interval: 50 });
    const pars = (await parsHere(data(host).boards!)).map((p) => p.ns);
    expect(data(host).others).toEqual([]);
    playOut(host);
    expect(host.state!.phase).toBe('gameOver');
    expect(data(host).others!.map((o) => [o.at, o.ns])).toEqual(pars.map((ns) => ['Par', ns]));
    expect(host.viewFor('h').status!.scoreboard!.columns).toEqual(['Here', 'Par', 'IMPs N–S']);
    host.close();
  }, 60_000);

  it('more here than the table seats: whoever is sitting out plays the same boards at a table of their own, and comes back after', async () => {
    const net = network();
    const host = new Host(net.open('ROOMS', 'host-peer'), 'ROOMS', { cid: 'h', name: 'Hana', key: 'hk' }, undefined, {
      still: true,
      seed: 4,
      twin: { open: (code) => net.open(code, `twin-host-${code}`) },
    });
    duplicate(host);
    const moves: Record<string, HostMsg[]> = {};
    const join = (id: string, code = 'ROOMS') => {
      const c = new Client(net.open(code), id, id.toUpperCase(), undefined, false, `key-${id}`);
      c.onMove = (m) => (moves[id] = [...(moves[id] ?? []), m as HostMsg]);
      vi.advanceTimersByTime(1000);
      return c;
    };
    const clients: Record<string, Client> = {};
    for (const id of ['ann', 'bo', 'cy', 'di']) clients[id] = join(id);
    // (five for four seats: the last in sits out)
    expect(host.lobby.seats.find((s) => s.id === 'di')?.out).toBe(true);
    host.start();
    await vi.advanceTimersByTimeAsync(0);
    const other = host.otherTable!;
    // Di is sent to the other table's room (a room of its own, hosted here), where a seat is kept for her
    const move = moves.di?.[0] as Extract<HostMsg, { t: 'move' }>;
    expect(move).toMatchObject({ t: 'move', code: other.lobby.code });
    expect(other.lobby.seats.find((s) => s.id === 'di')).toMatchObject({ connected: false });
    clients.di.close();
    clients.di = join('di', move.code);
    expect(other.lobby.seats.find((s) => s.id === 'di')).toMatchObject({ connected: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(other.state).toBeTruthy();
    // North there (partnered by a bot), playing the same boards
    expect(other.state!.players[0].name).toBe('DI');
    playOut(host);
    expect(host.state!.phase).toBe('gameOver');
    expect(data(host).others!.map((o) => o.at)).toEqual(['Table 2', 'Table 2']);
    expect(clients.di.view?.status?.scoreboard?.columns).toEqual(['Here', 'Table 1', 'IMPs N–S']);
    // back to the lobby: Di comes back here
    host.endGame();
    expect(moves.di.at(-1)).toMatchObject({ t: 'move', code: 'ROOMS', back: true });
    expect(host.otherTable).toBeNull();
    host.close();
  });
});
