import { describe, expect, it } from 'vitest';
import { climbRank, titleFor, type ClimbingData } from '../src/engine/families/climbing';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES['president'] as GameModule<ClimbingData>;
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

/** A rigged 4-player trick: seat 0 to lead. */
function rig(hands: string[][]) {
  const s = g.setup(bots(4), 1, {});
  for (const z of Object.values(s.zones)) z.cards = [];
  hands.forEach((h, i) => (s.zones[`hand:${i}`].cards = h.map((id) => ({ id }))));
  Object.assign(s.data, { top: null, last: null, passed: [false, false, false, false], finished: [] });
  s.phase = 'play';
  s.turn = 0;
  return s;
}

describe('president', () => {
  it('ranks 2 highest and 3 lowest, and names the titles', () => {
    expect(climbRank('2S')).toBeGreaterThan(climbRank('AS'));
    expect(climbRank('3S')).toBeLessThan(climbRank('4S'));
    expect([0, 1, 2, 3, 4].map((p) => titleFor(p, 5))).toEqual(['President', 'Vice-President', 'Citizen', 'Vice-Scum', 'Scum']);
    expect([0, 1, 2].map((p) => titleFor(p, 3))).toEqual(['President', 'Citizen', 'Scum']);
  });

  it('deals every card and the 3♣ leads the first hand', () => {
    const s = g.setup(bots(5), 3, {});
    expect(cardsIn(s)).toBe(52);
    expect(ids(s, `hand:${s.turn}`)).toContain('3C');
  });

  it('a play must match the count and be higher; passing players can come back', () => {
    const s = rig([['6S', '6H', 'KS'], ['5S', '5H', '9C', '9D'], ['7S', '7H', 'QC'], ['3D', '4D', 'AH', 'AS']]);
    g.apply(s, 0, { type: 'play', cards: ['6S', '6H'] });
    // seat 1 can't play a lower pair or a single
    expect(() => g.apply(s, 1, { type: 'play', cards: ['5S', '5H'] })).toThrow();
    expect(() => g.apply(s, 1, { type: 'play', cards: ['9C'] })).toThrow();
    expect(g.actions(s, 1).find((a) => a.type === 'play')!.select!.cards.sort()).toEqual(['9C', '9D']);
    g.apply(s, 1, { type: 'pass' });
    g.apply(s, 2, { type: 'play', cards: ['7S', '7H'] });
    g.apply(s, 3, { type: 'pass' });
    g.apply(s, 0, { type: 'pass' });
    // seat 1 passed earlier but may still play now
    g.apply(s, 1, { type: 'play', cards: ['9C', '9D'] });
    g.apply(s, 2, { type: 'pass' });
    g.apply(s, 3, { type: 'play', cards: ['AH', 'AS'] });
    g.apply(s, 0, { type: 'pass' });
    g.apply(s, 1, { type: 'pass' });
    g.apply(s, 2, { type: 'pass' });
    // everyone passed: the aces win and seat 3 leads anything
    expect(s.turn).toBe(3);
    expect(s.data.top).toBeNull();
    expect(ids(s, 'pile')).toEqual([]);
  });

  it('players who go out are skipped; the last holding cards is the Scum', () => {
    const s = rig([['KS'], ['3S', '4S'], ['5S', '6S'], ['7S', '8S']]);
    g.apply(s, 0, { type: 'play', cards: ['KS'] }); // out: President
    expect(s.data.finished).toEqual([0]);
    for (const seat of [1, 2, 3]) g.apply(s, seat, { type: 'pass' });
    // seat 0 is out, so the next player leads
    expect(s.turn).toBe(1);
    g.apply(s, 1, { type: 'play', cards: ['3S'] });
    g.apply(s, 2, { type: 'play', cards: ['5S'] });
    g.apply(s, 3, { type: 'play', cards: ['8S'] });
    g.apply(s, 1, { type: 'pass' });
    g.apply(s, 2, { type: 'pass' });
    expect(s.turn).toBe(3);
    g.apply(s, 3, { type: 'play', cards: ['7S'] }); // out: Vice-President
    g.apply(s, 1, { type: 'pass' });
    g.apply(s, 2, { type: 'pass' });
    // seat 3 is out, so seat 1 leads; seat 1 then goes out and seat 2 is left holding a card
    g.apply(s, 1, { type: 'play', cards: ['4S'] });
    expect(s.phase).toBe('handOver');
    expect(s.data.finished).toEqual([0, 3, 1, 2]);
    expect(s.data.titles).toEqual(['President', 'Vice-Scum', 'Scum', 'Vice-President']);
    expect(s.data.points).toEqual([2, 0, 0, 1]);
  });

  it('next hand the Scum hands over their best 2 and the President gives back 2', () => {
    const s = g.setup(bots(4), 5, {});
    s.data.titles = ['Scum', 'President', 'Vice-Scum', 'Vice-President'];
    s.phase = 'handOver';
    g.apply(s, 0, { type: 'next' });
    expect(s.phase).toBe('swap');
    expect(s.data.owed).toEqual([
      { from: 1, to: 0, count: 2 },
      { from: 3, to: 2, count: 1 },
    ]);
    // the President got the Scum's two best cards
    const best = Math.max(...ids(s, 'hand:0').map(climbRank));
    expect(s.data.received[1].map(climbRank).every((r) => r >= best)).toBe(true);
    const give = ids(s, 'hand:1').slice(0, 2);
    g.apply(s, 1, { type: 'giveBack', cards: give });
    expect(s.phase).toBe('swap');
    g.apply(s, 3, { type: 'giveBack', cards: ids(s, 'hand:3').slice(0, 1) });
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1); // the President leads
    expect(ids(s, 'hand:0')).toEqual(expect.arrayContaining(give));
    expect(cardsIn(s)).toBe(52);
  });

  it('plays whole games with bots for 3 to 8 players', () => {
    for (const n of [3, 4, 5, 8]) {
      const s = g.setup(bots(n), 20 + n, {});
      let hands = 0;
      for (let i = 0; i < 50000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          hands++;
          expect(cardsIn(s)).toBe(52);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        if (seat < 0) throw new Error(`stuck in ${s.phase}`);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      expect(Math.max(...s.data.points)).toBeGreaterThanOrEqual(11);
      expect(hands).toBeGreaterThan(4);
    }
  });
});
