import { describe, expect, it } from 'vitest';
import type { PokerData } from '../src/engine/families/poker';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES['five-card-draw'] as GameModule<PokerData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const opts = (o: Record<string, number | boolean> = {}) => ({ stack: 1000, ante: 10, jacks: false, aceFour: false, ...o });
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);
const chipsIn = (s: GameState<PokerData>) => s.players.reduce((n, p) => n + p.chips, 0) + s.data.b.committed.reduce((a, b) => a + b, 0) + (s.data.carry ?? 0);
const act = (s: GameState<PokerData>, type: string, extra: object = {}) => g.apply(s, s.turn!, { type, ...extra });

describe('five card draw (pagat)', () => {
  it('everyone antes and gets five cards; betting starts left of the dealer', () => {
    const s = g.setup(people(4), 1, opts());
    expect(s.players.every((p) => p.chips === 990)).toBe(true);
    for (let i = 0; i < 4; i++) expect(ids(s, `hand:${i}`)).toHaveLength(5);
    expect(s.turn).toBe((s.data.button + 1) % 4);
    expect(g.actions(s, s.turn!).map((a) => a.type)).toEqual(['fold', 'check', 'raise', 'allin']);
  });

  it('if everyone checks, the deal is thrown in and the pot carries over', () => {
    const s = g.setup(people(3), 1, opts());
    for (let i = 0; i < 3; i++) act(s, 'check');
    expect(s.phase).toBe('handOver');
    expect(s.data.carry).toBe(30);
    g.apply(s, 0, { type: 'next' });
    expect(g.status!(s, 0).pot).toBe(60);
    expect(chipsIn(s)).toBe(3000);
  });

  it('the draw: up to three cards from the dealer’s left, then the opener bets first', () => {
    const s = g.setup(people(3), 2, opts());
    const first = s.turn!;
    act(s, 'check');
    const opener = s.turn!;
    act(s, 'raise', { amount: 20 });
    act(s, 'call');
    act(s, 'call');
    expect(s.phase).toBe('draw');
    expect(s.turn).toBe(first);
    const max = g.actions(s, first).find((a) => a.type === 'draw')!.select!.max;
    expect(max).toBe(3);
    const before = ids(s, `hand:${first}`);
    expect(() => act(s, 'draw', { cards: before.slice(0, 4) })).toThrow();
    act(s, 'draw', { cards: before.slice(0, 2) });
    expect(ids(s, `hand:${first}`)).toHaveLength(5);
    expect(ids(s, `hand:${first}`).filter((c) => before.includes(c))).toHaveLength(3);
    act(s, 'standPat');
    act(s, 'draw', { cards: ids(s, `hand:${s.turn}`).slice(0, 3) });
    expect(s.phase).toBe('betting');
    expect(s.data.street).toBe(1);
    expect(s.turn).toBe(opener);
    act(s, 'check');
    act(s, 'check');
    act(s, 'check');
    expect(s.phase).toBe('handOver');
    expect(cardsIn(s)).toBe(52);
    expect(chipsIn(s)).toBe(3000);
  });

  it('option: draw four when keeping an ace', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = g.setup(people(2), seed, opts({ aceFour: true }));
      act(s, 'raise', { amount: 10 });
      act(s, 'call');
      const seat = s.turn!;
      const hand = ids(s, `hand:${seat}`);
      const ace = hand.find((c) => c.startsWith('A'));
      if (!ace) continue;
      expect(g.actions(s, seat).find((a) => a.type === 'draw')!.select!.max).toBe(4);
      expect(() => act(s, 'draw', { cards: [ace, ...hand.filter((c) => c !== ace).slice(0, 3)] })).toThrow(/keeping an ace/);
      act(s, 'draw', { cards: hand.filter((c) => c !== ace) });
      expect(ids(s, `hand:${seat}`)).toContain(ace);
      return;
    }
    throw new Error('no ace found');
  });

  it('option: jacks or better to open', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = g.setup(people(3), seed, opts({ jacks: true }));
      const hand = ids(s, `hand:${s.turn}`);
      const ranks = hand.map((c) => c[0]);
      const pairHigh = ranks.some((r, i) => ranks.indexOf(r) !== i);
      if (pairHigh) continue; // want a hand without even a pair
      expect(g.actions(s, s.turn!).map((a) => a.type)).toEqual(['fold', 'check']);
      expect(() => act(s, 'raise', { amount: 20 })).toThrow(/jacks or better/);
      return;
    }
    throw new Error('no plain hand found');
  });

  it('bots play whole games, conserving chips and cards, with up to seven players', () => {
    for (const n of [2, 4, 7]) {
      const s = g.setup(Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })), 10 + n, opts({ stack: 200, ante: 10, jacks: n >= 4 }));
      let hands = 0;
      for (let i = 0; i < 200000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          expect(chipsIn(s)).toBe(200 * n);
          expect(cardsIn(s)).toBe(52);
          hands++;
          g.apply(s, s.players.find((p) => p.chips > 0)!.seat, { type: 'next' });
          continue;
        }
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        const a = g.bot!(s, seat)!;
        expect(g.actions(s, seat).map((o) => o.type)).toContain(a.type);
        g.apply(s, seat, a);
      }
      expect(s.phase).toBe('gameOver');
      expect(hands).toBeGreaterThan(0);
      expect(s.players.filter((p) => p.chips > 0)).toHaveLength(1);
    }
  });
});
