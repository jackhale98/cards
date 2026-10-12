import { describe, expect, it } from 'vitest';
import { meldOf, type PinochleData } from '../src/engine/families/pinochle';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES.pinochle as GameModule<PinochleData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
const ids = (s: GameState<any>, z: string) => s.zones[z].cards.map((c) => c.id);

describe('pinochle (pagat)', () => {
  it('deals the 48-card deck, 12 each', () => {
    const s = g.setup(people(4), 1, {});
    for (let i = 0; i < 4; i++) expect(s.zones[`hand:${i}`].cards).toHaveLength(12);
    const all = [0, 1, 2, 3].flatMap((i) => ids(s, `hand:${i}`));
    expect(new Set(all.map((c) => c.split('#')[0])).size).toBe(24);
  });

  it('meld values follow the table', () => {
    const run = ['AH#1', 'TH#1', 'KH#1', 'QH#1', 'JH#1'];
    expect(meldOf(run, 'H').points).toBe(150);
    expect(meldOf([...run, 'KH#2'], 'H').points).toBe(190);
    expect(meldOf([...run, 'KH#2', 'QH#2'], 'H').points).toBe(230);
    expect(meldOf([...run, 'AH#2', 'TH#2', 'KH#2', 'QH#2', 'JH#2'], 'H').points).toBe(1500);
    expect(meldOf(['KH#1', 'QH#1', '9H#1'], 'H').points).toBe(50); // royal marriage + dix
    expect(meldOf(['KS#1', 'QS#1'], 'H').points).toBe(20);
    expect(meldOf(['QS#1', 'JD#1'], 'H').points).toBe(40);
    expect(meldOf(['QS#1', 'JD#1', 'QS#2', 'JD#2'], 'H').points).toBe(300);
    expect(meldOf(['AS#1', 'AH#1', 'AD#1', 'AC#1'], 'H').points).toBe(100);
    expect(meldOf(['AS#1', 'AH#1', 'AD#1', 'AC#1', 'AS#2', 'AH#2', 'AD#2', 'AC#2'], 'H').points).toBe(1000);
    // a card can count in melds of different kinds: Q♠ in a marriage and a pinochle
    expect(meldOf(['KS#1', 'QS#1', 'JD#1'], 'H').points).toBe(60);
  });

  it('bidding: tens from 250, a pass is final, the dealer is stuck if everyone passes', () => {
    const s = g.setup(people(4), 2, {});
    expect(s.turn).toBe(0);
    expect(() => g.apply(s, 0, { type: 'bid', amount: 240 })).toThrow();
    g.apply(s, 0, { type: 'pass' });
    g.apply(s, 1, { type: 'pass' });
    g.apply(s, 2, { type: 'pass' });
    // the dealer takes it at 250 without being asked
    expect(s.phase).toBe('trump');
    expect(s.data.bidder).toBe(3);
    expect(s.data.bid).toBe(250);
  });

  it('the declarer names trumps, gets four from partner and passes four back; meld goes on the table', () => {
    const s = g.setup(people(4), 3, {});
    g.apply(s, 0, { type: 'bid', amount: 250 });
    for (const i of [1, 2, 3]) g.apply(s, i, { type: 'pass' });
    g.apply(s, 0, { type: 'trump', amount: 1 }); // hearts
    expect(s.turn).toBe(2);
    const four = ids(s, 'hand:2').slice(0, 4);
    g.apply(s, 2, { type: 'give', cards: four });
    expect(s.zones['hand:0'].cards).toHaveLength(16);
    g.apply(s, 0, { type: 'give', cards: ids(s, 'hand:0').slice(-4) });
    expect(s.zones['hand:2'].cards.length + s.zones['meld:2'].cards.length).toBe(12);
    expect(['meld', 'handOver']).toContain(s.phase);
  });

  /** Seat 0 to play a card to the trick with trumps hearts. */
  function midTrick(hand: string[], trick: [string, number][]) {
    const s = g.setup(people(4), 4, {});
    s.data.trump = 'H';
    s.data.bidder = 1;
    s.data.bid = 250;
    s.phase = 'play';
    s.zones['hand:0'].cards = hand.map((id) => ({ id }));
    s.zones.trick.cards = trick.map(([id, by]) => ({ id, by, up: true }));
    s.turn = 0;
    return s;
  }
  const legal = (s: GameState<PinochleData>) => g.actions(s, 0)[0].select!.cards.sort();

  it('play: follow and beat if you can; void, trump (over a trump if you can)', () => {
    // must beat the K♠ with the 10 (10 outranks K)
    expect(legal(midTrick(['TS#1', 'QS#1', 'AH#1'], [['KS#1', 1]]))).toEqual(['TS#1']);
    // the trick is trumped: follow with any spade
    expect(legal(midTrick(['TS#1', 'QS#1', 'AH#1'], [['KS#1', 1], ['9H#1', 2]]))).toEqual(['QS#1', 'TS#1']);
    // void in spades: must trump, and over the 9♥
    expect(legal(midTrick(['TH#1', '9H#2', 'KC#1'], [['KS#1', 1], ['JH#1', 2]]))).toEqual(['TH#1']);
    // can't overtrump: any trump
    expect(legal(midTrick(['9H#2', 'JH#2', 'KC#1'], [['KS#1', 1], ['AH#1', 2]]))).toEqual(['9H#2', 'JH#2']);
    // no spades, no trumps: anything
    expect(legal(midTrick(['KC#1', 'QD#1'], [['KS#1', 1]]))).toEqual(['KC#1', 'QD#1']);
  });

  it('equal cards: the first played wins', () => {
    const s = midTrick(['AS#2'], [['AS#1', 1], ['9S#1', 2], ['QS#1', 3]]);
    s.zones['hand:0'].cards = [{ id: 'AS#2' }];
    g.apply(s, 0, { type: 'card', cards: ['AS#2'] });
    g.system!(s)!.run(s);
    expect(s.turn).toBe(1);
  });

  it('a side that can’t reach its bid with all 250 points is set without play', () => {
    const s = g.setup(people(4), 5, {});
    g.apply(s, 0, { type: 'bid', amount: 900 });
    for (const i of [1, 2, 3]) g.apply(s, i, { type: 'pass' });
    g.apply(s, 0, { type: 'trump', amount: 0 });
    g.apply(s, 2, { type: 'give', cards: ids(s, 'hand:2').slice(0, 4) });
    g.apply(s, 0, { type: 'give', cards: ids(s, 'hand:0').slice(0, 4) });
    if (s.data.meld[0].points + s.data.meld[2].points + 250 < 900) {
      expect(s.phase).toBe('handOver');
      expect(s.data.scores[0]).toBe(-900);
    }
  });

  it('bots play whole games to 1500', () => {
    for (const seed of [1, 2]) {
      const s = g.setup(bots(4), seed, {});
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        if (s.phase === 'handOver') {
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const a = g.bot!(s, s.turn!)!;
        expect(g.actions(s, s.turn!).map((o) => o.type)).toContain(a.type);
        g.apply(s, s.turn!, a);
      }
      expect(s.phase).toBe('gameOver');
      expect(Object.values(s.zones).reduce((k, z) => k + z.cards.length, 0)).toBe(48);
    }
  });
});
