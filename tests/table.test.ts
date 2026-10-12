import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { Host } from '../src/net/host';
import type { Msg, NightGame } from '../src/net/protocol';
import type { Transport } from '../src/net/transport';

class Bus {
  members = new Map<string, MemTransport>();
  join(t: MemTransport) {
    const others = [...this.members.values()];
    this.members.set(t.selfId, t);
    for (const other of others) {
      other.onPeerJoin(t.selfId);
      t.onPeerJoin(other.selfId);
    }
  }
  leave(t: MemTransport) {
    this.members.delete(t.selfId);
    for (const other of this.members.values()) other.onPeerLeave(t.selfId);
  }
}
class MemTransport implements Transport {
  kind = 'memory';
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  constructor(
    private bus: Bus,
    readonly selfId: string,
  ) {}
  send(msg: Msg, to?: string) {
    const wire = JSON.parse(JSON.stringify(msg));
    for (const m of this.bus.members.values()) if (m !== this && (!to || to === m.selfId)) m.onMessage(wire, this.selfId);
  }
  leave() {
    this.bus.leave(this);
  }
}

/** The in-memory room a host is in (to bring more phones into it). */
const busOf = (host: Host) => (host as unknown as { transport: { bus: Bus } }).transport.bus;

function table(people: string[]) {
  const bus = new Bus();
  const ht = new MemTransport(bus, 'host-peer');
  const host = new Host(ht, 'MAIN', { cid: 'h', name: 'Hana' });
  bus.join(ht);
  const clients = people.map((name) => {
    const id = name.toLowerCase();
    const t = new MemTransport(bus, `${id}-peer`);
    const c = new Client(t, id, name, undefined);
    bus.join(t);
    return c;
  });
  return { host, clients };
}

describe('more people than the game seats', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seats everyone at the table; the latest to arrive sit out', () => {
    const { host } = table(['Ann', 'Ben', 'Cal', 'Dee', 'Eve']);
    host.setGame('hearts');
    expect(host.lobby.seats).toHaveLength(6);
    expect(host.lobby.seats.filter((s) => !s.out).map((s) => s.name)).toEqual(['Hana', 'Ann', 'Ben', 'Cal']);
    expect(host.canStart()).toBeNull();
  });

  it('a newcomer takes a bot’s place', () => {
    const { host, clients } = table(['Ann']);
    host.setGame('hearts');
    host.addBot();
    host.addBot();
    expect(host.lobby.seats.filter((s) => s.bot)).toHaveLength(2);
    void clients;
    const bus = busOf(host);
    const t = new MemTransport(bus, 'zed-peer');
    new Client(t, 'zed', 'Zed', undefined);
    bus.join(t);
    expect(host.lobby.seats.filter((s) => s.bot)).toHaveLength(1);
    expect(host.lobby.seats.every((s) => !s.out)).toBe(true);
  });

  it('those sitting out watch, can’t act, and play the next game', () => {
    const { host, clients } = table(['Ann', 'Ben', 'Cal', 'Dee']);
    const [, , , dee] = clients;
    host.setGame('hearts');
    // the host picks who plays: Ann sits out instead of Dee
    host.setPlaying('ann', false);
    host.setPlaying('dee', true);
    expect(host.lobby.seats.filter((s) => !s.out).map((s) => s.name)).toEqual(['Hana', 'Ben', 'Cal', 'Dee']);
    host.start();
    expect(host.lobby.playing).toEqual(['h', 'ben', 'cal', 'dee']);
    // Dee is game seat 3 and sees their own hand; Ann watches
    expect(dee.view!.you).toBe(3);
    expect(dee.view!.state!.zones['hand:3'].cards.every((c) => !c.id.startsWith('?'))).toBe(true);
    const ann = clients[0];
    expect(ann.view!.you).toBe(-1);
    expect(ann.view!.state!.zones['hand:1'].cards.every((c) => c.id.startsWith('?'))).toBe(true);
    expect(host.act('ann', { type: 'pass' })).toMatch(/sitting this one out/);
    // back in the lobby, Ann has sat out once and is in; someone else sits out
    host.endGame();
    expect(host.lobby.seats.find((s) => s.id === 'ann')!.out).toBe(false);
    expect(host.lobby.seats.find((s) => s.id === 'ann')!.sat).toBe(1);
    expect(host.lobby.seats.filter((s) => s.out)).toHaveLength(1);
    expect(host.lobby.seats.find((s) => s.host)!.out).toBeFalsy();
  });

  it('a late arrival mid-game sits out until the next one', () => {
    const { host } = table(['Ann']);
    host.setGame('gin-rummy');
    host.start();
    const bus = busOf(host);
    const t = new MemTransport(bus, 'late-peer');
    const late = new Client(t, 'late', 'Lou', undefined);
    bus.join(t);
    expect(host.lobby.seats.find((s) => s.id === 'late')!.out).toBe(true);
    expect(late.view!.you).toBe(-1);
    expect(host.state!.players).toHaveLength(2);
  });

  it('game night only scores the people who played', () => {
    const { host } = table(['Ann', 'Ben']);
    host.setGame('gin-rummy');
    host.setPlaying('ben', false);
    host.start();
    host.state!.phase = 'gameOver';
    host.state!.winner = [1];
    (host as unknown as { tally: () => void }).tally();
    const g = host.lobby.night!.games[0];
    expect(g.results.map((r) => r.id)).toEqual(['h', 'ann']);
  });
});

describe('splitting the table', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a group off to a new table their chosen host runs, with tonight’s tally', () => {
    const { host, clients } = table(['Ann', 'Ben', 'Cal']);
    const moves: unknown[] = [];
    clients.forEach((c, i) => (c.onMove = (m) => moves.push([i, m])));
    host.lobby.night = { games: [{ game: 'hearts', name: 'Hearts', at: 1, results: [] }] };
    const code = host.split(['ben', 'cal'], 'cal')!;
    expect(code).toMatch(/^[A-Z]{5}$/);
    expect(moves).toEqual([
      [1, { t: 'move', code, host: false, parent: 'MAIN' }],
      [2, { t: 'move', code, host: true, night: host.lobby.night, parent: 'MAIN' }],
    ]);
    expect(host.lobby.seats.map((s) => s.name)).toEqual(['Hana', 'Ann']);
    expect(host.lobby.splits).toEqual([{ code, names: ['Ben', 'Cal'] }]);
    // the host can't be sent away, and needs one of the group to host
    expect(host.split(['h'], 'h')).toBeNull();
    expect(host.split(['ann'], 'ben')).toBeNull();
  });

  it('the split-off table starts with the tally, and heads back with its games', () => {
    const night = { games: [{ game: 'hearts', name: 'Hearts', at: 1, results: [] }] as NightGame[] };
    const side = new Host(null, 'SIDE', { cid: 'cal', name: 'Cal' }, undefined, { night, parent: 'MAIN' });
    expect(side.lobby.night!.games).toHaveLength(1);
    expect(side.lobby.parent).toBe('MAIN');

    // back at the main table: a returning player's hello brings the new games (once)
    const { host, clients } = table(['Ann']);
    host.lobby.night = { games: [night.games[0]] };
    host.lobby.splits = [{ code: 'SIDE', names: ['Cal'] }];
    const played: NightGame = { game: 'gin-rummy', name: 'Gin Rummy', at: 5, results: [{ id: 'cal', name: 'Cal', place: 1, points: 3 }] };
    const bus = busOf(host);
    for (const id of ['cal', 'ben']) {
      const t = new MemTransport(bus, `${id}-peer`);
      const c = new Client(t, id, id, undefined);
      c.returning = { from: 'SIDE', night: { games: [night.games[0], played] } };
      bus.join(t);
    }
    expect(host.lobby.night.games.map((g) => g.game)).toEqual(['hearts', 'gin-rummy']);
    expect(host.lobby.splits).toEqual([]);
    expect(clients[0].view!.lobby.night!.games).toHaveLength(2);
  });
});
