import { describe, expect, it } from 'vitest';
import type { GameModule } from '../src/engine/types';
import * as bet from '../src/engine/lib/betting';
import { bestHand, eval5 } from '../src/engine/lib/pokerEval';

const h = (s: string) => s.split(' ');

describe('poker evaluator', () => {
  it.each([
    ['AS KS QS JS TS', 'Straight flush'],
    ['9C 9D 9H 9S 2C', 'Four of a kind'],
    ['3C 3D 3H 7S 7C', 'Full house'],
    ['2H 8H JH KH 4H', 'Flush'],
    ['AS 2D 3H 4S 5C', 'Straight'],
    ['QC QD QH 7S 2C', 'Three of a kind'],
    ['QC QD 7H 7S 2C', 'Two pair'],
    ['QC QD 8H 7S 2C', 'Pair'],
    ['AC QD 8H 7S 2C', 'High card'],
  ])('%s is %s', (cards, name) => {
    expect(eval5(h(cards)).name).toBe(name);
  });

  it('ranks hands correctly', () => {
    const cmp = (a: string, b: string) => Math.sign(eval5(h(a)).score - eval5(h(b)).score);
    expect(cmp('AS 2D 3H 4S 5C', '2S 3D 4H 5S 6C')).toBe(-1); // wheel is lowest straight
    expect(cmp('KC KD 4H 4S 2C', 'KH KS 4C 4D AC')).toBe(-1); // kicker
    expect(cmp('AC AD 2H 2S 3C', 'KC KD QH QS JC')).toBe(1);
    expect(cmp('2H 3H 4H 5H 7H', 'AS KD QC JH TS')).toBe(1);
    expect(cmp('TC TD TH 2S 2C', 'TS TC TH 2D 2H')).toBe(0);
  });

  it('finds the best 5 of 7', () => {
    expect(bestHand(h('AS KS 2D 3C QS JS TS')).name).toBe('Straight flush');
    expect(bestHand(h('2C 2D 2H 5S 5C 5D AH')).name).toBe('Full house');
  });
});

describe('betting', () => {
  it('builds side pots from all-ins', () => {
    const b = bet.newBetting(3, [false, false, false]);
    b.committed = [50, 200, 200];
    expect(bet.pots(b)).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ]);
  });

  it('includes folded chips but not folded eligibility', () => {
    const b = bet.newBetting(3, [false, false, false]);
    b.committed = [30, 100, 100];
    b.folded[0] = true;
    expect(bet.pots(b)).toEqual([{ amount: 230, eligible: [1, 2] }]);
  });

  it('completes a street when everyone has matched', () => {
    const chips = [100, 100, 100];
    const b = bet.newBetting(3, [false, false, false]);
    bet.post(b, chips, 1, 5);
    bet.post(b, chips, 2, 10);
    b.minRaise = 10;
    bet.act(b, chips, 0, { type: 'call' });
    bet.act(b, chips, 1, { type: 'call' });
    expect(bet.streetComplete(b)).toBe(false); // big blind has the option
    bet.act(b, chips, 2, { type: 'check' });
    expect(bet.streetComplete(b)).toBe(true);
    expect(chips).toEqual([90, 90, 90]);
  });

  it('lets nobody raise once everyone else is all in: call or fold (as PokerKit agrees)', () => {
    const c = bet.newBetting(3, [false, false, false]);
    const stacks = [500, 60, 40];
    c.minRaise = 10;
    bet.act(c, stacks, 1, { type: 'allin' });
    bet.act(c, stacks, 2, { type: 'allin' });
    const o = bet.options(c, stacks, 0);
    expect(o.canRaise).toBe(false);
    expect(o.toCall).toBe(60);
    expect(() => bet.act(c, stacks, 0, { type: 'raise', to: 150 })).toThrow();
  });

  it('lets nobody raise when no one else could call more than the bet (a short stack still to act)', () => {
    // (a hand PokerKit caught: on the river one player is all in for 178, the one still to act has
    // only 115, so a raise to 316 could never be called by anybody)
    const stacks = [178, 316, 115];
    const b = bet.newBetting(3, [false, false, false]);
    b.minRaise = 10;
    bet.act(b, stacks, 0, { type: 'allin' });
    const o = bet.options(b, stacks, 1);
    expect(o.canRaise).toBe(false);
    expect(o.toCall).toBe(178);
    // with a player behind who could cover it, the raise is there
    const deep = [178, 316, 400];
    const c = bet.newBetting(3, [false, false, false]);
    c.minRaise = 10;
    bet.act(c, deep, 0, { type: 'allin' });
    expect(bet.options(c, deep, 1).canRaise).toBe(true);
  });

  it('reopens action after a raise and enforces the minimum raise', () => {
    const chips = [100, 100];
    const b = bet.newBetting(2, [false, false]);
    b.minRaise = 10;
    bet.act(b, chips, 0, { type: 'raise', to: 20 });
    expect(() => bet.act(b, chips, 1, { type: 'raise', to: 25 })).toThrow();
    bet.act(b, chips, 1, { type: 'raise', to: 40 });
    expect(bet.streetComplete(b)).toBe(false);
    bet.act(b, chips, 0, { type: 'call' });
    expect(bet.streetComplete(b)).toBe(true);
  });
});

describe('the result at a showdown', () => {
  it('says once when one player takes every pot, rather than once a pot', async () => {
    const { GAMES } = await import('./games');
    const g = GAMES.holdem as GameModule<{ result: { lines: string[] } | null }>;
    let merged = 0;
    for (let seed = 1; seed <= 40 && merged < 2; seed++) {
      let s = g.setup(
        Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, bot: true })),
        seed,
        { stack: 200 },
      );
      s.options.botLevel = 0;
      for (let i = 0; i < 4000 && s.phase !== 'gameOver'; i++) {
        const sys = g.system?.(s);
        const next = structuredClone(s);
        if (sys) sys.run(next);
        else {
          const seat = s.players.find((p) => g.bot!(s, p.seat))?.seat ?? s.players.find((p) => g.actions(s, p.seat).some((a) => a.type === 'next'))?.seat;
          if (seat == null) break;
          g.apply(next, seat, g.bot!(s, seat) ?? { type: 'next' });
        }
        if (next.phase === 'handOver' && s.phase !== 'handOver' && next.data.result) {
          const lines = next.data.result.lines;
          const who = lines.map((l) => /^(\S+) wins (main|side)/.exec(l)?.[1]);
          // never the same lone winner on every line
          expect(lines.length > 1 && who.every((w) => w && w === who[0])).toBe(false);
          if (/ wins every pot \(\d+\) with /.test(lines[0])) merged++;
        }
        s = next;
      }
    }
    expect(merged).toBeGreaterThan(0);
  });
});

describe('a showdown on the table', () => {
  /** Bots play a hand of `game` from `seed` until it ends; the state then. */
  async function toHandOver(game: string, players: number, seed: number) {
    const { GAMES } = await import('./games');
    const g = GAMES[game] as GameModule<{ b: { folded: boolean[] }; result: { winners: number[] } | null }>;
    let s = g.setup(
      Array.from({ length: players }, (_, i) => ({ name: `P${i}`, bot: true })),
      seed,
      {},
    );
    s.options.botLevel = 0;
    for (let i = 0; i < 2000 && s.phase !== 'handOver' && s.phase !== 'gameOver'; i++) {
      const sys = g.system?.(s);
      const next = structuredClone(s);
      if (sys) sys.run(next);
      else {
        const seat = s.players.find((p) => g.bot!(s, p.seat))?.seat;
        if (seat == null) break;
        g.apply(next, seat, g.bot!(s, seat)!);
      }
      s = next;
    }
    return { g, s };
  }

  it.each([
    ['holdem', ['hand']],
    ['seven-card-stud', ['hand', 'up']],
  ])('%s: the hands turned over go in the middle, winners first, labelled', async (game, zones) => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 3; seed++) {
      const { g, s } = await toHandOver(game, 3, seed);
      const shown = g.status(s, -1).showdown;
      if (!shown) continue;
      checked++;
      for (const x of shown) {
        expect(s.data.b.folded[x.seat]).toBe(false);
        expect(x.zones).toEqual(zones.map((z) => `${z}:${x.seat}`));
        // only cards everyone has seen
        expect(x.zones.flatMap((z) => s.zones[z].cards).every((c) => c.up !== false)).toBe(true);
        expect(x.label).toMatch(new RegExp(`^P${x.seat}( wins)? · `));
      }
      const won = shown.map((x) => s.data.result!.winners.includes(x.seat));
      expect(won).toEqual([...won].sort((a, b) => Number(b) - Number(a)));
      // a player sees their own hand at the bottom, not again in the middle
      for (const x of shown) expect(g.status(s, x.seat).showdown?.some((y) => y.seat === x.seat) ?? false).toBe(false);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('shows nothing when everyone else folded (no cards were turned over)', async () => {
    // (the bots think with Math.random, so which hands end in folds varies: look far enough that
    // one always turns up; it stops at the first)
    for (let seed = 1; seed <= 300; seed++) {
      const { g, s } = await toHandOver('holdem', 3, seed);
      if (s.data.b.folded.filter(Boolean).length !== 2) continue;
      expect(g.status(s, -1).showdown).toBeUndefined();
      return;
    }
    throw new Error('no hand ended with everyone else folding');
  });
});

describe('a tournament table', () => {
  type D = { handNo: number; button: number; sb: number; bb: number; ante?: number; b: bet.BettingState; before?: number[]; tourney?: boolean };
  const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));

  it('starts from the tournament’s stacks, button and blinds, with everyone’s ante in first', async () => {
    const { GAMES } = await import('./games');
    const g = GAMES.holdem as GameModule<D>;
    const chips = [1500, 900, 3000, 40, 2200];
    const s = g.setup(players(5), 3, {}, { chips, button: 2, blinds: { sb: 50, bb: 100, ante: 10 } });
    expect(s.data.button).toBe(2);
    expect(s.data.before).toEqual(chips);
    // seat 3 posts the small blind, seat 4 the big; everyone antes 10 first (seat 3 all in for 40)
    expect(s.data.b.committed).toEqual([10, 10, 10, 40, 110]);
    expect(s.players.map((p) => p.chips)).toEqual([1490, 890, 2990, 0, 2090]);
    expect(s.data.b.currentBet).toBe(100);
    expect(s.log.some((l) => /^Hand #1: everyone antes 10; P3 and P4 post blinds 50\/100$/.test(l.text))).toBe(true);
    expect(g.report!(s)).toEqual({ hand: 1, button: 2, stacks: [1490, 890, 2990, 0, 2090], before: chips });
  });

  it('the blinds go up between hands; the next hand is dealt by itself', async () => {
    const { GAMES } = await import('./games');
    const g = GAMES.holdem as GameModule<D>;
    let s = g.setup(players(3), 5, {}, { chips: [1000, 1000, 1000], button: 0, blinds: { sb: 10, bb: 20 } });
    s.options.botLevel = 0;
    for (let i = 0; i < 500 && s.phase !== 'handOver'; i++) {
      const seat = s.players.find((p) => g.bot!(s, p.seat))?.seat;
      const next = structuredClone(s);
      if (seat == null) g.system!(s)!.run(next);
      else g.apply(next, seat, g.bot!(s, seat)!);
      s = next;
    }
    expect(s.phase).toBe('handOver');
    g.adjust!(s, { blinds: { sb: 25, bb: 50, ante: 5 } });
    const step = g.system!(s)!;
    expect(step).toBeTruthy();
    step.run(s);
    expect(s.data.handNo ?? 0).toBeGreaterThan(0);
    expect([s.data.sb, s.data.bb, s.data.ante]).toEqual([25, 50, 5]);
    expect(Math.max(...s.data.b.bets)).toBe(50);
    expect(() => g.adjust!(s, { blinds: { sb: 60, bb: 50 } })).toThrow();
  });

  it('only flop games: a draw game won’t take a tournament’s blinds', async () => {
    const { GAMES } = await import('./games');
    const draw = Object.values(GAMES).find((m) => m.config.rules.family === 'poker' && (m.config.rules as { draw?: unknown }).draw)!;
    expect(() => draw.setup(players(4), 1, {}, { blinds: { sb: 5, bb: 10 } })).toThrow();
    // (and an ordinary game of Hold'em still waits for someone to deal)
    const { GAMES: all } = await import('./games');
    const s = all.holdem.setup([{ name: 'Ann' }, { name: 'Bo', bot: true }], 1, {});
    expect((s.data as D).tourney).toBeUndefined();
  });
});
