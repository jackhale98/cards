import { describe, expect, it } from 'vitest';
import { groupHF, kindOf, maxWilds, type HandFootData } from '../src/engine/families/handfoot';
import { isHidden, redact } from '../src/engine/redact';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES['hand-and-foot'] as GameModule<HandFootData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
const ids = (s: GameState<any>, z: string) => s.zones[z].cards.map((c) => c.id);
// cards from different decks share ids: tag them with a deck number like the engine does
const total = (s: GameState<any>) => Object.values(s.zones).reduce((k, z) => k + z.cards.length, 0);

/** Four players, seat 0 to play (already drawn) with `hand`; stock and pile as given. */
function rig(hand: string[], opts: { pile?: string[]; foot?: string[]; phase?: string } = {}) {
  const s = g.setup(people(4), 1, {});
  s.zones['hand:0'].cards = hand.map((id) => ({ id }));
  if (opts.foot) s.zones['foot:0'].cards = opts.foot.map((id) => ({ id }));
  if (opts.pile) s.zones.discard.cards = opts.pile.map((id) => ({ id, up: true }));
  s.turn = 0;
  s.phase = opts.phase ?? 'play';
  return s;
}

describe('hand and foot (pagat)', () => {
  it('deals a 13-card hand and a 13-card foot each from one more deck than players', () => {
    const s = g.setup(people(4), 3, {});
    expect(total(s)).toBe(5 * 54);
    for (let i = 0; i < 4; i++) {
      expect(s.zones[`hand:${i}`].cards.length + s.data.red3.flat().length).toBeGreaterThanOrEqual(13);
      expect(s.zones[`foot:${i}`].cards).toHaveLength(13);
    }
    // nobody can look at a foot, not even its owner
    expect(redact(g, s, 0).zones['foot:0'].cards.every((c) => isHidden(c.id))).toBe(true);
    const two = g.setup(people(2), 3, {});
    expect(total(two)).toBe(3 * 54);
  });

  it('wild cards: one in a meld of up to five, two in six or seven; all-wild melds allowed', () => {
    expect(maxWilds(3)).toBe(1);
    expect(maxWilds(5)).toBe(1);
    expect(maxWilds(6)).toBe(2);
    expect(groupHF(['9H', '9S', '2C'], new Map())).toEqual(new Map([[9, ['9H', '9S', '2C']]]));
    expect(groupHF(['9H', '9S', '2C', 'XR'], new Map())).toBeNull();
    expect(groupHF(['2C', '2D', 'XR'], new Map())).toEqual(new Map([[0, ['2C', '2D', 'XR']]]));
    expect(kindOf({ team: 0, rank: 9, cards: ['9H', '9S', '9C', '9D', '9H', '9S', '2C'] })).toBe('dirty');
  });

  it('the first meld must reach 50 in round one', () => {
    const s = rig(['4H', '4S', '4C', 'KH', 'KS', 'KC', 'AH', 'AS', 'AC', 'QD']);
    // 4s (15) and kings (30) only make 45
    expect(() => g.apply(s, 0, { type: 'meld', cards: ['4H', '4S', '4C', 'KH', 'KS', 'KC'] })).toThrow(/50/);
    g.apply(s, 0, { type: 'meld', cards: ['4H', '4S', '4C', 'AH', 'AS', 'AC'] });
    expect(s.data.melds.map((m) => m.rank).sort((a, b) => a - b)).toEqual([4, 14]);
  });

  it('takes the top seven of the pile by melding its top card with two from hand', () => {
    const pile = ['5C', '6C', '7C', '8C', '9C', 'TC', 'JC', 'QH', 'KD'];
    const s = rig(['KH', 'KS', 'AH', 'AS', 'AC', '4D'], { pile, phase: 'draw' });
    expect(() => g.apply(s, 0, { type: 'takePile', cards: ['AH', 'AS'] })).toThrow();
    // (the K meld alone is only 30: add the aces for the first-meld minimum)
    g.apply(s, 0, { type: 'takePile', cards: ['KH', 'KS', 'AH', 'AS', 'AC'] });
    expect(ids(s, 'discard')).toEqual(['5C', '6C']);
    expect(ids(s, 'hand:0').sort()).toEqual(['4D', '7C', '8C', '9C', 'JC', 'QH', 'TC'].sort());
    expect(s.phase).toBe('play');
  });

  it('a black 3 on top blocks the pile', () => {
    const s = rig(['KH', 'KS'], { pile: ['KD', '3S'], phase: 'draw' });
    expect(g.actions(s, 0).map((a) => a.type)).toEqual(['draw']);
  });

  it('playing out the hand picks up the foot; going out needs the piles and both feet', () => {
    const s = rig(['KH', 'KS', 'KC', 'AH', 'AS', 'AC'], { foot: ['5H', '5S', '5C', '9D'] });
    g.apply(s, 0, { type: 'meld', cards: ['KH', 'KS', 'KC', 'AH', 'AS', 'AC'] });
    expect(s.data.footTaken[0]).toBe(true);
    expect(ids(s, 'hand:0').sort()).toEqual(['5C', '5H', '5S', '9D']);
    // in the foot without the piles: you must keep a card to discard
    expect(() => g.apply(s, 0, { type: 'meld', cards: ['5H', '5S', '5C'] })).toThrow(/can’t go out/);
  });

  it('going out: piles score their bonuses, cards held count against', () => {
    const s = rig(['9D', '8S']);
    const pile = (rank: string, cards: string[]) => ({ team: 0, rank: Number(rank), cards });
    s.data.melds = [
      pile('13', ['KH', 'KD', 'KH', 'KD', 'KH', 'KD', 'KS']),
      pile('12', ['QH', 'QD', 'QH', 'QD', 'QH', 'QD', 'QS']),
      pile('11', ['JH', 'JD', 'JH', 'JD', 'JH', 'JS', '2C']),
      pile('10', ['TH', 'TD', 'TH', 'TD', 'TH', 'TS', '2D']),
      { team: 0, rank: 0, cards: ['2C', '2D', '2H', '2S', 'XR', 'XB', '2C'] },
      { team: 0, rank: 8, cards: ['8H', '8D'] },
    ];
    s.data.footTaken = [true, false, true, false];
    // 8♠ finishes the 8s? not a pile, just a meld: then discard the 9 to go out
    s.data.melds[5].cards.push('8C');
    g.apply(s, 0, { type: 'meld', cards: ['8S'] });
    g.apply(s, 0, { type: 'discard', cards: ['9D'] });
    expect(s.phase).toBe('handOver');
    expect(s.data.result!.lines[1]).toMatch(/piles 3100/);
    expect(s.data.result!.lines[1]).toMatch(/out 100/);
  });

  it('a red 3 drawn as the last card can leave one card in the foot: discarding it ends the round', () => {
    const s = rig(['AS']);
    s.data.footTaken[0] = true;
    s.zones.deck.cards = [];
    g.apply(s, 0, { type: 'discard', cards: ['AS'] });
    expect(s.phase).toBe('handOver');
    expect(s.data.result!.lines[0]).toMatch(/stock has run out/);
  });

  it('sides: four as two partnerships, six as two teams of three, otherwise everyone alone (pagat)', () => {
    const sides = (n: number) => {
      const s = g.setup(bots(n), 1, {});
      return { scores: s.data.scores.length, decks: total(s) / 54 };
    };
    expect(sides(2)).toEqual({ scores: 2, decks: 3 });
    expect(sides(3)).toEqual({ scores: 3, decks: 4 });
    expect(sides(4)).toEqual({ scores: 2, decks: 5 });
    expect(sides(5)).toEqual({ scores: 5, decks: 6 });
    expect(sides(6)).toEqual({ scores: 2, decks: 7 });
    // six: seats 0, 2, 4 against 1, 3, 5 — so the scoreboard lists three names a side
    const six = g.setup(bots(6), 1, {});
    expect(g.status(six, 0).scoreboard!.rows.map((r) => r.name.split(' & ').length)).toEqual([3, 3]);
    expect(() => g.setup(bots(7), 1, {})).toThrow();
  });

  it('bots play whole four-round games (2 to 6 players)', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = g.setup(bots(n), n, {});
      const cards = total(s);
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'handOver') {
          expect(total(s)).toBe(cards);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const a = g.bot!(s, s.turn!)!;
        expect(g.actions(s, s.turn!).map((o) => o.type)).toContain(a.type);
        g.apply(s, s.turn!, a);
      }
      expect(s.phase).toBe('gameOver');
      expect(s.data.round).toBe(4);
      expect(g.standings!(s)).toHaveLength(n);
    }
  }, 180000);
});
