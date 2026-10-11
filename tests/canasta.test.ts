import { describe, expect, it } from 'vitest';
import { cardPoints, groupMeld, minimumMeld, type CanastaData } from '../src/engine/families/canasta';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES['canasta'] as GameModule<CanastaData>;
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);

describe('canasta basics', () => {
  it('values cards and minimum first melds', () => {
    expect(['X1#1', '2S', 'AS', 'KS', '8S', '7S', '4S', '3C'].map(cardPoints)).toEqual([50, 20, 20, 10, 10, 5, 5, 5]);
    expect([-10, 0, 1495, 1500, 2995, 3000].map(minimumMeld)).toEqual([15, 50, 50, 90, 90, 120]);
  });

  it('groups selected cards into melds, spreading wild cards', () => {
    const m = groupMeld(['KS', 'KH', '2C', '7D', '7S', '7C'])!;
    expect(m.get(13)).toEqual(['KS', 'KH', '2C']);
    expect(m.get(7)).toEqual(['7D', '7S', '7C']);
    expect(groupMeld(['2C', 'X1#1'])).toBeNull(); // wild cards alone
    expect(groupMeld(['3H', '3D', '3H#2'])).toBeNull(); // red threes never meld
  });

  it('deals 11 each (15 head to head) from 108 cards, red threes laid out', () => {
    const s = g.setup(bots(4), 1, {});
    expect(cardsIn(s)).toBe(108);
    for (let i = 0; i < 4; i++) {
      expect(ids(s, `hand:${i}`)).toHaveLength(11);
      expect(ids(s, `hand:${i}`).some((c) => /^3[HD]/.test(c))).toBe(false);
    }
    expect(ids(g.setup(bots(2), 1, {}), 'hand:0')).toHaveLength(15);
  });
});

describe('canasta play', () => {
  /** A rigged 4-player hand: seat 0 to draw, nothing melded. */
  function rig(h0: string[], pile: string[], opts: Partial<CanastaData> = {}) {
    const s = g.setup(bots(4), 2, {});
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['hand:0'].cards = h0.map((id) => ({ id }));
    for (const i of [1, 2, 3]) s.zones[`hand:${i}`].cards = ['4S', '9D', 'JC'].map((id) => ({ id: `${id}#2` }));
    s.zones.discard.cards = pile.map((id) => ({ id, up: true }));
    s.zones.deck.cards = ['5S', '6S', '7S', '8S', '9S', 'TS'].map((id) => ({ id }));
    Object.assign(s.data, { melds: [], red3: [[], []], frozen: false, scores: [0, 0], melded: [false, false, false, false], turnMelded: false, ...opts });
    s.phase = 'draw';
    s.turn = 0;
    return s;
  }

  it('enforces the first meld minimum, which several melds can make up together', () => {
    const s = rig(['KS', 'KH', 'KD', '5C', '5D', '5H', 'AS', 'AH', 'AD', '4D'], ['8C']);
    g.apply(s, 0, { type: 'draw' });
    // three kings are only 30, and with three fives 45
    expect(() => g.apply(s, 0, { type: 'meld', cards: ['KS', 'KH', 'KD'] })).toThrow(/50 — that's 30/);
    expect(() => g.apply(s, 0, { type: 'meld', cards: ['KS', 'KH', 'KD', '5C', '5D', '5H'] })).toThrow(/that's 45/);
    // kings and aces together: 90
    g.apply(s, 0, { type: 'meld', cards: ['KS', 'KH', 'KD', 'AS', 'AH', 'AD'] });
    expect(s.data.melds.map((m) => m.rank).sort()).toEqual([13, 14]);
    // once the side has melded, small melds are fine
    g.apply(s, 0, { type: 'meld', cards: ['5C', '5D', '5H'] });
    expect(s.data.melds).toHaveLength(3);
  });

  it('meld rules: two naturals, at most three wilds', () => {
    const s = rig(['KS', '2H', '2D', 'X1#1', 'X2#1', 'QS', 'QH', 'QD', 'QC', 'AS', 'AH'], ['8C'], { scores: [-100, 0] });
    g.apply(s, 0, { type: 'draw' });
    expect(() => g.apply(s, 0, { type: 'meld', cards: ['KS', '2H', '2D'] })).toThrow(/2 natural/);
    expect(() => g.apply(s, 0, { type: 'meld', cards: ['QS', 'QH', '2H', '2D', 'X1#1', 'X2#1'] })).toThrow(/3 wild/);
    g.apply(s, 0, { type: 'meld', cards: ['QS', 'QH', 'QD', 'QC', '2H', '2D', 'X1#1'] });
    expect(s.data.melds[0].cards).toHaveLength(7); // a mixed canasta
    expect(s.zones['melds:0'].label).toMatch(/1 canasta/);
  });

  it('a frozen pile needs a natural pair of the top card', () => {
    const s = rig(['9H', '9D', '9S', 'KH', 'AS', '4C'], ['QC', '2S', '9C'], { frozen: true, scores: [-100, 0] });
    expect(() => g.apply(s, 0, { type: 'takePile', cards: ['9H', '2S'.replace('2S', 'KH')] })).toThrow();
    g.apply(s, 0, { type: 'takePile', cards: ['9H', '9D'] });
    expect(s.data.melds[0].cards).toEqual(expect.arrayContaining(['9C', '9H', '9D']));
    expect(ids(s, 'hand:0')).toEqual(expect.arrayContaining(['QC', '2S', '9S']));
    expect(s.data.frozen).toBe(false);
    expect(ids(s, 'discard')).toEqual([]);
  });

  it('a black three or a wild on top can’t be taken', () => {
    const s = rig(['3C', '3S', 'KH', 'KD'], ['KS', '3C#2']);
    expect(g.actions(s, 0).some((a) => a.type === 'takePile')).toBe(false);
  });

  it('you need a canasta to go out; going out scores the bonus', () => {
    // without a canasta you can't go out
    {
      const t = rig(['QS', 'QH', 'QD', '4C'], ['8C'], { scores: [-100, 0] });
      g.apply(t, 0, { type: 'draw' });
      // melding all but one card would leave nothing to keep after discarding
      expect(() => g.apply(t, 0, { type: 'meld', cards: ['QS', 'QH', 'QD', '4C'].slice(0, 3).concat(t.data.received[0]).filter((c) => c !== '4C') })).toThrow();
      t.zones['hand:0'].cards = [{ id: '4C' }];
      expect(() => g.apply(t, 0, { type: 'discard', cards: ['4C'] })).toThrow(/canasta to go out/);
    }
    const s = rig(['KS', 'KH', 'KD', 'KC', 'KS#2', 'KH#2', 'KD#2', '5C', '9D'], ['8C'], { scores: [-100, 0] });
    g.apply(s, 0, { type: 'draw' });
    // melding everything but one without a canasta is refused
    expect(() => g.apply(s, 0, { type: 'meld', cards: ['KS', 'KH', 'KD', 'KC', 'KS#2', 'KH#2'] })).not.toThrow();
    // (six kings melded; adding the seventh makes the canasta)
    g.apply(s, 0, { type: 'meld', cards: ['KD#2'] }); // a natural canasta
    // left holding 5♣ 9♦ and the card just drawn
    expect(ids(s, 'hand:0')).toHaveLength(3);
    g.apply(s, 0, { type: 'discard', cards: [s.data.received[0][0]] });
    expect(s.turn).toBe(1);
    // fast-forward: seat 0 discards its last card to go out
    s.turn = 0;
    s.phase = 'play';
    s.zones['hand:0'].cards = [{ id: '9D' }];
    g.apply(s, 0, { type: 'discard', cards: ['9D'] });
    expect(s.phase).toBe('handOver');
    // team 0: 7 kings 70 + natural canasta 500 + going out 100 (not concealed: melded on an earlier turn)
    expect(s.data.result!.lines.join(' ')).toMatch(/melds 70, canastas 500, out 100/);
  });

  it('plays whole games with bots, four players and two', () => {
    for (const n of [4, 2]) {
      const s = g.setup(bots(n), 30 + n, { target: 1500 });
      let hands = 0;
      for (let i = 0; i < 100000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          hands++;
          expect(cardsIn(s)).toBe(108);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        if (seat < 0) throw new Error(`stuck in ${s.phase}`);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(1500);
      expect(hands).toBeGreaterThan(0);
    }
  });
});

describe('canasta (pagat audit)', () => {
  const meld = (team: number, rank: number, cards: string[]) => ({ team, rank, cards });
  function rig(h0: string[], pile: string[], opts: Partial<CanastaData> = {}, stock = ['5S', '6S', '7S', '8S', '9S', 'TS'], n = 4) {
    const s = g.setup(bots(n), 2, {});
    s.players.forEach((p) => (p.bot = false));
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['hand:0'].cards = h0.map((id) => ({ id }));
    for (let i = 1; i < n; i++) s.zones[`hand:${i}`].cards = ['4S', '9D', 'JC'].map((id) => ({ id: `${id}#2` }));
    s.zones.discard.cards = pile.map((id) => ({ id, up: true }));
    s.zones.deck.cards = stock.map((id) => ({ id }));
    Object.assign(s.data, { melds: [], red3: [[], []], frozen: false, scores: [0, 0], melded: s.players.map(() => false), turnMelded: false, ask: null, turnStartRanks: (opts.melds ?? []).filter((m) => m.team === 0).map((m) => m.rank), ...opts });
    s.phase = 'draw';
    s.turn = 0;
    return s;
  }

  it('wild cards alone can be added to a meld the side already has', () => {
    const s = rig(['2H', 'X1#1', '9C', '9D'], ['8C'], { melds: [meld(0, 13, ['KS', 'KH', 'KD']), meld(0, 9, ['9S', '9H', '2C'])], melded: [true, false, true, false] });
    g.apply(s, 0, { type: 'draw' });
    const add = g.actions(s, 0).find((a) => a.type === 'addWild')!;
    expect(add.choose!.options.map((o) => o.value).sort((a, b) => a - b)).toEqual([9, 13]);
    g.apply(s, 0, { type: 'addWild', cards: ['2H', 'X1#1'], amount: 13 });
    expect(s.data.melds.find((m) => m.rank === 13)!.cards).toHaveLength(5);
    // the nines already have a wild: two more would make four
    expect(() => g.apply(s, 0, { type: 'addWild', cards: ['2H#2', 'X2#1'], amount: 9 })).toThrow();
  });

  it('“may I go out?” — a no forbids going out, a yes makes you', () => {
    const canasta = meld(0, 13, ['KS', 'KH', 'KD', 'KC', 'KS#2', 'KH#2', 'KD#2']);
    const no = rig(['QS', 'QH', 'QD', '4C', '4H'], ['8C'], { melds: [canasta], melded: [true, false, true, false] }, ['4D']);
    g.apply(no, 0, { type: 'draw' });
    g.apply(no, 0, { type: 'ask' });
    expect(no.phase).toBe('ask');
    expect(no.turn).toBe(2);
    expect(g.actions(no, 2).map((a) => a.type)).toEqual(['allowOut', 'denyOut']);
    g.apply(no, 2, { type: 'denyOut' });
    expect(no.turn).toBe(0);
    // melding everything would go out
    expect(() => g.apply(no, 0, { type: 'meld', cards: ['QS', 'QH', 'QD', '4C', '4H', '4D'] })).toThrow(/said not to go out/);
    g.apply(no, 0, { type: 'meld', cards: ['QS', 'QH', 'QD'] });
    g.apply(no, 0, { type: 'discard', cards: ['4C'] });
    expect(no.phase).toBe('draw');

    const yes = rig(['QS', 'QH', 'QD', '4C', '4H'], ['8C'], { melds: [canasta], melded: [true, false, true, false] }, ['4D']);
    g.apply(yes, 0, { type: 'draw' });
    g.apply(yes, 0, { type: 'ask' });
    g.apply(yes, 2, { type: 'allowOut' });
    expect(() => g.apply(yes, 0, { type: 'discard', cards: ['4C'] })).toThrow(/must go out/);
    g.apply(yes, 0, { type: 'meld', cards: ['QS', 'QH', 'QD'] });
    expect(() => g.apply(yes, 0, { type: 'discard', cards: ['4D'] })).toThrow(/must go out/);
    // asking comes before melding from hand, once a turn
    expect(g.actions(yes, 0).some((a) => a.type === 'ask')).toBe(false);
  });

  it('with the stock gone a matching unfrozen discard must be taken; otherwise drawing ends the hand', () => {
    const s = rig(['4C', '9H'], ['8C', 'QS'], { melds: [meld(0, 12, ['QH', 'QD', 'QC'])], melded: [true, false, true, false] }, []);
    expect(g.actions(s, 0).map((a) => a.type)).toEqual(['takePile']);
    expect(() => g.apply(s, 0, { type: 'draw' })).toThrow(/must take the pile/);
    g.apply(s, 0, { type: 'takePile', cards: [] });
    expect(s.phase).toBe('play');

    const t = rig(['4C', '9H'], ['8C', 'JS'], { melds: [meld(0, 12, ['QH', 'QD', 'QC'])], melded: [true, false, true, false] }, []);
    g.apply(t, 0, { type: 'draw' });
    expect(t.phase).toBe('handOver');
    expect(t.data.result!.lines[0]).toMatch(/stock has run out/);
  });

  it('a red three as the last card of the stock ends the play at once', () => {
    const s = rig(['4C', '9H', 'JD'], ['8C'], {}, ['3H']);
    g.apply(s, 0, { type: 'draw' });
    expect(s.data.red3[0]).toEqual(['3H']);
    expect(s.phase).toBe('handOver');
  });

  it('head to head, a single card left in the stock is a full draw', () => {
    const s = rig(['4C', '9H', 'JD'], ['8C'], { melded: [false, false] }, ['5D'], 2);
    g.apply(s, 0, { type: 'draw' });
    expect(s.phase).toBe('play');
    expect(ids(s, 'hand:0')).toContain('5D');
  });

  it('going out concealed from the stock needs no minimum, and adding to partner’s melds isn’t concealed', () => {
    // side needs 120, but a whole concealed hand with a canasta goes out anyway
    const hand = ['5C', '5D', '5H', '5S', '5C#2', '5D#2', '2H', '6C', '6D', '6H'];
    const s = rig(hand, ['8C'], { scores: [3500, 0] }, ['4D']);
    g.apply(s, 0, { type: 'draw' });
    g.apply(s, 0, { type: 'meld', cards: hand });
    g.apply(s, 0, { type: 'discard', cards: ['4D'] });
    expect(s.data.result!.lines[0]).toMatch(/goes out concealed/);

    const p = rig(['5C', '5D', '5H', '5S', '5C#2', '5D#2', '2H', '9C'], ['8C'], { melds: [meld(0, 9, ['9S', '9H', '9D'])], melded: [false, false, true, false] }, ['4D']);
    g.apply(p, 0, { type: 'draw' });
    g.apply(p, 0, { type: 'meld', cards: ['5C', '5D', '5H', '5S', '5C#2', '5D#2', '2H', '9C'] });
    g.apply(p, 0, { type: 'discard', cards: ['4D'] });
    expect(p.data.result!.lines[0]).toMatch(/goes out!/);
  });

  it('is for 2 or 4 players', () => {
    expect(g.config.players.counts).toEqual([2, 4]);
  });
});
