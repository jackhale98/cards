import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/engine/cards';
import { avondale, type TrickData } from '../src/engine/families/trickTaking';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES['five-hundred'] as GameModule<TrickData>;
const bots = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

/** Find a bid's option value from the "Bid" action. */
function bidValue(s: GameState<TrickData>, seat: number, label: string) {
  const opt = g.actions(s, seat).find((a) => a.type === 'bid500')!.choose!.options.find((o) => o.label.startsWith(label));
  return opt!.value;
}

describe('500', () => {
  it('uses a 43-card deck: 10 each and a kitty of 3', () => {
    expect(buildDeck(g.config.deck)).toHaveLength(43);
    const s = g.setup(bots, 1, {});
    for (let i = 0; i < 4; i++) expect(ids(s, `hand:${i}`)).toHaveLength(10);
    expect(ids(s, 'deck')).toHaveLength(3);
    expect(s.phase).toBe('auction');
  });

  it('follows the Avondale schedule', () => {
    expect(avondale(6, 'S')).toBe(40);
    expect(avondale(6, 'NT')).toBe(120);
    expect(avondale(7, 'H')).toBe(200);
    expect(avondale(10, 'NT')).toBe(520);
  });

  it('runs an auction: bids must rise, passing is final, the winner takes the kitty', () => {
    const s = g.setup(bots, 2, {});
    const first = s.turn!;
    g.apply(s, first, { type: 'bid500', amount: bidValue(s, first, '7\u2009♠') });
    const second = s.turn!;
    expect(g.actions(s, second).find((a) => a.type === 'bid500')!.choose!.options.every((o) => Number(o.label.split('· ')[1]) > 140)).toBe(true);
    g.apply(s, second, { type: 'decline' });
    g.apply(s, s.turn!, { type: 'decline' });
    g.apply(s, s.turn!, { type: 'decline' });
    // three passes: the 7♠ bidder wins
    expect(s.phase).toBe('discard');
    expect(s.turn).toBe(first);
    expect(ids(s, `hand:${first}`)).toHaveLength(13);
    expect(s.data.trump).toBe('S');
    g.apply(s, first, { type: 'bury', cards: ids(s, `hand:${first}`).slice(0, 3) });
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(first); // the declarer leads
  });

  it('redeals when nobody bids', () => {
    const s = g.setup(bots, 3, {});
    const dealer = s.dealer;
    for (let i = 0; i < 4; i++) g.apply(s, s.turn!, { type: 'decline' });
    expect(s.dealer).toBe((dealer + 1) % 4);
    expect(s.phase).toBe('auction');
  });

  it('the joker wins in no trumps and can only be played when void', () => {
    const s = g.setup(bots, 4, {});
    for (const z of Object.values(s.zones)) z.cards = [];
    Object.assign(s.data, { trump: null, maker: 0, contract: { tricks: 6, suit: 'NT', value: 120 }, trickNo: 9, handSize: 10, tricks: [0, 0, 0, 0] });
    s.zones['hand:0'].cards = [{ id: 'AH' }];
    s.zones['hand:1'].cards = [{ id: 'X1' }, { id: 'KH' }];
    s.zones['hand:2'].cards = [{ id: '5C' }];
    s.zones['hand:3'].cards = [{ id: '6C' }];
    s.phase = 'play';
    s.turn = 0;
    g.apply(s, 0, { type: 'play', cards: ['AH'] });
    // seat 1 has a heart, so the joker can't be played
    expect(g.actions(s, 1).find((a) => a.type === 'play')!.select!.cards).toEqual(['KH']);
    s.zones['hand:1'].cards = [{ id: 'X1' }];
    g.apply(s, 1, { type: 'play', cards: ['X1'] });
    g.apply(s, 2, { type: 'play', cards: ['5C'] });
    g.apply(s, 3, { type: 'play', cards: ['6C'] });
    g.system!(s)!.run(s);
    expect(s.data.tricks[1]).toBe(1);
  });

  it('scores contracts, slams, and defenders per trick', () => {
    const finish = (contract: { tricks: number; suit: 'S' | 'NT'; value: number }, makerTricks: number, scores = [0, 0]) => {
      const s = g.setup(bots, 5, {});
      for (const z of Object.values(s.zones)) z.cards = [];
      // makers are seats 0 & 2; seat 0 wins the last trick
      const before = makerTricks - 1;
      Object.assign(s.data, { trump: 'S', maker: 0, contract, trickNo: 9, handSize: 10, tricks: [before, 9 - before, 0, 0], scores });
      s.zones['hand:0'].cards = [{ id: 'AS' }];
      ['5C', '6C', '7C'].forEach((id, k) => (s.zones[`hand:${k + 1}`].cards = [{ id }]));
      s.phase = 'play';
      s.turn = 0;
      for (const i of [0, 1, 2, 3]) g.apply(s, i, { type: 'play', cards: [s.zones[`hand:${i}`].cards[0].id] });
      g.system!(s)!.run(s);
      return s.data.scores;
    };
    expect(finish({ tricks: 7, suit: 'S', value: 140 }, 8)).toEqual([140, 20]);
    expect(finish({ tricks: 8, suit: 'S', value: 240 }, 7)).toEqual([-240, 30]);
    expect(finish({ tricks: 7, suit: 'S', value: 140 }, 10)).toEqual([250, 0]); // slam is worth at least 250
    // defenders can't reach 500 on tricks alone
    expect(finish({ tricks: 7, suit: 'S', value: 140 }, 7, [0, 480])).toEqual([140, 490]);
  });

  it('plays full games with bots', () => {
    for (const seed of [6, 7]) {
      const s = g.setup(bots, seed, {});
      let hands = 0;
      for (let i = 0; i < 40000 && s.phase !== 'gameOver'; i++) {
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        if (s.phase === 'roundOver') {
          hands++;
          expect(cardsIn(s)).toBe(43);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        if (seat < 0) throw new Error(`stuck in ${s.phase}`);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(500);
      expect(hands).toBeGreaterThan(2);
    }
  });
});
