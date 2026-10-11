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
