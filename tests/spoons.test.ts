import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/games';
import type { GameModule, GameState } from '../src/engine/types';
import type { SpoonsData } from '../src/engine/families/spoons';

type S = GameState<SpoonsData>;
const spoons = GAMES['spoons'] as GameModule<SpoonsData>;
const fresh = (n = 3) => spoons.setup(Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), 5, {});
const hand = (s: S, seat: number) => s.zones[`hand:${seat}`].cards.map((c) => c.id);
const setHand = (s: S, seat: number, cards: string[]) => (s.zones[`hand:${seat}`].cards = cards.map((id) => ({ id })));
const types = (s: S, seat: number) => spoons.actions(s, seat).map((a) => a.type);

describe('spoons', () => {
  it('deals four each and one spoon fewer than players', () => {
    const s = fresh(4);
    expect([0, 1, 2, 3].map((i) => hand(s, i).length)).toEqual([4, 4, 4, 4]);
    expect(s.data.spoons).toBe(3);
  });

  it('passes cards along: the dealer draws, the last player discards', () => {
    const s = fresh(3);
    expect(types(s, 0)).toEqual(['take', 'spoon']); // the dealer, from the deck
    expect(types(s, 1)).toEqual(['spoon']); // nothing passed to them yet
    spoons.apply(s, 0, { type: 'take' });
    expect(types(s, 0)).toEqual(['pass', 'spoon']);
    expect(() => spoons.apply(s, 0, { type: 'take' })).toThrow();
    const c = hand(s, 0)[0];
    spoons.apply(s, 0, { type: 'pass', cards: [c] });
    expect(s.zones['in:1'].cards.map((x) => x.id)).toEqual([c]);
    spoons.apply(s, 1, { type: 'take' });
    spoons.apply(s, 1, { type: 'pass', cards: [c] });
    spoons.apply(s, 2, { type: 'take' });
    spoons.apply(s, 2, { type: 'pass', cards: [c] });
    expect(s.zones.discard.cards.map((x) => x.id)).toEqual([c]);
  });

  it('the deck refills from the discards', () => {
    const s = fresh(3);
    s.zones.discard.cards = s.zones.deck.cards.splice(0);
    const n = s.zones.discard.cards.length;
    spoons.apply(s, 0, { type: 'take' });
    expect(s.zones.deck.cards.length).toBe(n - 1);
    expect(s.zones.discard.cards).toHaveLength(0);
  });

  it('four of a kind takes the first spoon quietly; then anyone may grab, and the last gets a letter', () => {
    const s = fresh(3);
    setHand(s, 1, ['7S', '7H', '7D', '7C']);
    const logBefore = s.log.length;
    spoons.apply(s, 1, { type: 'spoon', race: s.data.race, rt: 3000, at: 1000 });
    spoons.system!(s)!.run(s);
    expect(s.data.has[1]).toBe(true);
    expect(s.log.length).toBe(logBefore); // nothing said
    // now P0 and P2 race for the last spoon: P2 arrives later, but reacted quicker
    const race = s.data.race;
    spoons.apply(s, 0, { type: 'spoon', race, rt: 900, at: 5000 });
    spoons.apply(s, 2, { type: 'spoon', race, rt: 600, at: 5200 });
    spoons.system!(s)!.run(s);
    expect(s.data.has[2]).toBe(true);
    expect(s.data.letters).toEqual([1, 0, 0]);
    expect(s.phase).toBe('roundOver');
    // the next round deals again, dealer moving on
    spoons.system!(s)!.run(s);
    expect(s.phase).toBe('play');
    expect(s.dealer).toBe(1);
    expect(s.data.has).toEqual([false, false, false]);
  });

  it('grabbing the first spoon without four of a kind costs a letter', () => {
    const s = fresh(3);
    setHand(s, 2, ['7S', '7H', '7D', '8C']);
    spoons.apply(s, 2, { type: 'spoon', race: s.data.race, rt: 300 });
    expect(s.data.letters).toEqual([0, 0, 1]);
    expect(s.phase).toBe('roundOver');
  });

  it('SPOON and you are out; the last one in wins', () => {
    const s = fresh(3);
    s.data.letters = [4, 4, 0];
    setHand(s, 0, ['2S', '3S', '4S', '5S']);
    spoons.apply(s, 0, { type: 'spoon', race: s.data.race });
    expect(s.data.out[0]).toBe(true);
    spoons.system!(s)!.run(s);
    // two left, one spoon
    expect(s.data.spoons).toBe(1);
    expect(hand(s, 0)).toEqual([]);
    expect(spoons.actions(s, 0)).toEqual([]);
    setHand(s, 1, ['2S', '3S', '4S', '5S']);
    spoons.apply(s, 1, { type: 'spoon', race: s.data.race });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([2]);
  });
});
