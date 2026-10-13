import { describe, expect, it } from 'vitest';
import type { TrickData } from '../src/engine/families/trick';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const euchre = GAMES.euchre as GameModule<TrickData>;
const bots = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

function botStep(s: GameState<TrickData>) {
  const sys = euchre.system?.(s);
  if (sys) return sys.run(s);
  if (s.phase === 'roundOver') return euchre.apply(s, 0, { type: 'next' });
  const seat = s.players.findIndex((p) => euchre.bot!(s, p.seat));
  if (seat < 0) throw new Error(`stuck in ${s.phase}`);
  euchre.apply(s, seat, euchre.bot!(s, seat)!);
}

describe('euchre', () => {
  it('deals 5 each from 24 cards and turns one up', () => {
    const s = euchre.setup(bots, 1, {});
    for (let i = 0; i < 4; i++) expect(ids(s, `hand:${i}`)).toHaveLength(5);
    expect(ids(s, 'upcard')).toHaveLength(1);
    expect(cardsIn(s)).toBe(24);
    expect(s.phase).toBe('order');
    expect(s.turn).toBe((s.dealer + 1) % 4);
  });

  it('plays whole games to 10 with bots', () => {
    for (const seed of [2, 3, 4]) {
      const s = euchre.setup(bots, seed, {});
      let hands = 0;
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'roundOver') {
          hands++;
          expect(cardsIn(s)).toBe(24);
        }
        botStep(s);
      }
      expect(s.phase).toBe('gameOver');
      expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(10);
      expect(hands).toBeGreaterThan(3);
      expect(s.winner).toHaveLength(2);
    }
  });

  it('ranks the bowers and makes the left bower follow trumps', () => {
    const s = euchre.setup(bots, 5, {});
    for (const z of Object.values(s.zones)) z.cards = [];
    Object.assign(s.data, { trump: 'H', maker: 0, upcard: null });
    // seat 1 leads a heart; seat 2 holds the jack of diamonds (left bower = a heart now) and a diamond
    s.zones['hand:1'].cards = [{ id: 'AH' }];
    s.zones['hand:2'].cards = [{ id: 'JD' }, { id: 'KD' }];
    s.zones['hand:3'].cards = [{ id: 'JH' }];
    s.zones['hand:0'].cards = [{ id: 'QH' }];
    s.phase = 'play';
    s.data.trickNo = 4;
    s.data.handSize = 5;
    s.turn = 1;
    euchre.apply(s, 1, { type: 'play', cards: ['AH'] });
    // must follow hearts: the left bower is the only heart
    const play = euchre.actions(s, 2).find((a) => a.type === 'play')!;
    expect(play.select!.cards).toEqual(['JD']);
    euchre.apply(s, 2, { type: 'play', cards: ['JD'] });
    euchre.apply(s, 3, { type: 'play', cards: ['JH'] }); // right bower
    euchre.apply(s, 0, { type: 'play', cards: ['QH'] });
    euchre.system!(s)!.run(s);
    // the right bower beats the left bower beats the ace
    expect(s.data.tricks[3]).toBe(1);
  });

  it('dealer picks up the ordered card and discards', () => {
    const s = euchre.setup(bots, 6, {});
    const up = ids(s, 'upcard')[0];
    euchre.apply(s, s.turn!, { type: 'order' });
    expect(s.phase).toBe('discard');
    expect(s.turn).toBe(s.dealer);
    expect(ids(s, `hand:${s.dealer}`)).toContain(up);
    expect(ids(s, `hand:${s.dealer}`)).toHaveLength(6);
    euchre.apply(s, s.dealer, { type: 'bury', cards: [ids(s, `hand:${s.dealer}`)[0]] });
    expect(s.phase).toBe('play');
    expect(s.data.trump).toBe(up[1]);
  });

  it('turns the card down after four passes, and sticks the dealer', () => {
    const s = euchre.setup(bots, 7, {});
    const upSuit = ids(s, 'upcard')[0][1];
    for (let i = 0; i < 4; i++) euchre.apply(s, s.turn!, { type: 'decline' });
    expect(s.phase).toBe('name');
    expect(s.zones.upcard.cards[0].up).toBe(false);
    for (let i = 0; i < 3; i++) euchre.apply(s, s.turn!, { type: 'decline' });
    expect(s.turn).toBe(s.dealer);
    expect(() => euchre.apply(s, s.dealer, { type: 'decline' })).toThrow(/stuck/);
    const naming = euchre.actions(s, s.dealer).find((a) => a.type === 'name')!;
    expect(naming.choose!.options.map((o) => o.label).join()).not.toContain(
      upSuit === 'S' ? 'spades' : upSuit === 'H' ? 'hearts' : upSuit === 'D' ? 'diamonds' : 'clubs',
    );
    euchre.apply(s, s.dealer, { type: 'name', amount: naming.choose!.options[0].value });
    expect(s.phase).toBe('play');
  });

  it('going alone leaves the partner out and plays 3-card tricks', () => {
    const s = euchre.setup(bots, 8, {});
    const maker = s.turn!;
    euchre.apply(s, maker, { type: 'orderAlone' });
    if (s.phase === 'discard') euchre.apply(s, s.dealer, { type: 'bury', cards: [ids(s, `hand:${s.dealer}`)[0]] });
    expect(s.data.sittingOut).toBe((maker + 2) % 4);
    let seen = 0;
    while (s.phase === 'play') {
      const seat = s.turn!;
      expect(seat).not.toBe(s.data.sittingOut);
      euchre.apply(s, seat, euchre.bot!(s, seat)!);
      seen++;
    }
    expect(s.phase).toBe('trickEnd');
    expect(seen).toBe(3);
  });

  it('scores makers, marches, loners and euchres', () => {
    const score = (tricks: number[], maker: number, alone = false) => {
      const s = euchre.setup(bots, 9, {});
      for (const z of Object.values(s.zones)) z.cards = [];
      Object.assign(s.data, { trump: 'S', maker, sittingOut: alone ? (maker + 2) % 4 : null, tricks, trickNo: 4, handSize: 5, scores: [0, 0] });
      // one last trick that seat 0 wins
      s.zones['hand:0'].cards = [{ id: 'AS' }];
      const others = ['9C', 'TC', 'QC'];
      [1, 2, 3].forEach((i, k) => (s.zones[`hand:${i}`].cards = [{ id: others[k] }]));
      s.phase = 'play';
      s.turn = 0;
      for (const i of [0, 1, 2, 3]) if (s.data.sittingOut !== i) euchre.apply(s, i, { type: 'play', cards: [s.zones[`hand:${i}`].cards[0].id] });
      euchre.system!(s)!.run(s);
      return s.data.scores;
    };
    expect(score([2, 0, 0, 2], 0)).toEqual([1, 0]); // makers (0 & 2) take 3
    expect(score([2, 0, 2, 0], 0)).toEqual([2, 0]); // all five: march
    expect(score([4, 0, 0, 0], 0, true)).toEqual([4, 0]); // alone, all five
    expect(score([0, 2, 0, 2], 0)).toEqual([0, 2]); // makers take 1: euchred
  });
});
