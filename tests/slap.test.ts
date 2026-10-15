import { describe, expect, it } from 'vitest';
import { GAMES } from './games';
import type { GameModule, GameState } from '../src/engine/types';
import type { SlapData } from '../src/engine/families/slap';

type S = GameState<SlapData>;
const slapjack = GAMES['slapjack'] as GameModule<SlapData>;
const ers = GAMES['egyptian-rat-screw'] as GameModule<SlapData>;

/** A table whose piles are set by hand: `piles[seat]` lists cards bottom first (the last is turned up next). */
function table(g: GameModule<SlapData>, piles: string[][], options: Record<string, number | boolean> = {}): S {
  const s = g.setup(
    piles.map((_, i) => ({ name: `P${i}` })),
    1,
    options,
  );
  piles.forEach((p, i) => (s.zones[`hand:${i}`].cards = p.map((id) => ({ id }))));
  s.zones.pile.cards = [];
  s.turn = 0;
  return s;
}
const flip = (g: GameModule<SlapData>, s: S, seat = s.turn!) => g.apply(s, seat, { type: 'flip' });
const runSystem = (g: GameModule<SlapData>, s: S) => g.system!(s)!.run(s);
const count = (s: S, seat: number) => s.zones[`hand:${seat}`].cards.length;

describe('slapjack', () => {
  it('the quickest reaction takes the pile, not the first to arrive', () => {
    const s = table(slapjack, [
      ['2S', 'JH'],
      ['3S', '4S'],
      ['5S', '6S'],
    ]);
    flip(slapjack, s);
    const race = s.data.race;
    // P1 arrives first but reacted slower (a fast connection); P2 arrives later with the quicker hand
    slapjack.apply(s, 1, { type: 'slap', race, rt: 420, at: 1000 });
    slapjack.apply(s, 2, { type: 'slap', race, rt: 260, at: 1120 });
    expect(slapjack.actions(s, 0).map((a) => a.type)).toEqual(['slap']); // no turning over while judging
    expect(slapjack.system!(s)!.delay).toBe(0); // (the window was at 1350 on the host clock: long gone)
    runSystem(slapjack, s);
    expect(count(s, 2)).toBe(3);
    expect(s.zones.pile.cards).toHaveLength(0);
    expect(s.turn).toBe(2);
  });

  it('a wrong slap pays a card to whoever turned it up', () => {
    const s = table(slapjack, [
      ['2S', '9H'],
      ['3S', '4S'],
    ]);
    flip(slapjack, s);
    slapjack.apply(s, 1, { type: 'slap', race: s.data.race, rt: 300 });
    expect(count(s, 1)).toBe(1);
    expect(count(s, 0)).toBe(2);
    // once per card
    expect(slapjack.actions(s, 1).some((a) => a.type === 'slap')).toBe(false);
    expect(() => slapjack.apply(s, 1, { type: 'slap', race: s.data.race })).toThrow();
  });

  it('a slap aimed at a card already covered does nothing', () => {
    const s = table(slapjack, [
      ['2S', '9H'],
      ['3S', '4S'],
    ]);
    flip(slapjack, s);
    const old = s.data.race;
    flip(slapjack, s);
    slapjack.apply(s, 0, { type: 'slap', race: old - 1, rt: 200 });
    expect(count(s, 0)).toBe(1);
    expect(s.data.slaps).toHaveLength(0);
  });

  it('out of cards, you can slap back in; miss the jack and you are out', () => {
    const s = table(slapjack, [['5S', 'JH', '2S'], ['3S'], ['4S', '6S', '7S']]);
    flip(slapjack, s, 0); // 2
    flip(slapjack, s, 1); // 3: P1 is out of cards
    expect(count(s, 1)).toBe(0);
    flip(slapjack, s, 2); // 7
    expect(s.turn).toBe(0); // P1 is skipped
    flip(slapjack, s, 0); // jack
    slapjack.apply(s, 1, { type: 'slap', race: s.data.race, rt: 200 });
    runSystem(slapjack, s);
    expect(count(s, 1)).toBe(4);
    expect(s.data.out[1]).toBe(false);

    const t = table(slapjack, [['5S', 'JH', '2S'], ['3S'], ['4S', '6S', '7S']]);
    flip(slapjack, t, 0);
    flip(slapjack, t, 1);
    flip(slapjack, t, 2);
    flip(slapjack, t, 0); // jack
    slapjack.apply(t, 2, { type: 'slap', race: t.data.race, rt: 200 });
    runSystem(slapjack, t);
    expect(t.data.out[1]).toBe(true);
    expect(slapjack.actions(t, 1)).toEqual([]);
  });

  it('the last one standing wins', () => {
    const s = table(slapjack, [['JH', '5S'], ['3S']]);
    flip(slapjack, s, 0);
    flip(slapjack, s, 1);
    flip(slapjack, s, 0); // jack, P1 has no cards
    slapjack.apply(s, 0, { type: 'slap', race: s.data.race, rt: 300 });
    runSystem(slapjack, s);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([0]);
    expect(count(s, 0)).toBe(3);
  });

  it('turning your last card over a jack nobody slapped puts out the empty-handed, not you', () => {
    // (it used to put everyone out, the turner too, and the game never ended)
    const s = table(slapjack, [['2S', '9S'], ['JH']]);
    flip(slapjack, s, 0); // 9
    flip(slapjack, s, 1); // jack: P1 has no cards left, and nobody slaps
    flip(slapjack, s, 0); // P0's last card covers it: P1 is out, and P0 holds everything
    expect(s.data.out).toEqual([false, true]);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([0]);
    expect(count(s, 0)).toBe(3);
  });

  it('a time limit ends the game and the most cards wins', () => {
    const s = table(
      slapjack,
      [
        ['2S', '9H', '8H'],
        ['3S', '4S'],
      ],
      { timer: 1 },
    );
    slapjack.apply(s, 0, { type: 'flip', at: 10_000 });
    expect(s.data.endsAt).toBe(10_000 + 5 * 60_000);
    runSystem(slapjack, s);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([0, 1]);
  });
});

describe('egyptian rat screw', () => {
  it('a court card must be answered in time, or its player takes the pile', () => {
    const s = table(ers, [
      ['2S', 'KH'],
      ['3S', '4S', '5S', '6S'],
    ]);
    flip(ers, s); // king: P1 has 3 tries
    expect(s.turn).toBe(1);
    flip(ers, s);
    flip(ers, s);
    expect(s.turn).toBe(1);
    flip(ers, s);
    expect(s.turn).toBe(null);
    expect(s.data.collect).toBe(0);
    expect(ers.system!(s)!.delay).toBeGreaterThan(500); // (time to slap it first)
    runSystem(ers, s);
    expect(count(s, 0)).toBe(5);
    expect(s.turn).toBe(0);
  });

  it('answering with a court card passes the challenge on', () => {
    const s = table(ers, [
      ['2S', 'KH'],
      ['3S', 'QS', '6S'],
    ]);
    flip(ers, s);
    flip(ers, s); // 6
    flip(ers, s); // queen: P0 has 2 tries
    expect(s.data.challenge).toEqual({ by: 1, left: 2 });
    expect(s.turn).toBe(0);
  });

  it('doubles slap by default; sandwiches, marriages and tens only when chosen', () => {
    const s = table(ers, [
      ['7S', '7H'],
      ['2S', '2H'],
    ]);
    flip(ers, s, 0); // 7
    flip(ers, s, 1); // 2
    flip(ers, s, 0); // 7: a sandwich, not on by default
    ers.apply(s, 1, { type: 'slap', race: s.data.race, rt: 200 });
    expect(s.data.slaps).toHaveLength(0);
    // a wrong slap burns a card face down under the pile
    expect(s.zones.pile.cards[0].up).toBe(false);
    expect(count(s, 1)).toBe(0);

    const t = table(
      ers,
      [
        ['7S', '7H'],
        ['2S', '2H'],
      ],
      { sandwich: true },
    );
    flip(ers, t, 0);
    flip(ers, t, 1);
    flip(ers, t, 0);
    ers.apply(t, 1, { type: 'slap', race: t.data.race, rt: 200 });
    expect(t.data.slaps).toHaveLength(1);

    const m = table(
      ers,
      [
        ['2S', 'KS'],
        ['3S', 'QH'],
      ],
      { marriage: true },
    );
    flip(ers, m, 0);
    flip(ers, m, 1);
    ers.apply(m, 0, { type: 'slap', race: m.data.race, rt: 200 });
    expect(m.data.slaps).toHaveLength(1);

    const ten = table(
      ers,
      [
        ['2S', '3S'],
        ['5D', '7H'],
      ],
      { tens: true },
    );
    flip(ers, ten, 0);
    flip(ers, ten, 1);
    ers.apply(ten, 1, { type: 'slap', race: ten.data.race, rt: 200 });
    expect(ten.data.slaps).toHaveLength(1);
  });

  it('a slap beats a challenge winner to the pile', () => {
    const s = table(ers, [
      ['2S', 'JH'],
      ['3S', 'JS'],
    ]);
    flip(ers, s); // jack: P1 has one try
    flip(ers, s); // jack again: doubles, and a new challenge
    ers.apply(s, 0, { type: 'slap', race: s.data.race, rt: 300 });
    runSystem(ers, s);
    expect(count(s, 0)).toBe(3);
    expect(s.data.challenge).toBe(null);
    expect(s.turn).toBe(0);
  });

  it('out of cards you can still slap back in, and whoever holds everything wins', () => {
    const s = table(ers, [['5S'], ['9C', '5H']]);
    flip(ers, s, 0); // P0 out of cards
    flip(ers, s, 1); // 5 on 5
    ers.apply(s, 0, { type: 'slap', race: s.data.race, rt: 300 });
    runSystem(ers, s);
    expect(count(s, 0)).toBe(2);
    expect(s.phase).toBe('play');

    const t = table(ers, [['4S'], ['5H', '9C']]);
    flip(ers, t, 0);
    flip(ers, t, 1); // 9: nothing to slap; P0 has no cards, so P1 goes on
    expect(t.turn).toBe(1);
    flip(ers, t, 1); // P1's last card: nobody can turn another, it goes to P1
    expect(t.data.collect).toBe(1);
    runSystem(ers, t);
    expect(t.phase).toBe('gameOver');
    expect(t.winner).toEqual([1]);
  });
});
