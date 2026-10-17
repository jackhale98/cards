import { describe, expect, it, vi } from 'vitest';
import { nightPoints, placesFromScores, standingsOf } from '../src/engine/state';
import type { GameState } from '../src/engine/types';
import { GAMES } from './games';
import { Host } from '../src/net/host';
import { nightTotals, nightUnit } from '../src/net/night';

describe('game night', () => {
  it('turns scores into places, sharing ties', () => {
    expect(placesFromScores([10, 30, 20, 30])).toEqual([3, 0, 2, 0]);
    expect(placesFromScores([10, 30, 20], true)).toEqual([0, 2, 1]); // hearts: low wins
  });

  it('puts the declared winners first even when others scored more (500)', () => {
    const s = { players: [0, 1, 2, 3].map((seat) => ({ seat })), winner: [0, 2] } as unknown as GameState;
    // the defenders (1, 3) have more points but didn't win
    const mod = { standings: () => [1, 0, 1, 0] };
    expect(standingsOf(mod, s)).toEqual([0, 1, 0, 1]);
    // no standings: winners first, everyone else second
    expect(standingsOf({}, { ...s, winner: [3] } as GameState)).toEqual([1, 1, 1, 0]);
  });

  it('gives 3 / 2 / 1 points for the podium and nothing for last', () => {
    const places = [0, 1, 2, 3, 4];
    expect(places.map((p) => nightPoints(p, places))).toEqual([3, 2, 1, 1, 0]);
    expect([0, 1].map((p) => nightPoints(p, [0, 1]))).toEqual([3, 0]); // head to head
    expect([0, 0, 1, 1].map((p) => nightPoints(p, [0, 0, 1, 1]))).toEqual([3, 3, 0, 0]); // partnerships
  });

  it('adds up the night, best first', () => {
    const g = (results: [string, number, number][]) => ({
      game: 'x',
      name: 'X',
      at: 1,
      results: results.map(([id, place, points]) => ({ id, name: id.toUpperCase(), place, points })),
    });
    const rows = nightTotals({
      games: [
        g([
          ['a', 0, 3],
          ['b', 1, 0],
        ]),
        g([
          ['a', 1, 0],
          ['b', 0, 3],
          ['c', 1, 0],
        ]),
      ],
    });
    expect(rows.map((r) => [r.id, r.points, r.wins, r.played, r.rank])).toEqual([
      ['a', 3, 1, 2, 0],
      ['b', 3, 1, 2, 0],
      ['c', 0, 0, 1, 2],
    ]);
  });

  it('a night of duplicate bridge adds up IMPs; one with other games too, places', () => {
    const dup = (results: [string, number, number][]) => ({
      game: 'bridge',
      name: 'Contract Bridge',
      at: 1,
      unit: 'IMPs',
      results: results.map(([id, place, score]) => ({ id, name: id.toUpperCase(), place, points: place ? 0 : 3, score })),
    });
    // partnerships change between games: each player's own IMPs add up
    const night = {
      games: [
        dup([
          ['a', 0, 12],
          ['b', 1, -12],
          ['c', 0, 12],
          ['d', 1, -12],
        ]),
        dup([
          ['a', 1, -5],
          ['b', 0, 5],
          ['c', 0, 5],
          ['d', 1, -5],
        ]),
      ],
    };
    expect(nightUnit(night)).toBe('IMPs');
    expect(nightTotals(night).map((r) => [r.id, r.points, r.wins])).toEqual([
      ['c', 17, 2],
      ['a', 7, 1],
      ['b', -7, 1],
      ['d', -17, 0],
    ]);
    // a game of Hearts as well: places again
    const mixed = { games: [...night.games, { game: 'hearts', name: 'Hearts', at: 2, results: [{ id: 'a', name: 'A', place: 0, points: 3 }] }] };
    expect(nightUnit(mixed)).toBeNull();
    expect(nightTotals(mixed)[0]).toMatchObject({ id: 'a', points: 6 });
  });

  it('can rank by points per game, so a late arrival isn’t ranked low for playing less', () => {
    const g = (results: [string, number, number][]) => ({
      game: 'hearts',
      name: 'Hearts',
      at: 0,
      results: results.map(([id, place, points]) => ({ id, name: id.toUpperCase(), place, points })),
    });
    // a plays all three games (7 points); c joins for the last two (5 points)
    const night = {
      games: [
        g([['a', 0, 3]]),
        g([
          ['a', 0, 3],
          ['c', 1, 2],
        ]),
        g([
          ['a', 1, 1],
          ['c', 0, 3],
        ]),
      ],
    };
    expect(nightTotals(night).map((r) => [r.id, r.points, r.played, r.rank])).toEqual([
      ['a', 7, 3, 0],
      ['c', 5, 2, 1],
    ]);
    // per game c leads: 2.5 against a's 2.33
    expect(nightTotals(night, 'perGame').map((r) => [r.id, r.perGame, r.rank])).toEqual([
      ['c', 2.5, 0],
      ['a', 7 / 3, 1],
    ]);
  });

  it('the host records each finished game once, and again after a rematch', () => {
    vi.useFakeTimers();
    const host = new Host(null, 'ABCD', { cid: 'h', name: 'Hana' });
    host.addBot();
    host.setGame('gin-rummy');
    host.start();
    const finish = (winner: number) => {
      const s = (host as any).state as GameState<any>;
      s.phase = 'gameOver';
      s.winner = [winner];
      s.data.scores = winner === 0 ? [100, 40] : [40, 100];
      (host as any).commit();
    };
    finish(1);
    finish(1); // more updates while the game-over screen is up: still one game
    expect(host.lobby.night!.games).toHaveLength(1);
    // the game's own final scores are kept with it, to look back at later
    const final = host.lobby.night!.games[0].final!;
    expect(final.rows.map((r) => r.name).sort()).toEqual(['Hana', host.lobby.seats[1].name].sort());
    expect(final.rows.every((r) => r.values.length > 0 && r.values.every((v) => typeof v === 'string'))).toBe(true);
    expect(host.lobby.night!.games[0].results.map((r) => [r.id, r.place, r.points])).toEqual([
      ['h', 1, 0],
      [host.lobby.seats[1].id, 0, 3],
    ]);
    host.act('h', { type: 'rematch' });
    finish(0);
    expect(nightTotals(host.lobby.night).map((r) => r.points)).toEqual([3, 3]);
    host.newNight();
    expect(host.lobby.night!.games).toEqual([]);
    vi.useRealTimers();
  });

  it('a nine-player hold’em night: one game tallied for everyone, knockouts ranked by how long they lasted', () => {
    vi.useFakeTimers();
    const host = new Host(null, 'ABCD', { cid: 'h', name: 'Hana' });
    host.setGame('holdem');
    for (let i = 0; i < 8; i++) host.addBot();
    expect(host.lobby.seats).toHaveLength(9);
    host.setOption('botLevel', 0); // quick bots: this plays a whole game
    host.setOption('stack', 200); // (short stacks: Easy bots play their hands out, so deep ones last long)
    host.start();
    for (let i = 0; i < 40000 && host.state!.phase !== 'gameOver'; i++) {
      const s = host.state! as GameState<any>;
      // the host shoves every hand to speed things up
      if (s.phase === 'betting' && s.turn === 0) host.act('h', { type: s.players[0].chips > 0 ? 'allin' : 'fold' });
      if (s.phase === 'handOver' && s.players[0].chips > 0) host.act('h', { type: 'next' });
      vi.advanceTimersByTime(1500);
    }
    expect(host.state!.phase).toBe('gameOver');
    const game = host.lobby.night!.games[0];
    expect(host.lobby.night!.games).toHaveLength(1);
    expect(game.results).toHaveLength(9);
    const byPlace = [...game.results].sort((a, b) => a.place - b.place);
    expect(byPlace[0].place).toBe(0);
    expect(byPlace[0].points).toBe(3);
    // whoever lasted longer places higher (a player all in has no chips mid-hand but isn't out:
    // the hand each was knocked out in is what counts)
    const bustedAt: (number | null)[] = (host.state!.data as { bustedAt: (number | null)[] }).bustedAt;
    for (let a = 0; a < 9; a++)
      for (let b = 0; b < 9; b++)
        if (bustedAt[a] != null && bustedAt[b] != null && bustedAt[a]! > bustedAt[b]!) expect(game.results[a].place).toBeLessThan(game.results[b].place);
    expect(byPlace.at(-1)!.points).toBe(0);
    expect(nightTotals(host.lobby.night)).toHaveLength(9);
    vi.restoreAllMocks();
    vi.useRealTimers();
  }, 30_000); // (a whole nine-player game)

  it('every family with scores can rank its players', () => {
    for (const id of ['hearts', 'cribbage', 'holdem', 'gin-rummy', 'bridge']) {
      const g = GAMES[id];
      const n = Math.max(g.config.players.min, 2);
      const s = g.setup(
        Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true })),
        1,
        {},
      );
      expect(g.standings!(s)).toHaveLength(n);
    }
  });

  it('final scores from another table are size-limited and checked before they join the tally', () => {
    const host = new Host(null, 'ABCD', { cid: 'h', name: 'Hana' });
    (host as any).lobby.splits = [{ code: 'WXYZ' }];
    const long = 'x'.repeat(500);
    (host as any).mergeBack('WXYZ', [
      {
        game: 'hearts',
        name: 'Hearts',
        at: 5,
        results: [{ id: 'a', name: 'Ada', place: 0, points: 3 }],
        final: { columns: ['Total', 7], rows: [{ name: long, values: [long, 9, 'ok'] }, 'junk'], lines: [long, { evil: 1 }] },
      },
    ]);
    const f = host.lobby.night!.games[0].final!;
    expect(f.columns).toEqual(['Total']);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].name.length).toBeLessThanOrEqual(40);
    expect(f.rows[0].values).toEqual(['x'.repeat(24), 'ok']);
    expect(f.lines).toEqual(['x'.repeat(120)]);
  });
});
