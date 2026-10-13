import { describe, expect, it } from 'vitest';
import { eightsPoints, type EightsData } from '../src/engine/families/eights';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['crazy-eights'] as GameModule<EightsData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);
const types = (s: GameState<EightsData>, seat: number) => g.actions(s, seat).map((a) => a.type);

/** Seat 0 to play on `top`, with the given hands and stock. */
function rig(hands: string[][], top: string, stock = ['2D', '3D', '4D', '5D', '6D', '7D'], opts: Record<string, boolean | number> = {}) {
  const s = g.setup(people(hands.length), 1, { specials: true, lastCard: true, target: 100, ...opts });
  for (const z of Object.values(s.zones)) z.cards = [];
  hands.forEach((h, i) => (s.zones[`hand:${i}`].cards = h.map((id) => ({ id }))));
  s.zones.table.cards = [{ id: top, up: true }];
  s.zones.deck.cards = stock.map((id) => ({ id }));
  Object.assign(s.data, { suit: top.slice(-1), dir: 1, pendingDraw: 0, announced: hands.map(() => false), unannounced: null });
  s.phase = 'play';
  s.turn = 0;
  return s;
}

describe('crazy eights (pagat)', () => {
  it('deals five each, seven with two players', () => {
    expect(ids(g.setup(people(4), 1, {}), 'hand:0')).toHaveLength(5);
    expect(ids(g.setup(people(2), 1, {}), 'hand:0')).toHaveLength(7);
    expect(cardsIn(g.setup(people(4), 1, {}))).toBe(52);
  });

  it('match rank or suit; an eight goes on anything and calls the suit', () => {
    const s = rig(
      [
        ['9H', 'KC', '8S', '4D'],
        ['2C', '3C', 'QC'],
        ['5S', '6S'],
      ],
      'KH',
    );
    const play = g.actions(s, 0).find((a) => a.type === 'play')!;
    expect(play.select!.cards.sort()).toEqual(['9H', 'KC'].sort());
    expect(g.actions(s, 0).find((a) => a.type === 'eight')!.select!.cards).toEqual(['8S']);
    expect(() => g.apply(s, 0, { type: 'play', cards: ['4D'] })).toThrow();
    expect(() => g.apply(s, 0, { type: 'eight', cards: ['8S'] })).toThrow(/Call a suit/);
    g.apply(s, 0, { type: 'eight', cards: ['8S'], amount: 3 }); // clubs
    expect(s.data.suit).toBe('C');
    // after an eight: the called suit or another eight (not the eight's rank-mates otherwise)
    expect(
      g
        .actions(s, 1)
        .find((a) => a.type === 'play')!
        .select!.cards.sort(),
    ).toEqual(['2C', '3C', 'QC'].sort());
  });

  it('you may draw instead of playing; drawing ends your turn', () => {
    const s = rig([['9H', 'KC'], ['2C'], ['5S']], 'KH');
    expect(types(s, 0)).toContain('draw');
    g.apply(s, 0, { type: 'draw' });
    expect(ids(s, 'hand:0')).toHaveLength(3);
    expect(s.turn).toBe(1);
  });

  it('say “last card” before the next player moves, or draw two', () => {
    const s = rig(
      [
        ['9H', 'KH'],
        ['2H', '3C', '4C'],
        ['5S', '6S'],
      ],
      'QH',
      undefined,
      { specials: false },
    );
    g.apply(s, 0, { type: 'play', cards: ['9H'] });
    expect(s.data.unannounced).toBe(0);
    expect(types(s, 0)).toEqual(['lastCard']);
    g.apply(s, 1, { type: 'play', cards: ['2H'] }); // too late
    expect(ids(s, 'hand:0')).toHaveLength(3);

    const t = rig(
      [
        ['9H', 'KH'],
        ['2H', '3C', '4C'],
        ['5S', '6S'],
      ],
      'QH',
      undefined,
      { specials: false },
    );
    expect(types(t, 0)).toContain('lastCard'); // can say it before playing
    g.apply(t, 0, { type: 'lastCard' });
    g.apply(t, 0, { type: 'play', cards: ['9H'] });
    g.apply(t, 1, { type: 'play', cards: ['2H'] });
    expect(ids(t, 'hand:0')).toEqual(['KH']);
  });

  it('special cards: queen skips, ace reverses, twos stack', () => {
    const q = rig([['QH', '3S'], ['4H'], ['5H'], ['6H']], '9H');
    g.apply(q, 0, { type: 'lastCard' });
    g.apply(q, 0, { type: 'play', cards: ['QH'] });
    expect(q.turn).toBe(2);

    const a = rig([['AH', '3S'], ['4H'], ['5H'], ['6H']], '9H');
    g.apply(a, 0, { type: 'lastCard' });
    g.apply(a, 0, { type: 'play', cards: ['AH'] });
    expect(a.turn).toBe(3);

    const two = rig(
      [
        ['2H', '3S', '4S'],
        ['2C', '8C', '5D'],
        ['9D', '8D', 'KD'],
      ],
      '9H',
    );
    g.apply(two, 0, { type: 'play', cards: ['2H'] });
    // only a two will do (not even an eight)
    expect(g.actions(two, 1).find((x) => x.type === 'play')!.select!.cards).toEqual(['2C']);
    expect(g.actions(two, 1).some((x) => x.type === 'eight')).toBe(false);
    g.apply(two, 1, { type: 'play', cards: ['2C'] });
    expect(g.actions(two, 2).find((x) => x.type === 'draw')!.label).toBe('Draw 4');
    g.apply(two, 2, { type: 'draw' });
    expect(ids(two, 'hand:2')).toHaveLength(7);
    expect(two.turn).toBe(0);
  });

  it('a special card played to go out has no effect; the others score what they hold', () => {
    const s = rig([['2H'], ['8C', 'KD', '5S'], ['AS']], '9H');
    s.data.announced[0] = true;
    g.apply(s, 0, { type: 'play', cards: ['2H'] });
    expect(s.phase).toBe('handOver');
    expect(s.data.scores).toEqual([0, 50 + 10 + 5, 1]);
    expect([8, 13, 5, 14].map((r) => eightsPoints(`${r === 13 ? 'K' : r === 14 ? 'A' : r}S`))).toEqual([50, 10, 5, 1]);
  });

  it('an empty stock is rebuilt from the pile under its top card', () => {
    const s = rig([['3S', '4S'], ['5S'], ['6S']], '9H', []);
    s.zones.table.cards = ['TC', 'JC', '9H'].map((id) => ({ id, up: true }));
    g.apply(s, 0, { type: 'draw' });
    expect(ids(s, 'table')).toEqual(['9H']);
    expect(ids(s, 'hand:0')).toHaveLength(3);
    expect(ids(s, 'deck')).toHaveLength(1);
  });

  it('a turned-up eight lets the dealer call the suit', () => {
    for (let seed = 1; seed < 400; seed++) {
      const s = g.setup(people(3), seed, {});
      if (!ids(s, 'table')[0].startsWith('8')) continue;
      expect(s.phase).toBe('nominate');
      expect(s.turn).toBe(s.dealer);
      g.apply(s, s.dealer, { type: 'nominate', amount: 1 });
      expect(s.data.suit).toBe('H');
      expect(s.turn).toBe((s.dealer + 1) % 3);
      return;
    }
    throw new Error('no seed turned up an eight');
  });

  it('bots play whole games to the target', () => {
    for (const n of [2, 4, 8]) {
      const s = g.setup(
        Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })),
        n,
        {},
      );
      for (let i = 0; i < 50000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          expect(cardsIn(s)).toBe(n >= 6 ? 104 : 52);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(100);
    }
  });
});
