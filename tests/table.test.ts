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
    host.setGame('bridge');
    expect(host.lobby.seats).toHaveLength(6);
    expect(host.lobby.seats.filter((s) => !s.out).map((s) => s.name)).toEqual(['Hana', 'Ann', 'Ben', 'Cal']);
    expect(host.canStart()).toBeNull();
  });

  it('a newcomer takes a bot’s place', () => {
    const { host, clients } = table(['Ann']);
    host.setGame('bridge');
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
    host.setGame('bridge');
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

describe('the host as the table screen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes no seat in the game, counts as a table screen, and plays again when switched back', () => {
    const { host, clients } = table(['Ann', 'Ben']);
    host.setGame('gin-rummy');
    // two seats: the host and Ann play, Ben sits out
    expect(host.lobby.seats.filter((s) => !s.out).map((s) => s.name)).toEqual(['Hana', 'Ann']);
    host.setScreen(true);
    // Ben takes the host's place; the phones know a table screen is up
    expect(host.lobby.seats.filter((s) => !s.out).map((s) => s.name)).toEqual(['Ann', 'Ben']);
    expect(host.lobby.displays).toBe(1);
    expect(clients[0].view!.lobby.displays).toBe(1);
    // the host can't be dealt in by mistake while it's the screen
    host.setPlaying('h', true);
    expect(host.lobby.seats.find((s) => s.host)!.out).toBe(true);
    host.start();
    expect(host.lobby.playing).toEqual(['ann', 'ben']);
    // the host's own view shows no hand
    expect(host.viewFor('h').you).toBe(-1);
    // after the game the screen stays the screen (and doesn't pile up turns sitting out)
    host.endGame();
    const me = host.lobby.seats.find((s) => s.host)!;
    expect(me.out).toBe(true);
    expect(me.sat ?? 0).toBe(0);
    host.setScreen(false);
    expect(host.lobby.seats.find((s) => s.host)!.out).toBe(false);
    expect(host.lobby.displays).toBe(0);
  });

  it('hands the controls to a player: their phone runs the lobby, and only theirs', () => {
    const { host, clients } = table(['Ann', 'Ben']);
    const [ann, ben] = clients;
    host.setScreen(true);
    // the first person here runs the table; everyone can see who
    expect(host.lobby.captain).toBe('ann');
    expect(ben.view!.lobby.captain).toBe('ann');
    ann.lobbyOp({ op: 'game', id: 'hearts' });
    expect(host.lobby.gameId).toBe('hearts');
    ann.lobbyOp({ op: 'option', id: 'target', value: 50 });
    expect(host.lobby.options.target).toBe(50);
    ann.lobbyOp({ op: 'bot' });
    ann.lobbyOp({ op: 'bot' });
    expect(host.lobby.seats.filter((x) => x.bot)).toHaveLength(2);
    // Ben's phone isn't obeyed
    ben.lobbyOp({ op: 'game', id: 'spades' });
    ben.lobbyOp({ op: 'deal' });
    expect(host.lobby.gameId).toBe('hearts');
    expect(host.lobby.started).toBe(false);
    ann.lobbyOp({ op: 'deal' });
    expect(host.lobby.started).toBe(true);
    expect(host.lobby.playing).not.toContain('h');
    ann.lobbyOp({ op: 'end' });
    expect(host.lobby.started).toBe(false);
    // the host can pass the controls on
    host.setCaptain('ben');
    ben.lobbyOp({ op: 'game', id: 'spades' });
    expect(host.lobby.gameId).toBe('spades');
    ann.lobbyOp({ op: 'game', id: 'hearts' });
    expect(host.lobby.gameId).toBe('spades');
  });

  it('checks everything from the phone holding the controls, as from anyone on the network', () => {
    const { host, clients } = table(['Ann', 'Ben']);
    const [ann] = clients;
    // with the host playing, nobody else runs the table
    ann.lobbyOp({ op: 'game', id: 'hearts' });
    expect(host.lobby.gameId).toBe('holdem');
    host.setScreen(true);
    host.setGame('hearts');
    const send = (op: unknown) => ann.lobbyOp(op as never);
    send({ op: 'game', id: 'nope' });
    send({ op: 'game', id: { toString: () => 'spades' } });
    expect(host.lobby.gameId).toBe('hearts');
    // an option the game has, a value it allows, on its steps
    send({ op: 'option', id: 'target', value: 1e9 });
    send({ op: 'option', id: 'target', value: 62.5 });
    send({ op: 'option', id: 'target', value: '75' });
    send({ op: 'option', id: 'made-up', value: 1 });
    expect(host.lobby.options.target).toBe(100);
    expect(Object.keys(host.lobby.options)).not.toContain('made-up');
    // only bots can be removed from the phone: who is at the table is the host's call
    send({ op: 'remove', id: 'ben' });
    expect(host.lobby.seats.map((x) => x.id)).toContain('ben');
    send({ op: 'move', id: 'ben', dir: 5 });
    send({ op: 'look', back: 3, cloth: null });
    send({ op: 'whatever' });
    send(null);
    expect(host.lobby.seats.map((x) => x.id)).toEqual(['h', 'ann', 'ben']);
    expect(host.lobby.look).toBeUndefined();
    // and switched back to playing, the controls go back to the host alone
    host.setScreen(false);
    expect(host.lobby.captain).toBeUndefined();
    send({ op: 'game', id: 'spades' });
    expect(host.lobby.gameId).toBe('hearts');
  });

  it('a player who takes over from a host that was the table screen leaves its old seat able to play', () => {
    const { host } = table(['Ann']);
    host.setScreen(true);
    const snap = { lobby: structuredClone(host.lobby), state: null, keys: {} };
    const next = new Host(null, 'ABCD', { cid: 'ann', name: 'Ann' }, snap, { takeover: true });
    const old = next.lobby.seats.find((s) => s.id === 'h')!;
    expect(old.host).toBeFalsy();
    expect(old.screen).toBeUndefined();
    expect(next.hostScreen).toBe(false);
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
    host.setGame('hearts');
    host.setOption('target', 50);
    const code = host.split(['ben', 'cal'], 'cal')!;
    expect(code).toMatch(/^[A-Z]{5}$/);
    // the new host gets tonight's tally, and the game this table was on to start from
    expect(moves).toEqual([
      [1, { t: 'move', code, host: false, parent: 'MAIN' }],
      [2, { t: 'move', code, host: true, night: host.lobby.night, game: { id: 'hearts', options: { ...host.lobby.options } }, parent: 'MAIN' }],
    ]);
    expect(host.lobby.seats.map((s) => s.name)).toEqual(['Hana', 'Ann']);
    expect(host.lobby.splits).toEqual([{ code, names: ['Ben', 'Cal'] }]);
    // the host can't be sent away, and needs one of the group to host
    expect(host.split(['h'], 'h')).toBeNull();
    expect(host.split(['ann'], 'ben')).toBeNull();
  });

  it('the split-off table starts on the game it came from, with only that game’s settings', () => {
    const side = new Host(null, 'SIDE', { cid: 'cal', name: 'Cal' }, undefined, { game: { id: 'hearts', options: { target: 50 } } });
    expect(side.lobby.gameId).toBe('hearts');
    expect(side.lobby.options.target).toBe(50);
    // (it came over the network: a game we don't have, or settings of the wrong kind, are left out)
    const odd = new Host(null, 'ODD', { cid: 'cal', name: 'Cal' }, undefined, {
      game: { id: 'hearts', options: { target: '50', made: 1, constructor: 3 } as unknown as Record<string, number> },
    });
    expect(odd.lobby.options.target).toBe(100);
    expect(Object.keys(odd.lobby.options)).not.toContain('made');
    expect(new Host(null, 'NONE', { cid: 'cal', name: 'Cal' }, undefined, { game: { id: 'toString', options: {} } }).lobby.gameId).toBe('holdem');
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

describe('the table’s look', () => {
  it('is kept in the lobby for everyone, and unknown ids fall back to the classic look', async () => {
    const host = new Host(null, 'LOOK', { cid: 'h', name: 'Hana' });
    host.setLook({ back: 'tartan', cloth: 'wood' });
    expect(host.viewFor('h').lobby.look).toEqual({ back: 'tartan', cloth: 'wood' });
    const { backOf, clothOf } = await import('../src/ui/looks');
    expect(backOf('nope').id).toBe('classic');
    expect(clothOf(undefined).id).toBe('green');
  });
});

describe('TV sound', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('anyone at the table can mute the table screens (a Chromecast has no menu of its own)', async () => {
    const { SCREEN_SOUND } = await import('../src/net/host');
    const { host, clients } = table(['Ann']);
    expect(host.lobby.screenSound).toBeUndefined(); // (on)
    host.setGame('gin-rummy');
    host.start();
    expect(host.act('ann', { type: SCREEN_SOUND, amount: 0 })).toBeNull();
    expect(clients[0].view!.lobby.screenSound).toBe(false);
    expect(host.act('ann', { type: SCREEN_SOUND, amount: 1 })).toBeNull();
    expect(host.lobby.screenSound).toBe(true);
    // someone who isn't at the table can't
    expect(host.act('stranger', { type: SCREEN_SOUND, amount: 0 })).toMatch(/not at the table/);
    expect(host.lobby.screenSound).toBe(true);
  });
});
