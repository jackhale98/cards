import { describe, expect, it } from 'vitest';
import { GAMES } from './games';
import type { GameModule, GameState } from '../src/engine/types';
import { fits, type SpitData } from '../src/engine/families/spit';

type S = GameState<SpitData>;
const spit = GAMES['spit'] as GameModule<SpitData>;
const fresh = () => spit.setup([{ name: 'Ann' }, { name: 'Ben' }], 3, {});
const tops = (s: S, seat: number) => s.zones[`hand:${seat}`].cards;
const centre = (s: S, z: 'left' | 'right') => s.zones[z].cards;
/** Set a player's stock: `piles[g]` lists the cards of pile g, top last. */
function stock(s: S, seat: number, piles: string[][], spitCards: string[] = []) {
  s.zones[`hand:${seat}`].cards = piles.flatMap((p, g) => (p.length ? [{ id: p.at(-1)!, up: true, group: g }] : []));
  s.zones[`under:${seat}`].cards = piles.flatMap((p, g) => p.slice(0, -1).map((id) => ({ id, group: g })));
  s.zones[`spit:${seat}`].cards = spitCards.map((id) => ({ id }));
}

describe('spit', () => {
  it('ranks fit one up or down, with ace and king together', () => {
    expect(fits('7H', '8S')).toBe(true);
    expect(fits('7H', '6S')).toBe(true);
    expect(fits('7H', '7S')).toBe(false);
    expect(fits('AH', 'KS')).toBe(true);
    expect(fits('AH', '2S')).toBe(true);
    expect(fits('KH', 'QS')).toBe(true);
  });

  it('lays out five piles of 1 to 5 and keeps 11 to spit', () => {
    const s = fresh();
    for (const i of [0, 1]) {
      expect(tops(s, i).map((c) => c.group)).toEqual([0, 1, 2, 3, 4]);
      expect(s.zones[`under:${i}`].cards).toHaveLength(10);
      expect(s.zones[`spit:${i}`].cards).toHaveLength(11);
    }
  });

  it('both call Spit! to turn up the middle cards', () => {
    const s = fresh();
    expect(spit.actions(s, 0).map((a) => a.type)).toEqual(['spit']);
    spit.apply(s, 0, { type: 'spit' });
    expect(centre(s, 'left')).toHaveLength(0);
    expect(spit.actions(s, 0)).toEqual([]);
    spit.apply(s, 1, { type: 'spit' });
    expect(centre(s, 'left')).toHaveLength(1);
    expect(centre(s, 'right')).toHaveLength(1);
  });

  it('plays a top card, turns up the next, and anyone can play at any time', () => {
    const s = fresh();
    stock(s, 0, [['2C', '8H'], ['3C'], [], [], []], ['9D']);
    stock(s, 1, [['4C'], ['QD', '6H'], [], [], []], ['5D']);
    s.zones.left.cards = [{ id: '7S', up: true }];
    s.zones.right.cards = [{ id: 'KS', up: true }];
    spit.apply(s, 1, { type: 'play0', cards: ['6H'] }); // Ben on 7
    expect(tops(s, 1).map((c) => c.id)).toEqual(['4C', 'QD']);
    // Ann's 8 no longer fits the left pile
    expect(() => spit.apply(s, 0, { type: 'play0', cards: ['8H'] })).toThrow(/Too slow/);
    // a swipe finds the pile that fits
    spit.apply(s, 1, { type: 'play', cards: ['QD'] });
    expect(centre(s, 'right').at(-1)!.id).toBe('QD');
  });

  it('moves a top card into an empty space', () => {
    const s = fresh();
    stock(s, 0, [['2C', '8H'], [], [], [], []], ['9D']);
    stock(s, 1, [['4C'], [], [], [], []], ['5D']);
    s.zones.left.cards = [{ id: 'TS', up: true }];
    s.zones.right.cards = [{ id: 'TH', up: true }];
    expect(spit.actions(s, 0).map((a) => a.type)).toContain('move');
    spit.apply(s, 0, { type: 'move', cards: ['8H'] });
    expect(tops(s, 0).map((c) => [c.id, c.group])).toEqual([
      ['2C', 0],
      ['8H', 1],
    ]);
    expect(spit.actions(s, 0).map((a) => a.type)).not.toContain('move');
  });

  it('clearing your piles starts a slap: the quickest takes the pile they slap', () => {
    const s = fresh();
    stock(s, 0, [['8H'], [], [], [], []], ['9D', '2D']);
    stock(s, 1, [['4C'], ['QD'], [], [], []], ['5D']);
    s.zones.left.cards = [{ id: '7S', up: true }];
    s.zones.right.cards = [
      { id: 'KS', up: true },
      { id: 'AS', up: true },
      { id: '2S', up: true },
    ];
    spit.apply(s, 0, { type: 'play0', cards: ['8H'] });
    expect(s.phase).toBe('slap');
    const race = s.data.race;
    spit.apply(s, 1, { type: 'slap0', race, rt: 400, at: 1000 });
    spit.apply(s, 0, { type: 'slap0', race, rt: 250, at: 1100 });
    spit.system!(s)!.run(s);
    // Ann took the left (2 cards) with her spit pile (2); Ben the right (3) with his 3
    const count = (i: number) => tops(s, i).length + s.zones[`under:${i}`].cards.length + s.zones[`spit:${i}`].cards.length;
    expect([count(0), count(1)]).toEqual([4, 6]);
    expect(s.phase).toBe('play');
    expect(s.data.round).toBe(2);
    // under 15 cards: what you can lay out, and no spit pile
    expect(s.zones['spit:0'].cards).toHaveLength(0);
  });

  it('clear your piles with no spit pile and you win', () => {
    const s = fresh();
    stock(s, 0, [['8H'], [], [], [], []]);
    stock(s, 1, [['4C'], [], [], [], []], ['5D']);
    s.zones.left.cards = [{ id: '7S', up: true }];
    s.zones.right.cards = [{ id: 'KS', up: true }];
    spit.apply(s, 0, { type: 'play', cards: ['8H'] });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([0]);
  });
});
