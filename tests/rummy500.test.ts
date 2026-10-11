import { describe, expect, it } from 'vitest';
import { asMeld, canUse, findMelds, handValue, meldValue, type Rummy500Data } from '../src/engine/families/rummy500';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES['rummy-500'] as GameModule<Rummy500Data>;
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

describe('rummy 500 melds', () => {
  it('knows sets and runs, ace high or low but not around the corner', () => {
    expect(asMeld(['7S', '7H', '7D'])?.kind).toBe('set');
    expect(asMeld(['7S', '7H', '7S#2'])).toBeNull(); // two decks: suits must differ
    expect(asMeld(['5H', '3H', '4H'])?.cards).toEqual(['3H', '4H', '5H']);
    expect(asMeld(['AH', '2H', '3H'])?.cards).toEqual(['AH', '2H', '3H']);
    expect(asMeld(['QH', 'AH', 'KH'])?.cards).toEqual(['QH', 'KH', 'AH']);
    expect(asMeld(['KH', 'AH', '2H'])).toBeNull();
    expect(asMeld(['5H', '6H', '8H'])).toBeNull();
    expect(asMeld(['5H', '6D', '7H'])).toBeNull();
  });

  it('scores aces 15, or 1 in a low run', () => {
    expect(handValue('AS')).toBe(15);
    expect(handValue('KS')).toBe(10);
    expect(handValue('7S')).toBe(7);
    expect(meldValue('AH', { kind: 'run', cards: ['AH', '2H', '3H'] })).toBe(1);
    expect(meldValue('AH', { kind: 'run', cards: ['QH', 'KH', 'AH'] })).toBe(15);
  });

  it('can tell whether a card can be used', () => {
    expect(canUse('7S', ['7S', '7H', '7D'], [])).toBe(true);
    expect(canUse('7S', ['7S', '8S', '9S'], [])).toBe(true);
    expect(canUse('AS', ['AS', 'KS', 'QS'], [])).toBe(true);
    expect(canUse('AS', ['AS', '2S', '3S'], [])).toBe(true);
    expect(canUse('AS', ['AS', 'KS', '2S'], [])).toBe(false);
    expect(canUse('9H', ['9H', '2C'], [{ cards: ['6H', '7H', '8H'] }])).toBe(true);
    expect(findMelds(['7S', '7H', '7D', '2C', '3C', '4C', 'KD'])).toHaveLength(2);
  });
});

describe('rummy 500', () => {
  it('deals 7 each (13 for two), with two decks for five or more', () => {
    expect(ids(g.setup(bots(2), 1, {}), 'hand:0')).toHaveLength(13);
    const s4 = g.setup(bots(4), 1, {});
    expect(ids(s4, 'hand:0')).toHaveLength(7);
    expect(cardsIn(s4)).toBe(52);
    expect(cardsIn(g.setup(bots(5), 1, {}))).toBe(104);
  });

  /** A rigged 3-player hand: seat 1 to draw. */
  function rig() {
    const s = g.setup(bots(3), 2, {});
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['hand:0'].cards = ['2C', '9D'].map((id) => ({ id }));
    s.zones['hand:1'].cards = ['7H', '8H', 'KS', '4D'].map((id) => ({ id }));
    s.zones['hand:2'].cards = ['3S', '5S'].map((id) => ({ id }));
    s.zones.discard.cards = ['9H', 'QC', 'JD'].map((id) => ({ id, up: true }));
    s.zones.deck.cards = ['2D', '3D', '4C'].map((id) => ({ id }));
    s.phase = 'draw';
    s.turn = 1;
    return s;
  }

  it('takes a deep card only if it can be melded, and then must meld it', () => {
    const s = rig();
    const take = g.actions(s, 1).find((a) => a.type === 'take')!;
    // the top card always; the 9♥ (with 7♥ 8♥ in hand) but not the Q♣
    expect(take.select!.cards.sort()).toEqual(['9H', 'JD'].sort());
    expect(() => g.apply(s, 1, { type: 'take', cards: ['QC'] })).toThrow();
    g.apply(s, 1, { type: 'take', cards: ['9H'] });
    expect(ids(s, 'hand:1')).toEqual(expect.arrayContaining(['9H', 'QC', 'JD']));
    expect(ids(s, 'discard')).toEqual([]);
    expect(g.actions(s, 1).some((a) => a.type === 'discard')).toBe(false);
    expect(() => g.apply(s, 1, { type: 'meld', cards: ['7H', '8H', 'KS'] })).toThrow();
    g.apply(s, 1, { type: 'meld', cards: ['7H', '8H', '9H'] });
    expect(g.actions(s, 1).some((a) => a.type === 'discard')).toBe(true);
    // someone else can lay off on it, and scores that card
    g.apply(s, 1, { type: 'discard', cards: ['KS'] });
    s.zones['hand:2'].cards.push({ id: '6H' });
    g.apply(s, 2, { type: 'draw' });
    g.apply(s, 2, { type: 'layoff', cards: ['6H', '8H'] });
    expect(s.data.melds[0].cards).toEqual(['6H', '7H', '8H', '9H']);
    expect(s.data.scoredBy['6H']).toBe(2);
  });

  it('a single top card can be kept but not thrown straight back', () => {
    const s = rig();
    g.apply(s, 1, { type: 'take', cards: ['JD'] });
    expect(s.data.mustMeld).toBeNull();
    expect(() => g.apply(s, 1, { type: 'discard', cards: ['JD'] })).toThrow();
    g.apply(s, 1, { type: 'discard', cards: ['4D'] });
    expect(s.turn).toBe(2);
  });

  it('ends the hand when someone goes out, scoring melds minus hands', () => {
    const s = rig();
    s.zones['hand:1'].cards = ['7H', '8H', 'KS'].map((id) => ({ id }));
    s.zones.discard.cards = ['9H'].map((id) => ({ id, up: true }));
    g.apply(s, 1, { type: 'take', cards: ['9H'] });
    g.apply(s, 1, { type: 'meld', cards: ['7H', '8H', '9H'] });
    g.apply(s, 1, { type: 'discard', cards: ['KS'] });
    expect(s.phase).toBe('handOver');
    // seat 1: +24 melded; seat 0 holds 2♣ 9♦ (−11); seat 2 holds 3♠ 5♠ (−8)
    expect(s.data.scores).toEqual([-11, 24, -8]);
  });

  it('plays whole games with bots for 2 to 6 players', () => {
    for (const n of [2, 3, 4, 6]) {
      const s = g.setup(bots(n), 10 + n, { target: 200 });
      let hands = 0;
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          hands++;
          expect(cardsIn(s)).toBe(n >= 5 ? 104 : 52);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        if (seat < 0) throw new Error(`stuck in ${s.phase}`);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(200);
      expect(hands).toBeGreaterThan(0);
    }
  });
});
