import { describe, expect, it } from 'vitest';
import type { TrickData } from '../src/engine/families/trick';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

/**
 * Games at the other table sizes pagat gives (game.json `byPlayers`): the deck, the deal and the
 * rules that change, and bots playing whole games.
 */
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
const ids = (s: GameState<any>, z: string) => s.zones[z].cards.map((c) => c.id);
const allCards = (s: GameState<any>) => Object.values(s.zones).flatMap((z) => z.cards.map((c) => c.id));

/** Drive a game with bots for every seat (system steps run at once); presses "next" between rounds. */
export function simulate(g: GameModule, s: GameState, maxSteps = 60000, stopPhase = 'gameOver') {
  for (let step = 0; step < maxSteps; step++) {
    if (s.phase === stopPhase) return step;
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const seat = s.players.find((p) => g.bot!(s, p.seat))?.seat;
    if (seat != null) {
      g.apply(s, seat, g.bot!(s, seat)!);
      continue;
    }
    const next = s.players.find((p) => g.actions(s, p.seat).some((x) => x.type === 'next'));
    if (!next) throw new Error(`Stuck in phase ${s.phase}`);
    g.apply(s, next.seat, { type: 'next' });
  }
  throw new Error('Did not finish');
}

describe('hearts for three and five (pagat)', () => {
  const hearts = GAMES.hearts as GameModule<TrickData>;
  const passAll = (s: GameState<TrickData>) => s.players.forEach((_, i) => hearts.apply(s, i, { type: 'pass', cards: ids(s, `hand:${i}`).slice(0, 3) }));

  it('three: the 2♦ comes out, 17 each; passes left, right, then none', () => {
    const s = hearts.setup(bots(3), 1, {});
    expect(allCards(s)).toHaveLength(51);
    expect(allCards(s)).not.toContain('2D');
    for (let i = 0; i < 3; i++) expect(ids(s, `hand:${i}`)).toHaveLength(17);
    const dirs: (string | null)[] = [];
    for (let r = 0; r < 4; r++) {
      dirs.push(s.data.passDir);
      if (s.phase === 'pass') passAll(s);
      simulate(hearts, s, 60000, 'roundOver');
      if (r < 3) hearts.apply(s, 0, { type: 'next' });
    }
    expect(dirs).toEqual(['left', 'right', 'hold', 'left']);
  });

  it('five: the 2♦ and 2♣ come out, 10 each, the 3♣ leads; passes include two to the left and right', () => {
    const s = hearts.setup(bots(5), 2, {});
    expect(allCards(s)).toHaveLength(50);
    for (let i = 0; i < 5; i++) expect(ids(s, `hand:${i}`)).toHaveLength(10);
    passAll(s);
    expect(s.phase).toBe('play');
    expect(ids(s, `hand:${s.turn}`)).toContain('3C');
    const lead = hearts.actions(s, s.turn!).find((a) => a.type === 'play')!.select!.cards;
    expect(lead).toEqual(['3C']);
    // the third deal passes two to the left
    const t = hearts.setup(bots(5), 3, {});
    for (let r = 0; r < 2; r++) {
      passAll(t);
      simulate(hearts, t, 60000, 'roundOver');
      hearts.apply(t, 0, { type: 'next' });
    }
    expect(t.data.passDir).toBe('left2');
    const mine = ids(t, 'hand:0').slice(0, 3);
    hearts.apply(t, 0, { type: 'pass', cards: mine });
    for (let i = 1; i < 5; i++) hearts.apply(t, i, { type: 'pass', cards: ids(t, `hand:${i}`).slice(0, 3) });
    for (const c of mine) expect(ids(t, 'hand:2')).toContain(c);
  });

  it('the thinking bots (Normal) know which cards are out of the deck', () => {
    for (const n of [3, 5]) {
      const s = hearts.setup(bots(n), 10 + n, { botLevel: 1 });
      simulate(hearts, s, 60000, 'roundOver');
      expect(allCards(s)).toHaveLength(n === 3 ? 51 : 50);
    }
  }, 120000);

  it('bots play whole games at three, four and five, 26 points a hand', () => {
    for (const n of [3, 4, 5]) {
      const s = hearts.setup(bots(n), n, { target: 50 });
      simulate(hearts, s, 60000, 'roundOver');
      const sum = s.data.scores.reduce((a, b) => a + b, 0);
      // (or someone shot the moon: −26 for them, or +26 for everyone else)
      expect([26, -26, 26 * (n - 1)]).toContain(sum);
      hearts.apply(s, 0, { type: 'next' });
      simulate(hearts, s);
      expect(s.phase).toBe('gameOver');
    }
  }, 120000);
});

describe('spades for three (pagat)', () => {
  const spades = GAMES.spades as GameModule<TrickData>;

  it('everyone for themselves, 17 each with one card out; the lowest club leads', () => {
    const s = spades.setup(bots(3), 1, {});
    for (let i = 0; i < 3; i++) expect(ids(s, `hand:${i}`)).toHaveLength(17);
    expect(s.data.scores).toHaveLength(3);
    while (s.phase === 'bid') spades.apply(s, s.turn!, spades.bot!(s, s.turn!)!);
    expect(s.phase).toBe('play');
    const clubs = s.players.flatMap((_, i) => ids(s, `hand:${i}`)).filter((c) => c.endsWith('C')).sort((a, b) => '23456789TJQKA'.indexOf(a[0]) - '23456789TJQKA'.indexOf(b[0]));
    expect(ids(s, `hand:${s.turn}`)).toContain(clubs[0]);
    expect(spades.actions(s, s.turn!).find((a) => a.type === 'play')!.select!.cards).toEqual([clubs[0]]);
  });

  it('making your bid scores 10 a trick; each overtrick costs 10; missing costs 10 × the bid', () => {
    const s = spades.setup(bots(3), 2, {});
    while (s.phase === 'bid') spades.apply(s, s.turn!, spades.bot!(s, s.turn!)!);
    simulate(spades, s, 60000, 'roundOver');
    const bids = s.data.bids as number[];
    s.data.scores.forEach((score, i) => {
      const won = s.data.tricks[i];
      const bid = bids[i];
      const expected = bid === 0 ? (won === 0 ? 100 : -100 + 0) : won >= bid ? bid * 10 - (won - bid) * 10 : -bid * 10;
      if (bid !== 0) expect(score).toBe(expected);
    });
  });

  it('bots play whole games at three', () => {
    const s = spades.setup(bots(3), 3, { target: 200 });
    simulate(spades, s);
    expect(s.phase).toBe('gameOver');
  }, 120000);
});

describe('500 for three (pagat)', () => {
  const five = GAMES['five-hundred'] as GameModule<TrickData>;

  it('33 cards (7s to aces and the joker): 10 each and a kitty of 3; everyone scores alone', () => {
    const s = five.setup(bots(3), 1, {});
    const cards = allCards(s);
    expect(cards).toHaveLength(33);
    expect(cards.filter((c) => c.startsWith('X'))).toHaveLength(1);
    expect(cards.some((c) => /^[2-6]/.test(c))).toBe(false);
    for (let i = 0; i < 3; i++) expect(ids(s, `hand:${i}`)).toHaveLength(10);
    expect(s.data.scores).toHaveLength(3);
  });

  it('the contractor plays alone; each opponent scores 10 a trick for themselves', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = five.setup(bots(3), seed, {});
      simulate(five, s, 60000, 'roundOver');
      const maker = s.data.maker;
      if (maker == null || s.data.contract?.misere) continue;
      for (let i = 0; i < 3; i++) if (i !== maker) expect(s.data.scores[i]).toBe(s.data.tricks[i] * 10);
      expect(s.data.sittingOut).toBeNull();
      return;
    }
    throw new Error('no ordinary contract in 30 deals');
  });

  it('misère with three: the contractor plays alone and both others play (nobody sits out)', () => {
    const s = five.setup(bots(3), 4, {});
    // seven spades (misère can only be bid over a seven), then misère
    five.apply(s, s.turn!, { type: 'bid500', amount: 5 });
    const second = s.turn!;
    five.apply(s, second, { type: 'misere' });
    while (s.phase === 'auction') five.apply(s, s.turn!, { type: 'decline' });
    expect(s.data.maker).toBe(second);
    expect(s.data.contract!.misere).toBe('closed');
    expect(s.data.sittingOut).toBeNull();
    simulate(five, s, 60000, 'roundOver');
    // all three played every trick (a misère stops once its bidder takes one)
    const left = [0, 1, 2].map((i) => ids(s, `hand:${i}`).length);
    expect(new Set(left).size).toBe(1);
  });

  it('bots play whole games at three', () => {
    for (const seed of [5, 6]) {
      const s = five.setup(bots(3), seed, {});
      simulate(five, s, 200000);
      expect(s.phase).toBe('gameOver');
    }
  }, 180000);
});
