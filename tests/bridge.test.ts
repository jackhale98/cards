import { describe, expect, it } from 'vitest';
import { bridgeScore, type TrickData } from '../src/engine/families/trick';
import { endRound } from '../src/engine/families/trick/scoring';
import { trickGame } from '../src/engine/families/trick/types';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['bridge'] as GameModule<TrickData>;
const bots = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);
/** Bid index: level 1–7, strain C D H S NT. */
const bid = (level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT') => (level - 1) * 5 + ['C', 'D', 'H', 'S', 'NT'].indexOf(strain);

describe('bridge scoring', () => {
  it('scores made contracts', () => {
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 0 }, false, 10)).toBe(420);
    expect(bridgeScore({ level: 3, strain: 'NT', dbl: 0 }, false, 9)).toBe(400);
    expect(bridgeScore({ level: 3, strain: 'NT', dbl: 0 }, true, 10)).toBe(630);
    expect(bridgeScore({ level: 1, strain: 'NT', dbl: 0 }, false, 8)).toBe(120);
    expect(bridgeScore({ level: 2, strain: 'C', dbl: 0 }, false, 8)).toBe(90);
    expect(bridgeScore({ level: 2, strain: 'H', dbl: 1 }, false, 8)).toBe(470);
    expect(bridgeScore({ level: 2, strain: 'H', dbl: 1 }, true, 9)).toBe(870);
    expect(bridgeScore({ level: 1, strain: 'S', dbl: 2 }, false, 7)).toBe(520);
    expect(bridgeScore({ level: 6, strain: 'S', dbl: 0 }, true, 12)).toBe(1430);
    expect(bridgeScore({ level: 7, strain: 'NT', dbl: 0 }, false, 13)).toBe(1520);
    expect(bridgeScore({ level: 5, strain: 'D', dbl: 0 }, false, 11)).toBe(400);
  });

  it('scores undertricks for the defenders', () => {
    expect(bridgeScore({ level: 3, strain: 'C', dbl: 0 }, false, 7)).toBe(-100);
    expect(bridgeScore({ level: 3, strain: 'C', dbl: 0 }, true, 7)).toBe(-200);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 1 }, false, 7)).toBe(-500);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 1 }, false, 6)).toBe(-800);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 1 }, true, 8)).toBe(-500);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 2 }, false, 9)).toBe(-200);
  });
});

describe('bridge', () => {
  it('deals 13 each and the dealer calls first', () => {
    const s = g.setup(bots, 1, {});
    for (let i = 0; i < 4; i++) expect(ids(s, `hand:${i}`)).toHaveLength(13);
    expect(s.phase).toBe('call');
    expect(s.turn).toBe(s.dealer);
    expect(s.data.vul).toEqual([false, false]);
  });

  it('runs an auction with doubles; the first to name the strain declares', () => {
    const s = g.setup(bots, 2, {});
    const d0 = s.dealer; // seat 3
    const p = (k: number) => (d0 + k) % 4;
    g.apply(s, p(0), { type: 'call', amount: bid(1, 'H') });
    // the dealer's partner can't double their own side
    expect(g.actions(s, p(1)).some((a) => a.type === 'double')).toBe(true);
    g.apply(s, p(1), { type: 'call', amount: bid(1, 'S') });
    expect(() => g.apply(s, p(2), { type: 'call', amount: bid(1, 'D') })).toThrow();
    g.apply(s, p(2), { type: 'call', amount: bid(2, 'H') });
    expect(g.actions(s, p(3)).some((a) => a.type === 'double')).toBe(true);
    g.apply(s, p(3), { type: 'double' });
    expect(g.actions(s, p(0)).some((a) => a.type === 'redouble')).toBe(true);
    g.apply(s, p(0), { type: 'decline' });
    g.apply(s, p(1), { type: 'decline' });
    expect(s.phase).toBe('call');
    g.apply(s, p(2), { type: 'decline' });
    expect(s.phase).toBe('play');
    // hearts first named by the dealer → dealer declares 2♥ doubled, their partner is dummy
    expect(s.data.maker).toBe(p(0));
    expect(s.data.dummy).toBe(p(2));
    expect(s.data.bridge).toEqual({ level: 2, strain: 'H', dbl: 1 });
    expect(s.data.trump).toBe('H');
    expect(s.turn).toBe(p(1)); // left of declarer leads
  });

  it('redeals with the same dealer when all pass', () => {
    const s = g.setup(bots, 3, {});
    const dealer = s.dealer;
    for (let i = 0; i < 4; i++) g.apply(s, s.turn!, { type: 'decline' });
    expect(s.phase).toBe('call');
    expect(s.dealer).toBe(dealer);
    expect(s.data.calls).toEqual([]);
  });

  it('lays down the dummy after the opening lead; the declarer plays it', () => {
    const s = g.setup(bots, 4, {});
    const dealer = s.dealer;
    g.apply(s, dealer, { type: 'call', amount: bid(3, 'NT') });
    for (let i = 0; i < 3; i++) g.apply(s, s.turn!, { type: 'decline' });
    const declarer = dealer;
    const dummy = (declarer + 2) % 4;
    const leader = s.turn!;
    expect(ids(s, 'dummy')).toHaveLength(0);
    g.apply(s, leader, { type: 'play', cards: [g.actions(s, leader)[0].select!.cards[0]] });
    expect(ids(s, 'dummy')).toHaveLength(13);
    expect(ids(s, `hand:${dummy}`)).toHaveLength(0);
    expect(s.turn).toBe(dummy);
    // the dummy can't play; the declarer plays from the dummy
    expect(g.actions(s, dummy)).toEqual([]);
    const spec = g.actions(s, declarer).find((a) => a.type === 'play')!;
    expect(spec.label).toBe('Play from dummy');
    expect(spec.select!.cards.every((c) => ids(s, 'dummy').includes(c))).toBe(true);
    expect(() => g.apply(s, dummy, { type: 'play', cards: [spec.select!.cards[0]] })).toThrow();
    g.apply(s, declarer, { type: 'play', cards: [spec.select!.cards[0]] });
    expect(s.zones.trick.cards[1].by).toBe(dummy);
    expect(g.status(s, declarer).actor).toBe((dummy + 1) % 4);
    // the bot playing for a human declarer's dummy does nothing
    expect(g.bot!(s, dummy)).toBeNull();
  });

  it('rotates vulnerability Chicago-style and plays full games with bots', () => {
    for (const seed of [5, 6, 7]) {
      const s = g.setup(bots, seed, {});
      const vuls: string[] = [];
      let deals = 0;
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'call' && s.data.calls!.length === 0) vuls[s.data.round] = JSON.stringify(s.data.vul);
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        if (s.phase === 'roundOver') {
          deals++;
          expect(cardsIn(s)).toBe(52);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        if (seat < 0) throw new Error(`stuck in ${s.phase}`);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      expect(deals).toBe(3);
      // dealers 3, 0, 1, 2: deal 2 → the side not dealing (team 1), deal 3 → team 0, as pagat has it
      expect(vuls).toEqual(['[false,false]', '[false,true]', '[true,false]', '[true,true]']);
      expect(s.data.scores.some((x) => x > 0)).toBe(true);
    }
  });

  it('bots reach sensible contracts', () => {
    const levels: number[] = [];
    for (let seed = 10; seed < 60; seed++) {
      const s = g.setup(bots, seed, {});
      for (let i = 0; i < 200 && s.phase === 'call'; i++) g.apply(s, s.turn!, g.bot!(s, s.turn!)!);
      if (s.data.bridge) levels.push(s.data.bridge.level);
    }
    expect(levels.length).toBeGreaterThan(30);
    expect(Math.max(...levels)).toBeLessThanOrEqual(7);
    // mostly part-scores and games, with the odd slam
    expect(levels.filter((l) => l >= 6).length).toBeLessThan(levels.length / 5);
    expect(levels.filter((l) => l >= 3).length).toBeGreaterThan(0);
  });
});

describe('bridge headline', () => {
  it("leaves the contract to the declarer's badge, not the tip", () => {
    for (let seed = 1; seed < 20; seed++) {
      let s = g.setup(bots, seed, {});
      for (let i = 0; i < 400 && s.phase !== 'trickEnd' && s.phase !== 'gameOver'; i++) {
        const sys = g.system?.(s);
        const next = structuredClone(s);
        if (sys) sys.run(next);
        else {
          const seat = s.players.find((p) => g.bot!(s, p.seat))?.seat ?? s.players.find((p) => g.actions(s, p.seat).some((a) => a.type === 'next'))?.seat;
          if (seat == null) break;
          g.apply(next, seat, g.bot!(s, seat) ?? { type: 'next' });
        }
        s = next;
      }
      if (s.phase !== 'trickEnd' || s.turn != null) continue;
      const st = g.status(s, 0);
      const contract = st.seats[s.data.maker as number].badge!.match(/^Declarer (\S+)/)![1];
      expect(st.headline ?? '').not.toContain(contract);
      expect(st.headline ?? '').not.toContain(' by ');
      return;
    }
    throw new Error('no deal reached the end of a trick');
  });
});

describe('bridge: Chicago and rubber scoring (pagat)', () => {
  const tg = trickGame(g.config);
  const people = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` }));
  /** Score a deal: seat `maker` (team maker % 2) declared `level` `strain` and their side took `won` tricks. */
  function deal(s: GameState<TrickData>, maker: number, level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT', won: number, dbl: 0 | 1 | 2 = 0) {
    const d = s.data;
    d.bridge = { level, strain, dbl };
    d.maker = maker;
    d.tricks = [0, 1, 2, 3].map((i) => (i === maker ? won : i === (maker + 1) % 4 ? 13 - won : 0));
    const before = [...d.scores];
    endRound(tg, s);
    const gained = d.scores.map((x, ti) => x - before[ti]);
    if (s.phase === 'roundOver') {
      d.round++;
      d.honours = null;
    }
    return gained;
  }

  it('Chicago: part scores carry until a game, which wipes both out', () => {
    const s = g.setup(people, 1, {});
    expect(deal(s, 0, 2, 'H', 8)).toEqual([60, 0]); // no bonus for a part score before deal 4
    expect(s.data.below).toEqual([60, 0]);
    expect(deal(s, 1, 1, 'C', 7)).toEqual([0, 20]);
    expect(s.data.below).toEqual([60, 20]);
    // 2♠ makes 60 more: game, worth 300 (500 vulnerable)
    const vul = s.data.vul![0];
    expect(deal(s, 0, 2, 'S', 8)).toEqual([60 + (vul ? 500 : 300), 0]);
    expect(s.data.below).toEqual([0, 0]);
  });

  it('Chicago: a part score on the fourth deal adds 100, and part scores clear after four deals', () => {
    const s = g.setup(people, 1, { deals: 8 });
    s.data.round = 3;
    expect(deal(s, 0, 1, 'NT', 7)).toEqual([140, 0]);
    expect(s.data.below).toEqual([0, 0]);
  });

  it('rubber: a game makes your side vulnerable, and two games win the rubber', () => {
    const s = g.setup(people, 1, { style: 1 });
    expect(s.data.vul).toEqual([false, false]);
    expect(deal(s, 0, 4, 'S', 10)).toEqual([120, 0]); // no bonus for a game until the rubber
    expect(s.data.games).toEqual([1, 0]);
    expect(s.phase).toBe('roundOver');
    g.apply(s, 0, { type: 'next' });
    expect(s.data.vul).toEqual([true, false]);
    // vulnerable and down 1: 100 to the other side
    expect(deal(s, 0, 4, 'H', 9)).toEqual([0, 100]);
    g.apply(s, 0, { type: 'next' });
    // 3NT makes the second game: 100 + 700 for the rubber, 2–0
    expect(deal(s, 2, 3, 'NT', 9)).toEqual([800, 0]);
    expect(s.phase).toBe('gameOver');
    expect(s.winner!.sort()).toEqual([0, 2]);
  });

  it('rubber: bots play one to the end', () => {
    const s = g.setup(bots, 7, { style: 1 });
    for (let i = 0; i < 40000 && s.phase !== 'gameOver'; i++) {
      const sys = g.system?.(s);
      if (sys) sys.run(s);
      else if (s.phase === 'roundOver') g.apply(s, 0, { type: 'next' });
      else {
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        g.apply(s, seat, g.bot!(s, seat)!);
      }
    }
    expect(s.phase).toBe('gameOver');
    expect(Math.max(...s.data.games!)).toBe(2);
    expect(g.status(s, 0).scoreboard!.columns).toEqual(['Part score', 'Games', 'Total']);
  });

  it('rubber: 2–1 is worth 500', () => {
    const s = g.setup(people, 1, { style: 1 });
    s.data.games = [1, 1];
    expect(deal(s, 1, 5, 'D', 11)).toEqual([0, 100 + 500]);
    expect(s.phase).toBe('gameOver');
  });

  it('rubber: honours held by one player score, and only show when the hand is scored', () => {
    for (let seed = 1; seed < 400; seed++) {
      const s = g.setup(people, seed, { style: 1 });
      // find a dealt hand with four aces, then have that side's player declare no trumps
      const holder = [0, 1, 2, 3].find((i) => ids(s, `hand:${i}`).filter((c) => c[0] === 'A').length === 4);
      if (holder == null) continue;
      while (s.turn !== holder) g.apply(s, s.turn!, { type: 'decline' });
      g.apply(s, holder, { type: 'call', amount: bid(1, 'NT') });
      for (let k = 0; k < 3; k++) g.apply(s, s.turn!, { type: 'decline' });
      expect(s.data.honours).toMatchObject({ seat: holder, pts: 150 });
      expect(g.redactData!(s, holder).honours).toBeNull();
      expect(deal(s, holder, 1, 'NT', 7)[holder % 2]).toBe(40 + 150);
      return;
    }
    throw new Error('no hand with four aces');
  });
});
