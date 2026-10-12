import { describe, expect, it } from 'vitest';
import { fits, type CornersData } from '../src/engine/families/corners';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['kings-corners'] as GameModule<CornersData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
const ids = (s: GameState<any>, z: string) => s.zones[z].cards.map((c) => c.id);

/** Two players; seat 0 to play with `hand`, piles set as given (bottom first). */
function rig(hand: string[], piles: Record<string, string[]>, stock = ['2C', '3C']) {
  const s = g.setup(people(2), 1, {});
  for (const z of Object.values(s.zones)) z.cards = [];
  s.zones['hand:0'].cards = hand.map((id) => ({ id }));
  s.zones['hand:1'].cards = ['KH', '5S'].map((id) => ({ id }));
  for (const [p, cs] of Object.entries(piles)) s.zones[p].cards = cs.map((id) => ({ id, up: true }));
  s.zones.deck.cards = stock.map((id) => ({ id }));
  s.turn = 0;
  return s;
}

describe('kings corners (pagat)', () => {
  it('deals seven each and turns up four piles', () => {
    const s = g.setup(people(3), 2, {});
    for (let i = 0; i < 3; i++) expect(s.zones[`hand:${i}`].cards).toHaveLength(7);
    for (const p of ['north', 'east', 'south', 'west']) expect(s.zones[p].cards).toHaveLength(1);
    for (const p of ['northEast', 'southEast', 'southWest', 'northWest']) expect(s.zones[p].cards).toHaveLength(0);
    expect(s.zones.deck.cards).toHaveLength(52 - 21 - 4);
  });

  it('builds down in alternating colours; nothing goes on an ace', () => {
    expect(fits('6H', '7S')).toBe(true);
    expect(fits('6S', '7S')).toBe(false);
    expect(fits('5H', '7S')).toBe(false);
    expect(fits('AH', '2C')).toBe(true);
    const s = rig(['6H', '6S', 'KD'], { north: ['7C'], east: ['AS'] });
    expect(() => g.apply(s, 0, { type: 'to:north', cards: ['6S'] })).toThrow();
    g.apply(s, 0, { type: 'to:north', cards: ['6H'] });
    expect(ids(s, 'north')).toEqual(['7C', '6H']);
    expect(g.actions(s, 0).find((a) => a.type === 'to:east')!.select!.cards).toEqual([]);
  });

  it('kings start the corners; any card from hand fills an empty side', () => {
    const s = rig(['KD', '9C', '4H'], { north: ['7C'] });
    expect(() => g.apply(s, 0, { type: 'to:northEast', cards: ['9C'] })).toThrow();
    g.apply(s, 0, { type: 'to:northEast', cards: ['KD'] });
    g.apply(s, 0, { type: 'to:east', cards: ['9C'] });
    expect(ids(s, 'northEast')).toEqual(['KD']);
    expect(ids(s, 'east')).toEqual(['9C']);
  });

  it('moves a whole pile when its bottom card fits, freeing the space', () => {
    const s = rig(['2C', '4H'], { north: ['8D', '7S'], east: ['6H', '5C'], northEast: ['KS'] });
    // the 6-5 pile goes onto the 7: select its top card and tap North
    g.apply(s, 0, { type: 'to:north', cards: ['5C'] });
    expect(ids(s, 'north')).toEqual(['8D', '7S', '6H', '5C']);
    expect(ids(s, 'east')).toEqual([]);
    // the freed space takes a card from hand
    g.apply(s, 0, { type: 'to:east', cards: ['4H'] });
    expect(ids(s, 'east')).toEqual(['4H']);
  });

  it('a king turned up at the start can move to a corner', () => {
    const s = rig(['3C'], { north: ['KH'], east: ['9C'] });
    g.apply(s, 0, { type: 'to:southWest', cards: ['KH'] });
    expect(ids(s, 'southWest')).toEqual(['KH']);
    // ... but corner piles don't wander between corners
    expect(() => g.apply(s, 0, { type: 'to:northWest', cards: ['KH'] })).toThrow();
  });

  it('drawing ends the turn; with no stock, everyone passing in turn ends the hand', () => {
    const s = rig(['3C', '9D'], { north: ['7C'] }, ['QH']);
    g.apply(s, 0, { type: 'draw' });
    expect(s.turn).toBe(1);
    expect(ids(s, 'hand:0')).toContain('QH');
    expect(g.actions(s, 1).map((a) => a.type)).toContain('pass');
    g.apply(s, 1, { type: 'pass' });
    g.apply(s, 0, { type: 'pass' });
    expect(s.phase).toBe('handOver');
    // penalties: 10 a king, 1 for other cards
    expect(s.data.scores).toEqual([3, 11]);
  });

  it('playing your last card wins the hand', () => {
    const s = rig(['6H'], { north: ['7C'] });
    g.apply(s, 0, { type: 'to:north', cards: ['6H'] });
    expect(s.phase).toBe('handOver');
    expect(s.data.scores).toEqual([0, 11]);
  });

  it('bots play whole games', () => {
    for (const n of [2, 4, 6]) {
      const s = g.setup(bots(n), n, { target: 25 });
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const a = g.bot!(s, s.turn!)!;
        expect(g.actions(s, s.turn!).map((o) => o.type)).toContain(a.type);
        g.apply(s, s.turn!, a);
      }
      expect(s.phase).toBe('gameOver');
      expect(Object.values(s.zones).reduce((k, z) => k + z.cards.length, 0)).toBe(52);
    }
  });
});
