import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/engine/cards';
import { avondale, type TrickData } from '../src/engine/families/trick';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['five-hundred'] as GameModule<TrickData>;
const bots = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

/** Find a bid's option value from the "Bid" action. */
function bidValue(s: GameState<TrickData>, seat: number, label: string) {
  const opt = g
    .actions(s, seat)
    .find((a) => a.type === 'bid500')!
    .choose!.options.find((o) => o.label.startsWith(label));
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
    expect(
      g
        .actions(s, second)
        .find((a) => a.type === 'bid500')!
        .choose!.options.filter((o) => !o.disabled)
        .every((o) => Number(o.label.split('· ')[1]) > 140),
    ).toBe(true);
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
    // defence points count, but reaching 500 on defence doesn't win
    expect(finish({ tricks: 7, suit: 'S', value: 140 }, 7, [0, 480])).toEqual([140, 510]);
  });

  /** Rig the last trick of a hand: seat 0 (with `contract`) leads `AS`. */
  function lastTrick(contract: object, scores: number[], makerTricks: number, options = {}) {
    const s = g.setup(bots, 5, options);
    for (const z of Object.values(s.zones)) z.cards = [];
    Object.assign(s.data, { trump: 'S', maker: 0, contract, trickNo: 9, handSize: 10, tricks: [makerTricks - 1, 9 - makerTricks + 1, 0, 0], scores });
    s.zones['hand:0'].cards = [{ id: 'AS' }];
    ['5C', '6C', '7C'].forEach((id, k) => (s.zones[`hand:${k + 1}`].cards = [{ id }]));
    s.phase = 'play';
    s.turn = 0;
    for (const i of [0, 1, 2, 3]) g.apply(s, i, { type: 'play', cards: [s.zones[`hand:${i}`].cards[0].id] });
    g.system!(s)!.run(s);
    return s;
  }

  it('wins only by making a bid (unless that option is off), and loses at −500', () => {
    const c = { tricks: 7, suit: 'S', value: 140 };
    expect(lastTrick(c, [0, 480], 7).phase).toBe('roundOver'); // defenders on 510: not a win
    const won = lastTrick(c, [400, 0], 8);
    expect(won.phase).toBe('gameOver');
    expect(won.winner).toEqual([0, 2]);
    const anyway = lastTrick(c, [0, 480], 7, { bidToWin: false });
    expect(anyway.phase).toBe('gameOver');
    expect(anyway.winner).toEqual([1, 3]);
    const back = lastTrick({ tricks: 8, suit: 'S', value: 240 }, [-300, 0], 7);
    expect(back.data.scores[0]).toBe(-540);
    expect(back.phase).toBe('gameOver');
    expect(back.winner).toEqual([1, 3]);
  });

  it('misère ranks over the sevens; open misère can be bid any time', () => {
    const s = g.setup(bots, 2, {});
    const first = s.turn!;
    const types = (seat: number) => g.actions(s, seat).map((a) => a.type);
    expect(types(first)).toContain('openMisere');
    expect(types(first)).not.toContain('misere');
    g.apply(s, first, { type: 'bid500', amount: bidValue(s, first, '7\u2009♠') });
    expect(types(s.turn!)).toContain('misere');
    g.apply(s, s.turn!, { type: 'misere' });
    expect(s.data.contract!.misere).toBe('closed');
    // only eights and up (and open misère) beat it
    const grid = g
      .actions(s, s.turn!)
      .find((a) => a.type === 'bid500')!
      .choose!.options.filter((o) => !o.disabled);
    expect(grid.every((o) => o.label.startsWith('8') || o.label.startsWith('9') || o.label.startsWith('10'))).toBe(true);
  });

  it('plays misère alone: partner sits out, the first trick taken ends it', () => {
    const s = g.setup(bots, 3, {});
    const first = s.turn!;
    g.apply(s, first, { type: 'openMisere' });
    for (let i = 0; i < 3; i++) g.apply(s, s.turn!, { type: 'decline' });
    expect(s.data.sittingOut).toBe((first + 2) % 4);
    g.apply(s, first, { type: 'bury', cards: ids(s, `hand:${first}`).slice(-3) });
    expect(s.turn).toBe(first);
    // play tricks with bots until the hand ends
    let exposedSeen = false;
    for (let i = 0; i < 200 && s.phase !== 'roundOver' && s.phase !== 'gameOver'; i++) {
      const sys = g.system?.(s);
      if (sys) sys.run(s);
      else {
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      if (s.data.exposed === first) exposedSeen = true;
    }
    const tricks = s.data.tricks[first];
    expect(tricks).toBeLessThanOrEqual(1);
    const team = first % 2;
    expect(s.data.scores[team]).toBe(tricks ? -500 : 500);
    expect(s.data.scores[1 - team]).toBe(0);
    if (s.data.trickNo > 1 || !tricks) expect(exposedSeen).toBe(true);
  });

  it('misère: a player who cannot follow must play the joker', () => {
    const s = g.setup(bots, 4, {});
    for (const z of Object.values(s.zones)) z.cards = [];
    Object.assign(s.data, {
      trump: null,
      maker: 0,
      contract: { tricks: 0, suit: 'NT', value: 250, misere: 'closed' },
      sittingOut: 2,
      trickNo: 0,
      handSize: 10,
      tricks: [0, 0, 0, 0],
    });
    s.zones['hand:0'].cards = [{ id: '5H' }];
    s.zones['hand:1'].cards = [{ id: 'X1' }, { id: 'KC' }];
    s.phase = 'play';
    s.turn = 0;
    g.apply(s, 0, { type: 'play', cards: ['5H'] });
    expect(g.actions(s, 1).find((a) => a.type === 'play')!.select!.cards).toEqual(['X1']);
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
