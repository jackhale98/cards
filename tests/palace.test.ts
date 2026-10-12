import { describe, expect, it } from 'vitest';
import type { PalaceData } from '../src/engine/families/palace';
import { isHidden, redact } from '../src/engine/redact';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES.palace as GameModule<PalaceData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
const ids = (s: GameState<any>, z: string) => s.zones[z].cards.map((c) => c.id);

/** A 2-player game in play, with hands, table cards and pile set as given; seat 0 to move. */
function rig(opts: { h0: string[]; h1?: string[]; pile?: string[]; deck?: string[]; up0?: string[]; down0?: string[] }) {
  const s = g.setup(people(2), 1, {});
  for (const z of Object.values(s.zones)) z.cards = [];
  s.zones['hand:0'].cards = opts.h0.map((id) => ({ id }));
  s.zones['hand:1'].cards = (opts.h1 ?? ['3S', '4S', '5S']).map((id) => ({ id }));
  s.zones['up:1'].cards = [{ id: '6S', up: true }];
  s.zones['up:0'].cards = (opts.up0 ?? []).map((id) => ({ id, up: true }));
  s.zones['down:0'].cards = (opts.down0 ?? []).map((id) => ({ id, up: false }));
  s.zones.pile.cards = (opts.pile ?? []).map((id) => ({ id, up: true }));
  s.zones.deck.cards = (opts.deck ?? []).map((id) => ({ id }));
  s.data.ready = [true, true];
  s.phase = 'play';
  s.turn = 0;
  return s;
}

describe('palace (pagat: shithead)', () => {
  it('deals three down, three up and three in hand; face-down cards are hidden even from their owner', () => {
    const s = g.setup(people(3), 2, {});
    for (let i = 0; i < 3; i++) {
      expect(s.zones[`hand:${i}`].cards).toHaveLength(3);
      expect(s.zones[`up:${i}`].cards).toHaveLength(3);
      expect(s.zones[`down:${i}`].cards).toHaveLength(3);
    }
    expect(s.zones.deck.cards).toHaveLength(52 - 27);
    expect(redact(g, s, 0).zones['down:0'].cards.every((c) => isHidden(c.id))).toBe(true);
    // the face-down row only shows on the table once the face-up cards are gone
    expect(s.zones['down:0'].area).toBe('none');
    expect(s.phase).toBe('swap');
  });

  it('swaps a hand card with a face-up card, and play starts once everyone is ready', () => {
    const s = g.setup(people(2), 3, {});
    const h = ids(s, 'hand:0')[0];
    const u = ids(s, 'up:0')[0];
    g.apply(s, 0, { type: 'swap', cards: [h, u] });
    expect(ids(s, 'hand:0')).toContain(u);
    expect(ids(s, 'up:0')).toContain(h);
    g.apply(s, 0, { type: 'ready' });
    expect(s.phase).toBe('swap');
    g.apply(s, 1, { type: 'ready' });
    expect(s.phase).toBe('play');
  });

  it('must play equal or higher, then draws back up to three', () => {
    const s = rig({ h0: ['4H', '9H', '9D'], pile: ['8C'], deck: ['KS', 'QS'] });
    expect(() => g.apply(s, 0, { type: 'play', cards: ['4H'] })).toThrow();
    g.apply(s, 0, { type: 'play', cards: ['9H', '9D'] });
    expect(ids(s, 'pile')).toEqual(['8C', '9H', '9D']);
    expect(s.zones['hand:0'].cards).toHaveLength(3);
    expect(s.turn).toBe(1);
  });

  it('a 2 goes on anything and anything goes on it', () => {
    const s = rig({ h0: ['2H', '5C'], pile: ['KC'] });
    g.apply(s, 0, { type: 'play', cards: ['2H'] });
    g.apply(s, 1, { type: 'play', cards: ['3S'] });
    expect(ids(s, 'pile').at(-1)).toBe('3S');
  });

  it('a 10 burns the pile and the same player goes again', () => {
    const s = rig({ h0: ['TH', '5C'], pile: ['AC', 'KD'] });
    g.apply(s, 0, { type: 'play', cards: ['TH'] });
    expect(ids(s, 'pile')).toEqual([]);
    expect(ids(s, 'burned')).toHaveLength(3);
    expect(s.turn).toBe(0);
  });

  it('four of a kind on top burns, even built up by different players', () => {
    const s = rig({ h0: ['7H', '5C'], h1: ['7D', '3S'], pile: ['7C', '7S'] });
    g.apply(s, 0, { type: 'play', cards: ['7H'] });
    expect(s.turn).toBe(1);
    g.apply(s, 1, { type: 'play', cards: ['7D'] });
    expect(ids(s, 'pile')).toEqual([]);
    expect(s.turn).toBe(1); // completed it: plays again
  });

  it('can’t beat it: picks up the whole pile and the next player starts afresh', () => {
    const s = rig({ h0: ['4H'], pile: ['8C', 'KD'] });
    g.apply(s, 0, { type: 'pickup' });
    expect(ids(s, 'hand:0').sort()).toEqual(['4H', '8C', 'KD'].sort());
    expect(ids(s, 'pile')).toEqual([]);
    expect(s.turn).toBe(1);
  });

  it('table cards: face up once the hand is gone (adding one to pick up), then face down blind', () => {
    const s = rig({ h0: [], up0: ['5H'], down0: ['3C'], pile: ['9C'] });
    expect(g.actions(s, 0).map((a) => a.type)).toEqual(['play', 'pickup']);
    // can't beat the 9 with the 5: it goes on the pile, then everything comes up
    g.apply(s, 0, { type: 'pickup', cards: ['5H'] });
    expect(ids(s, 'hand:0').sort()).toEqual(['5H', '9C']);
    // with the face-up cards gone, the face-down row is drawn on the table
    expect(s.zones['down:0'].area).toBe('strip');
    // a face-down 3 turned over on a king doesn't go: picked up with the pile
    const t = rig({ h0: [], down0: ['3C', 'AD'], pile: ['KC'] });
    expect(g.actions(t, 0).map((a) => a.type)).toEqual(['flip']);
    g.apply(t, 0, { type: 'flip', cards: ['3C'] });
    expect(ids(t, 'hand:0').sort()).toEqual(['3C', 'KC']);
    expect(t.turn).toBe(1);
  });

  it('going out: the last player left holding cards loses', () => {
    const s = rig({ h0: [], down0: ['AD'], pile: ['KC'] });
    g.apply(s, 0, { type: 'flip', cards: ['AD'] });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([0]);
    expect(s.data.result!.lines.at(-1)).toMatch(/P1 is left holding the cards/);
    expect(g.standings!(s)).toEqual([1, 2]);
  });

  it('bots play whole games', () => {
    for (const n of [2, 3, 4, 5]) {
      const s = g.setup(bots(n), n * 7, {});
      for (let i = 0; i < 3000 && s.phase !== 'gameOver'; i++) {
        const seat = s.phase === 'swap' ? s.data.ready.indexOf(false) : s.turn!;
        if (seat < 0) break;
        const a = g.bot!(s, seat)!;
        expect(g.actions(s, seat).map((o) => o.type)).toContain(a.type);
        g.apply(s, seat, a);
      }
      expect(s.phase).toBe('gameOver');
      // every card is accounted for
      expect(Object.values(s.zones).reduce((k, z) => k + z.cards.length, 0)).toBe(52);
    }
  }, 120000);
});
