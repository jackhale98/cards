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

describe('euchre for six (pagat: Cornwall)', () => {
  const euchre = GAMES.euchre as GameModule<TrickData>;

  it('two teams of three, alternate seats; 32 cards with the 7s and 8s; five each and a turn-up', () => {
    const s = euchre.setup(bots(6), 1, {});
    expect(allCards(s)).toHaveLength(32);
    for (let i = 0; i < 6; i++) expect(ids(s, `hand:${i}`)).toHaveLength(5);
    expect(s.data.scores).toHaveLength(2);
    expect(euchre.status(s, 0).scoreboard!.rows.map((r) => r.name.split(' & ').length)).toEqual([3, 3]);
  });

  it('going alone: both partners sit out, and the trick has four cards', () => {
    const s = euchre.setup(bots(6), 2, {});
    const seat = s.turn!;
    euchre.apply(s, seat, { type: 'orderAlone' });
    while (s.phase === 'discard') euchre.apply(s, s.turn!, euchre.bot!(s, s.turn!)!);
    const out = s.data.outSeats!;
    expect(out.sort()).toEqual([(seat + 2) % 6, (seat + 4) % 6].sort());
    for (const o of out) expect(euchre.actions(s, o).find((a) => a.type === 'play')).toBeUndefined();
    // play a trick
    for (let k = 0; k < 4; k++) euchre.apply(s, s.turn!, euchre.bot!(s, s.turn!)!);
    expect(s.zones.trick.cards.length === 4 || s.data.trickNo === 1).toBe(true);
  });

  it('a march or a euchre scores 3 with six', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = euchre.setup(bots(6), seed, {});
      simulate(euchre, s, 60000, 'roundOver');
      const makers = s.data.maker! % 2;
      const won = [0, 2, 4].map((k) => (k + makers) % 6).reduce((n, i) => n + s.data.tricks[i], 0);
      const alone = s.data.sittingOut != null;
      if (won === 5 && !alone) {
        expect(s.data.scores[makers]).toBe(3);
        return;
      }
      if (won < 3 && s.data.defAlone == null) {
        expect(s.data.scores[1 - makers]).toBe(3);
        return;
      }
    }
    throw new Error('no march or euchre in 60 deals');
  });

  it('bots play whole games at six (and the thinking bots play a hand)', () => {
    const s = euchre.setup(bots(6), 9, {});
    simulate(euchre, s, 200000);
    expect(s.phase).toBe('gameOver');
    const n = euchre.setup(bots(6), 10, { botLevel: 1 });
    simulate(euchre, n, 60000, 'roundOver');
    expect(n.data.tricks.reduce((a, b) => a + b, 0)).toBe(5);
  }, 120000);
});

describe('canasta for three and six (pagat)', () => {
  const canasta = GAMES.canasta as GameModule<any>;

  it('six: three pairs, partners across; three packs and six jokers, 13 each; two canastas to go out', () => {
    const s = canasta.setup(bots(6), 1, {});
    expect(allCards(s)).toHaveLength(162);
    expect(allCards(s).filter((c) => c.startsWith('X'))).toHaveLength(6);
    for (let i = 0; i < 6; i++) expect(ids(s, `hand:${i}`).length).toBeGreaterThanOrEqual(13);
    expect(s.data.scores).toHaveLength(3);
    expect(canasta.status(s, 0).scoreboard!.rows.map((r) => r.name)).toEqual(['B0 & B3', 'B1 & B4', 'B2 & B5']);
    expect(canasta.actions(s, s.turn!).find((a) => a.type === 'draw')!.label).toBe('Draw');
  });

  it('three: 13 each, draw two; everyone alone until someone takes the pile, then the other two are partners', () => {
    const s = canasta.setup(bots(3), 2, {});
    for (let i = 0; i < 3; i++) expect(ids(s, `hand:${i}`).length).toBeGreaterThanOrEqual(13);
    expect(s.data.scores).toEqual([0, 0, 0]);
    expect(s.data.sides).toEqual([[0], [1], [2]]);
    expect(canasta.actions(s, s.turn!).find((a) => a.type === 'draw')!.label).toBe('Draw 2');
    // play until someone takes the pile
    for (let i = 0; i < 5000 && s.data.sides.every((x: number[]) => x.length === 1) && s.phase !== 'handOver' && s.phase !== 'gameOver'; i++) {
      const seat = s.turn!;
      canasta.apply(s, seat, canasta.bot!(s, seat)!);
    }
    if (s.phase === 'play' || s.phase === 'draw') {
      const sides = s.data.sides.filter((x: number[]) => x.length);
      expect(sides.map((x: number[]) => x.length).sort()).toEqual([1, 2]);
      // the partners' melds are one side's now: no two melds of the same rank on a side
      for (const side of [0, 1, 2]) {
        const ranks = s.data.melds.filter((m: any) => m.team === side).map((m: any) => m.rank);
        expect(new Set(ranks).size).toBe(ranks.length);
      }
    }
  });

  it('three: taking the pile makes the other two partners, their melds put together', () => {
    const s = canasta.setup(bots(3), 3, {});
    s.players.forEach((p) => (p.bot = false));
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones['hand:0'].cards = ['AH', 'AD', '4C', '6D'].map((id) => ({ id }));
    s.zones['hand:1'].cards = ['5S', '7D'].map((id) => ({ id }));
    s.zones['hand:2'].cards = ['5C', '7H'].map((id) => ({ id }));
    s.zones.discard.cards = [{ id: '9C', up: true }, { id: 'AS', up: true }];
    s.zones.deck.cards = ['5H', '6H', '7S', '8S'].map((id) => ({ id }));
    Object.assign(s.data, {
      sides: [[0], [1], [2]],
      red3: [[], ['3H'], []],
      melds: [
        { team: 1, rank: 12, cards: ['QH', 'QD', 'QS'] },
        { team: 2, rank: 12, cards: ['QC', 'QH#2', 'QD#2'] },
        { team: 2, rank: 8, cards: ['8H', '8D', '8C'] },
      ],
      frozen: false,
      melded: [false, true, true],
      turnMelded: false,
      ask: null,
      turnStartRanks: [],
    });
    s.phase = 'draw';
    s.turn = 0;
    canasta.apply(s, 0, { type: 'takePile', cards: ['AH', 'AD'] });
    expect(s.data.sides).toEqual([[0], [1, 2], []]);
    const partners = s.data.melds.filter((m: any) => m.team === 1);
    expect(partners.map((m: any) => [m.rank, m.cards.length]).sort()).toEqual([[12, 6], [8, 3]].sort());
    expect(s.data.melds.filter((m: any) => m.team === 2)).toEqual([]);
    // red threes stay with the player who laid them
    expect(s.data.red3).toEqual([[], ['3H'], []]);
    // partners can ask each other "may I go out?"; the lone player has nobody to ask
    expect(canasta.actions(s, 0).some((x) => x.type === 'ask')).toBe(false);
  });

  it('three: scores are kept per player, and partners each get the side’s score', () => {
    const s = canasta.setup(bots(3), 4, {});
    simulate(canasta, s, 100000, 'handOver');
    const sides = (s.data.sides as number[][]).filter((x) => x.length);
    const pair = sides.find((x) => x.length === 2);
    if (pair) {
      // the same side score plus each partner's own red threes
      const [a, b] = pair;
      const red = (i: number) => s.data.red3[i].length;
      if (red(a) === red(b)) expect(s.data.scores[a]).toBe(s.data.scores[b]);
    }
  });

  it('bots play whole games at three and six', () => {
    for (const n of [3, 6]) {
      const s = canasta.setup(bots(n), 20 + n, { target: 1500 });
      simulate(canasta, s, 400000);
      expect(s.phase).toBe('gameOver');
      expect(canasta.standings!(s)).toHaveLength(n);
    }
  }, 240000);
});

describe('six-handed spades and 500 (pagat): double packs', () => {
  const spades = GAMES.spades as GameModule<TrickData>;
  const five = GAMES['five-hundred'] as GameModule<TrickData>;


  it('spades for six: three pairs across; 102 cards (two packs without the 2♦s), 17 each', () => {
    const s = spades.setup(bots(6), 1, {});
    expect(allCards(s)).toHaveLength(102);
    expect(allCards(s).filter((c) => c.startsWith('2D'))).toHaveLength(0);
    for (let i = 0; i < 6; i++) expect(ids(s, `hand:${i}`)).toHaveLength(17);
    expect(spades.status(s, 0).scoreboard!.rows.map((r) => r.name)).toEqual(['B0 & B3', 'B1 & B4', 'B2 & B5']);
  });

  it('500 for six: two teams of three; 63 cards with the 2s, 3s and red 4s twice; 10 each and 3 in the kitty', () => {
    const s = five.setup(bots(6), 1, {});
    const cards = allCards(s);
    expect(cards).toHaveLength(63);
    expect(new Set(cards).size).toBe(63);
    expect(cards.filter((c) => c.startsWith('2S'))).toHaveLength(2);
    expect(cards.filter((c) => c.startsWith('4S'))).toHaveLength(1);
    for (let i = 0; i < 6; i++) expect(ids(s, `hand:${i}`)).toHaveLength(10);
    expect(five.status(s, 0).scoreboard!.rows.map((r) => r.name.split(' & ').length)).toEqual([3, 3]);
  });

  it('bots play whole games at six', () => {
    const sp = spades.setup(bots(6), 3, { target: 200 });
    simulate(spades, sp, 300000);
    expect(sp.phase).toBe('gameOver');
    const fh = five.setup(bots(6), 4, {});
    simulate(five, fh, 300000);
    expect(fh.phase).toBe('gameOver');
  }, 240000);
});

describe('identical cards in one trick', () => {
  it('the first played wins by default (six-handed 500); the later one with laterWinsTies (six-handed spades)', async () => {
    const { trickWinner } = await import('../src/engine/lib/trickTaking');
    const trick = ['9H', 'KH', 'KH#2', '4H'].map((id) => ({ id }));
    expect(trickWinner(trick, {})).toBe(1);
    expect(trickWinner(trick, { laterWinsTies: true })).toBe(2);
    // a trump still beats both
    expect(trickWinner([...trick, { id: '2S' }], { trump: 'S', laterWinsTies: true })).toBe(4);
  });
});

describe('500 for five (pagat): a called partner', () => {
  const five = GAMES['five-hundred'] as GameModule<TrickData>;
  /** Bid and discard with the bots until the contractor is calling a partner (not a misère). */
  const toCall = (seed: number) => {
    for (let k = seed; k < seed + 40; k++) {
      const s = five.setup(bots(5), k, {});
      for (let i = 0; i < 400 && s.phase !== 'callPartner' && s.phase !== 'play' && s.phase !== 'roundOver'; i++) {
        const sys = five.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        const seat = s.players.find((p) => five.bot!(s, p.seat))!.seat;
        five.apply(s, seat, five.bot!(s, seat)!);
      }
      if (s.phase === 'callPartner') return s;
    }
    throw new Error('no contract to call a partner for');
  };

  it('53 cards: 10 each and a kitty of 3; everyone scores alone', () => {
    const s = five.setup(bots(5), 1, {});
    expect(allCards(s)).toHaveLength(53);
    for (let i = 0; i < 5; i++) expect(ids(s, `hand:${i}`)).toHaveLength(10);
    expect(s.data.scores).toHaveLength(5);
  });

  it('the contractor calls a card (never the joker, a bower, or one of their own); its holder is the partner', () => {
    const s = toCall(1);
    const maker = s.data.maker!;
    const spec = five.actions(s, maker).find((a) => a.type === 'callCard')!;
    const labels = spec.choose!.options.map((o) => o.label);
    expect(labels.some((l) => l === 'Joker')).toBe(false);
    if (s.data.trump) expect(labels).not.toContain(`J${{ S: '♠', H: '♥', D: '♦', C: '♣' }[s.data.trump as 'S']}`);
    expect(five.actions(s, maker).some((a) => a.type === 'callAlone')).toBe(true);
    five.apply(s, maker, five.bot!(s, maker)!);
    const called = s.data.called!;
    expect(called).toBeTruthy();
    const holder = s.data.partner!;
    expect(ids(s, `hand:${holder}`)).toContain(called);
  });

  it('the partner is secret: only they know, until the card is played', async () => {
    const { redact } = await import('../src/engine/redact');
    const s = toCall(2);
    const maker = s.data.maker!;
    five.apply(s, maker, five.bot!(s, maker)!);
    const partner = s.data.partner!;
    const other = [0, 1, 2, 3, 4].find((i) => i !== maker && i !== partner)!;
    expect((redact(five, s, maker).data as TrickData).partner).toBeNull();
    expect((redact(five, s, other).data as TrickData).partner).toBeNull();
    expect((redact(five, s, partner).data as TrickData).partner).toBe(partner);
    expect(five.status(s, other).headline).toContain('partner card');
    expect(five.status(s, other).headline).not.toContain(s.players[partner].name);
    // play until the called card falls
    for (let i = 0; i < 200 && !s.data.partnerShown && s.phase !== 'roundOver'; i++) {
      const sys = five.system?.(s);
      if (sys) {
        sys.run(s);
        continue;
      }
      five.apply(s, s.turn!, five.bot!(s, s.turn!)!);
    }
    if (s.data.partnerShown) expect((redact(five, s, other).data as TrickData).partner).toBe(partner);
  });

  it('made with a partner: half the bid each; opponents 10 a trick each', () => {
    for (let k = 1; k < 60; k++) {
      const s = toCall(k);
      const maker = s.data.maker!;
      five.apply(s, maker, five.bot!(s, maker)!);
      const partner = s.data.partner;
      simulate(five, s, 60000, 'roundOver');
      if (partner == null) continue;
      const c = s.data.contract!;
      const won = s.data.tricks[maker] + s.data.tricks[partner];
      if (won < c.tricks || won === 10) continue;
      expect(s.data.scores[maker]).toBe(c.value / 2);
      expect(s.data.scores[partner]).toBe(c.value / 2);
      for (let i = 0; i < 5; i++) if (i !== maker && i !== partner) expect(s.data.scores[i]).toBe(s.data.tricks[i] * 10);
      return;
    }
    throw new Error('no made contract with a partner');
  });

  it('bots play whole games at five', () => {
    const s = five.setup(bots(5), 7, {});
    simulate(five, s, 300000);
    expect(s.phase).toBe('gameOver');
  }, 240000);
});
