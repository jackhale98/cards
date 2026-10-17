import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMsg, Lobby, LobbySeat, View } from '../src/net/protocol';
import { fitSeats, lobbyCommand } from '../src/net/host/lobby';
import { Conns } from '../src/net/host/conns';
import { Hands } from '../src/net/host/history';
import { HELLO_GAP_MS, IDENTITIES_PER_MINUTE, REPLAY_HANDS } from '../src/net/host/limits';
import { GAMES } from './games';

/**
 * The host's parts on their own (src/net/host/): the lobby's rules, the connections, the replays.
 * The whole host is tested end to end in net, table, night, replay, handoff and security.
 */

const seat = (id: string, more: Partial<LobbySeat> = {}): LobbySeat => ({ id, name: id, connected: true, ...more });
const lobby = (seats: LobbySeat[], more: Partial<Lobby> = {}): Lobby => ({
  code: 'ABCD',
  gameId: 'bridge',
  options: {},
  seats,
  spectators: 0,
  started: false,
  ...more,
});

describe('the lobby: who plays (bridge: four seats)', () => {
  it('bots make way first; a newcomer to a table full of people sits this one out', () => {
    const l = lobby([seat('h', { host: true }), seat('a'), seat('b'), seat('bot:1', { bot: true }), seat('c')]);
    fitSeats(l, { newcomer: 'c' });
    expect(l.seats.map((s) => s.id)).toEqual(['h', 'a', 'b', 'c']);
    l.seats.push(seat('d'));
    fitSeats(l, { newcomer: 'd' });
    expect(l.seats.filter((s) => !s.out).map((s) => s.id)).toEqual(['h', 'a', 'b', 'c']);
    expect(l.seats.find((s) => s.id === 'd')!.out).toBe(true);
  });

  it('whoever has sat out most comes in when there’s room; the host is never the one bumped', () => {
    const l = lobby([
      seat('h', { host: true }),
      seat('a', { sat: 0 }),
      seat('b', { out: true, sat: 2 }),
      seat('c', { out: true, sat: 1 }),
      seat('d'),
      seat('e'),
    ]);
    l.seats = l.seats.filter((s) => s.id !== 'e');
    fitSeats(l);
    expect(l.seats.filter((s) => !s.out).map((s) => s.id)).toEqual(['h', 'a', 'b', 'd']);
    // (too many in: the one who has sat out least goes, never the host)
    l.seats.find((s) => s.id === 'c')!.out = false;
    fitSeats(l);
    expect(l.seats.find((s) => s.id === 'h')!.out).toBeFalsy();
    expect(l.seats.filter((s) => !s.out)).toHaveLength(4);
  });
});

describe('the lobby: buttons from the phone holding the controls', () => {
  it('a game we have, an option on its own steps, removing only bots', () => {
    // (hearts: played to a target, 25 to 200 in steps of 25)
    const l = lobby([seat('h', { host: true }), seat('a'), seat('bot:1', { bot: true })], { gameId: 'hearts' });
    expect(lobbyCommand({ op: 'game', id: 'spades' }, l)).toEqual({ op: 'game', id: 'spades' });
    expect(lobbyCommand({ op: 'game', id: 'chess' }, l)).toBeNull();
    expect(lobbyCommand({ op: 'option', id: 'target', value: 150 }, l)).toEqual({ op: 'option', id: 'target', value: 150 });
    expect(lobbyCommand({ op: 'option', id: 'target', value: 160 }, l)).toBeNull();
    expect(lobbyCommand({ op: 'option', id: 'target', value: 500 }, l)).toBeNull();
    expect(lobbyCommand({ op: 'option', id: 'nope', value: true }, l)).toBeNull();
    expect(lobbyCommand({ op: 'remove', id: 'bot:1' }, l)).toEqual({ op: 'remove', id: 'bot:1' });
    expect(lobbyCommand({ op: 'remove', id: 'a' }, l)).toBeNull();
  });

  it('dealing and adding bots only before a game, ending only during one; anything malformed is nothing', () => {
    const before = lobby([seat('h', { host: true })]);
    const during = lobby([seat('h', { host: true })], { started: true });
    expect(lobbyCommand({ op: 'deal' }, before)).toEqual({ op: 'deal' });
    expect(lobbyCommand({ op: 'deal' }, during)).toBeNull();
    expect(lobbyCommand({ op: 'bot' }, during)).toBeNull();
    expect(lobbyCommand({ op: 'end' }, before)).toBeNull();
    expect(lobbyCommand({ op: 'end' }, during)).toEqual({ op: 'end' });
    for (const bad of [
      null,
      'deal',
      7,
      { op: 'move', id: 'a', dir: 2 },
      { op: 'look', back: 'x'.repeat(80), cloth: 'y' },
      { op: 'playing', id: 'a', on: 'yes' },
    ])
      expect(lobbyCommand(bad, before)).toBeNull();
  });
});

describe('connections', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const sent: [HostMsg, string][] = [];
  const conns = () => {
    sent.length = 0;
    return new Conns((msg, peer) => sent.push([msg, peer]));
  };
  const view = (v: number, extra: object = {}): View =>
    ({ v, hid: 'h1', lobby: lobby([seat('h', { host: true })]), you: 0, state: null, actions: [], status: null, ...extra }) as View;

  it('a player gets the whole view first, then only what changed; nothing when nothing they can see did', () => {
    const c = conns();
    c.peers.set('p1', 'a');
    expect(c.sendView('p1', view(1))).toBe(true);
    expect(sent.at(-1)![0].t).toBe('view');
    expect(c.sendView('p1', view(2, { you: 1 }))).toBe(true);
    expect(sent.at(-1)![0].t).toBe('patch');
    expect(c.sendView('p1', view(3, { you: 1 }))).toBe(false);
    // (a hello asks for the table afresh)
    c.afresh('p1');
    c.sendView('p1', view(4, { you: 1 }));
    expect(sent.at(-1)![0].t).toBe('view');
  });

  it('views go on the network in use while it answers, else on the one heard from last', () => {
    const c = conns();
    c.peers.set('relay', 'a');
    c.peers.set('rtc', 'a');
    c.watch('relay');
    vi.advanceTimersByTime(100);
    c.watch('rtc');
    expect(c.route('a')).toBe('rtc');
    vi.advanceTimersByTime(1000);
    c.heard('relay');
    // (still answering on the one in use: it keeps it)
    expect(c.route('a')).toBe('rtc');
    vi.advanceTimersByTime(30_000);
    c.heard('relay');
    expect(c.route('a')).toBe('relay');
  });

  it('a burst of hellos is one now and the latest later; a connection hopping between ids is cut off', () => {
    const c = conns();
    const greeted: string[] = [];
    const hello = (cid: string, name = cid) => ({ t: 'hello' as const, cid, name });
    const greet = (m: { name?: string }) => greeted.push(m.name!);
    c.pace('p1', hello('a', 'first'), greet);
    c.pace('p1', hello('a', 'second'), greet);
    c.pace('p1', hello('a', 'third'), greet);
    expect(greeted).toEqual(['first']);
    vi.advanceTimersByTime(HELLO_GAP_MS);
    expect(greeted).toEqual(['first', 'third']);
    c.peers.set('p1', 'a');
    let n = 0;
    for (let i = 0; i < IDENTITIES_PER_MINUTE + 2; i++) {
      vi.advanceTimersByTime(HELLO_GAP_MS);
      c.pace('p1', hello(`x${i}`), () => n++);
      c.peers.set('p1', `x${i}`);
    }
    expect(n).toBe(IDENTITIES_PER_MINUTE);
  });
});

describe('replays', () => {
  it('keep the last few hands, every moment of each, and a moment asked for is clamped to the hand', () => {
    const m = GAMES.hearts;
    const s0 = m.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name })),
      1,
      {},
    );
    const hands = new Hands();
    hands.reset();
    for (let h = 0; h < REPLAY_HANDS + 2; h++) {
      for (let i = 0; i < 3; i++) expect(hands.record(m, { ...s0, v: h * 10 + i }, undefined)).toBe(false);
      expect(hands.record(m, { ...s0, phase: 'roundOver', v: h * 10 + 9 }, undefined)).toBe(true);
    }
    expect(hands.count).toBe(REPLAY_HANDS);
    const f = hands.frame(m, 0, 0, 99)!;
    expect(f).toMatchObject({ hand: 0, hands: REPLAY_HANDS, step: 3, steps: 4 });
    expect(hands.frame(m, 0, 99, -5)).toMatchObject({ hand: REPLAY_HANDS - 1, step: 0 });
    expect(hands.frame(m, 0, 0.5, 0)).toBeNull();
  });
});
