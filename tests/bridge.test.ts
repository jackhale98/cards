import { describe, expect, it } from 'vitest';
import { bridgeScore, type TrickData } from '../src/engine/families/trick';
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
      // dealers 3, 0, 1, 2: deal 2 → dealer 0's side (team 0), deal 3 → dealer 1's side (team 1)
      expect(vuls).toEqual(['[false,false]', '[true,false]', '[false,true]', '[true,true]']);
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
  it('names the contract cleanly when a trick has just been won (no stray "·" in front)', () => {
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
      const h = g.status(s, 0).headline!;
      expect(h).toMatch(/^\S/);
      expect(h.startsWith('·')).toBe(false);
      expect(h).toMatch(/ by P\d$/);
      return;
    }
    throw new Error('no deal reached the end of a trick');
  });
});
