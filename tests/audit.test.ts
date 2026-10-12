import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/engine/cards';
import * as bet from '../src/engine/lib/betting';
import type { PokerData as HoldemData } from '../src/engine/families/poker';
import { GAMES } from './games';
import type { TrickData } from '../src/engine/families/trick';
import { isHidden, redact } from '../src/engine/redact';
import type { GameModule, GameState } from '../src/engine/types';

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
// quick bots (Easy): the search bots have their own tests
const defaults = (g: GameModule<any>) => ({ ...Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])), botLevel: 0 });
const cardsOf = (s: GameState<any>, z: string) => s.zones[z].cards.map((c) => c.id);

/** Play a game with bots (system steps included) until `until` holds or the game ends. */
function run<D>(g: GameModule<D>, s: GameState<D>, until: (s: GameState<D>) => boolean = () => false, max = 20000) {
  for (let i = 0; i < max && s.phase !== 'gameOver' && !until(s); i++) {
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
    if (seat < 0) {
      if (s.phase === 'roundOver') g.apply(s, 0, { type: 'next' });
      else return;
      continue;
    }
    const a = g.bot!(s, seat)!;
    expect(g.actions(s, seat).map((o) => o.type)).toContain(a.type);
    g.apply(s, seat, a);
  }
}

/** Rules fixed after checking every game against pagat.com. */

describe('poker (pagat)', () => {
  it('a short all-in raise does not reopen the betting for players who already acted', () => {
    const chips = [100, 100, 15];
    const b = bet.newBetting(3, [false, false, false]);
    b.minRaise = 10;
    bet.act(b, chips, 0, { type: 'raise', to: 10 });
    bet.act(b, chips, 1, { type: 'call' });
    bet.act(b, chips, 2, { type: 'allin' }); // 15: only 5 more, short of a full raise
    const o = bet.options(b, chips, 0);
    expect(o.toCall).toBe(5);
    expect(o.canRaise).toBe(false);
    expect(() => bet.act(b, chips, 0, { type: 'raise', to: 40 })).toThrow();
    bet.act(b, chips, 0, { type: 'call' });
    expect(chips[0]).toBe(85);
  });

  it('a full raise still reopens it', () => {
    const chips = [100, 100, 100];
    const b = bet.newBetting(3, [false, false, false]);
    b.minRaise = 10;
    bet.act(b, chips, 0, { type: 'raise', to: 10 });
    bet.act(b, chips, 1, { type: 'call' });
    bet.act(b, chips, 2, { type: 'raise', to: 20 });
    expect(bet.options(b, chips, 0).canRaise).toBe(true);
  });

  it('the odd chip of a split pot goes to the winner nearest the dealer’s left', () => {
    const holdem = GAMES.holdem;
    const s = holdem.setup([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 1, { stack: 100, bigBlind: 10 }) as GameState<HoldemData>;
    const btn = s.data.button;
    const sb = (btn + 1) % 3;
    const bb = (btn + 2) % 3;
    const hole: Record<number, string[]> = { [btn]: ['2C', '3D'], [sb]: ['4C', '7D'], [bb]: ['2D', '3C'] };
    for (const seat of [0, 1, 2]) s.zones[`hand:${seat}`].cards = hole[seat].map((id) => ({ id }));
    const board = ['AS', 'KS', 'QS', 'JS', 'TS'];
    const burns = ['4H', '5H', '6H'];
    const used = [...board, ...burns, ...Object.values(hole).flat()];
    s.zones.deck.cards = buildDeck().filter((c) => !used.includes(c)).map((id) => ({ id }));
    const order = [burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4]];
    s.zones.deck.cards.push(...order.reverse().map((id) => ({ id })));
    const act = (type: string) => holdem.apply(s, s.turn!, { type });
    expect(s.turn).toBe(btn);
    act('call'); // button 10
    act('fold'); // small blind leaves 5 behind: a pot of 25
    act('check'); // big blind
    for (let street = 0; street < 3; street++) {
      act('check');
      act('check');
    }
    expect(s.phase).toBe('handOver');
    // button and big blind split 25: the big blind is nearer the dealer's left, so takes 13
    expect(s.players[bb].chips).toBe(103);
    expect(s.players[btn].chips).toBe(102);
  });
});

describe('spades (pagat)', () => {
  const g = GAMES.spades as GameModule<TrickData>;

  /** A fresh hand where team 1 (seats 1 and 3) is 150 behind. */
  function behind(seed = 3) {
    const s = g.setup(people(4), seed, defaults(g));
    s.data.scores = [250, 100];
    s.phase = 'roundOver';
    g.apply(s, 0, { type: 'next' });
    return s;
  }

  it('offers blind nil to the side 100 behind, before they have seen their cards', () => {
    const s = behind();
    expect(s.phase).toBe('blind');
    expect([1, 3]).toContain(s.turn);
    const asker = s.turn!;
    // their own phone doesn't get their cards yet; the leading side's players see theirs
    expect(redact(g, s, asker).zones[`hand:${asker}`].cards.every((c) => isHidden(c.id))).toBe(true);
    expect(redact(g, s, 0).zones['hand:0'].cards.some((c) => isHidden(c.id))).toBe(false);
    expect(g.actions(s, asker).map((a) => a.type)).toEqual(['blindNil', 'look']);
  });

  it('blind nil: partner passes two, the bidder passes two back, scores ±200', () => {
    const s = behind();
    const blind = s.turn!;
    const partner = (blind + 2) % 4;
    g.apply(s, blind, { type: 'blindNil' });
    expect(s.phase).toBe('blindPass');
    expect(s.turn).toBe(partner);
    const give = cardsOf(s, `hand:${partner}`).slice(0, 2);
    g.apply(s, partner, { type: 'blindGive', cards: give });
    expect(cardsOf(s, `hand:${blind}`)).toEqual(expect.arrayContaining(give));
    expect(s.phase).toBe('blindReturn');
    expect(redact(g, s, blind).zones[`hand:${blind}`].cards.some((c) => isHidden(c.id))).toBe(false);
    const back = cardsOf(s, `hand:${blind}`).slice(-2);
    g.apply(s, blind, { type: 'blindGive', cards: back });
    expect(cardsOf(s, `hand:${blind}`)).toHaveLength(13);
    expect(s.phase).toBe('bid');
    expect(s.data.bids[blind]).toBe(0);
    // bidding skips the blind nil bidder
    for (let i = 0; i < 3; i++) {
      expect(s.turn).not.toBe(blind);
      g.apply(s, s.turn!, { type: 'bid', amount: 3 });
    }
    expect(s.phase).toBe('play');
    s.players.forEach((p) => (p.bot = true));
    run(g, s, (x) => x.phase === 'roundOver');
    const line = s.data.result!.lines.find((l) => l.includes('blind nil'))!;
    expect(line).toMatch(/(made|failed) blind nil/);
  });

  it('charges every ten bags, even two lots in one hand', () => {
    const s = g.setup(bots(4), 5, {});
    Object.assign(s.data, { bids: [1, 3, 1, 3], tricks: [6, 3, 5, 3], scores: [0, 0], bags: [9, 0] });
    s.data.trickNo = 13;
    s.data.handSize = 13;
    for (const z of Object.values(s.zones)) z.cards = [];
    s.phase = 'play';
    // score the hand directly via the last-trick path
    s.zones.trick.cards = [];
    s.data.trickNo = 12;
    s.data.tricks[0] = 5;
    ['AS', '2H', '3H', '4H'].forEach((id, i) => (s.zones[`hand:${i}`].cards = [{ id }]));
    s.data.broken = true;
    s.turn = 0;
    for (let i = 0; i < 4; i++) g.apply(s, i, { type: 'play', cards: [cardsOf(s, `hand:${i}`)[0]] });
    g.system!(s)!.run(s);
    // team 0 bid 2, took 11: 20 + 9 bags → 18 bags: one penalty, 8 left
    expect(s.data.bags[0]).toBe(8);
    // 9 + 9 = 18 → one lot. Now push past twenty:
    s.data.bags[0] = 19;
    s.data.scores = [0, 0];
    s.phase = 'play';
    s.data.trickNo = 12;
    Object.assign(s.data, { bids: [1, 3, 1, 3], tricks: [5, 3, 5, 3] });
    for (const z of Object.values(s.zones)) z.cards = [];
    ['AS', '2H', '3H', '4H'].forEach((id, i) => (s.zones[`hand:${i}`].cards = [{ id }]));
    s.turn = 0;
    for (let i = 0; i < 4; i++) g.apply(s, i, { type: 'play', cards: [cardsOf(s, `hand:${i}`)[0]] });
    g.system!(s)!.run(s);
    // 19 + 9 = 28 → two lots of 10 (−200), 8 left; 20 + 9 − 200
    expect(s.data.bags[0]).toBe(8);
    expect(s.data.scores[0]).toBe(-171);
  });

  it('level at the target: play another hand', () => {
    const s = g.setup(bots(4), 5, {});
    Object.assign(s.data, { bids: [2, 2, 2, 2], tricks: [3, 3, 3, 3], scores: [470, 470], bags: [0, 0], trickNo: 12, handSize: 13, broken: true });
    s.data.tricks[0] = 2;
    for (const z of Object.values(s.zones)) z.cards = [];
    ['AS', '2H', '3H', '4H'].forEach((id, i) => (s.zones[`hand:${i}`].cards = [{ id }]));
    s.phase = 'play';
    s.turn = 0;
    for (let i = 0; i < 4; i++) g.apply(s, i, { type: 'play', cards: [cardsOf(s, `hand:${i}`)[0]] });
    g.system!(s)!.run(s);
    expect(s.data.scores).toEqual([512, 512]);
    expect(s.phase).toBe('roundOver');
  });
});

describe('euchre (pagat)', () => {
  const g = GAMES.euchre as GameModule<TrickData>;

  it('the player left of a lone maker leads', () => {
    const s = g.setup(people(4), 2, defaults(g));
    // dealer is seat 3; seat 2 (across from the first bidder) goes alone on a named suit
    while (s.phase === 'order') g.apply(s, s.turn!, { type: 'decline' });
    expect(s.phase).toBe('name');
    g.apply(s, s.turn!, { type: 'decline' });
    expect(s.turn).toBe(1);
    g.apply(s, 1, { type: 'decline' });
    const suit = ['S', 'H', 'D', 'C'].findIndex((x) => x !== s.data.upcard!.slice(-1));
    g.apply(s, 2, { type: 'nameAlone', amount: suit });
    expect(s.phase).toBe('play');
    expect(s.data.sittingOut).toBe(0);
    expect(s.turn).toBe(3);
  });

  it('a defender may go alone, leads, and euchres for 4', () => {
    const s = g.setup(people(4), 2, { ...defaults(g), defendAlone: true });
    g.apply(s, 0, { type: 'order' }); // seat 0 orders up: dealer (3) picks up and discards
    g.apply(s, 3, { type: 'bury', cards: [cardsOf(s, 'hand:3')[0]] });
    expect(s.phase).toBe('defend');
    expect(s.turn).toBe(1);
    g.apply(s, 1, { type: 'defendAlone' });
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1);
    expect(g.status!(s, 3).seats[3].badge).toMatch(/Sitting out/);
    s.players.forEach((p) => (p.bot = true));
    run(g, s, (x) => x.phase === 'roundOver' || x.phase === 'gameOver');
    const team1 = s.data.scores[1];
    const won = s.data.tricks[0] + s.data.tricks[2];
    if (won < 3) expect(team1).toBe(4);
  });
});

describe('500 joker (pagat)', () => {
  const g = GAMES['five-hundred'] as GameModule<TrickData>;

  /** Seat 0 wins a no-trump bid holding the joker. */
  function noTrumps(misere = false) {
    const s = g.setup(people(4), 4, defaults(g));
    const hold = (seat: number) => s.zones[`hand:${seat}`].cards;
    // make sure seat 0 has the joker
    const where = Object.values(s.zones).find((z) => z.cards.some((c) => c.id.includes('X')))!;
    const j = where.cards.findIndex((c) => c.id.includes('X'));
    if (where.id !== 'hand:0') [where.cards[j], hold(0)[0]] = [hold(0)[0], where.cards[j]];
    s.turn = 0;
    if (misere) {
      // misère needs a seven first
      g.apply(s, 0, { type: 'bid500', amount: g.actions(s, 0).find((a) => a.type === 'bid500')!.choose!.options.find((o) => o.label.startsWith('7\u2009♠'))!.value });
      g.apply(s, 1, { type: 'decline' });
      g.apply(s, 2, { type: 'decline' });
      g.apply(s, 3, { type: 'misere' });
      g.apply(s, 0, { type: 'decline' });
      return { s, maker: 3 };
    }
    const opts = g.actions(s, 0).find((a) => a.type === 'bid500')!.choose!.options;
    g.apply(s, 0, { type: 'bid500', amount: opts.find((o) => o.label.includes('NT'))!.value });
    for (const i of [1, 2, 3]) g.apply(s, i, { type: 'decline' });
    return { s, maker: 0 };
  }

  it('the contractor can make the joker the top card of a suit before the lead', () => {
    const { s } = noTrumps();
    g.apply(s, 0, { type: 'bury', cards: cardsOf(s, 'hand:0').filter((c) => !c.includes('X')).slice(0, 3) });
    expect(s.phase).toBe('joker');
    const choose = g.actions(s, 0)[0].choose!.options;
    expect(choose.map((o) => o.value)).toEqual([0, 1, 2, 3, 4]);
    g.apply(s, 0, { type: 'nominate', amount: 1 }); // hearts
    expect(s.data.jokerSuit).toBe('H');
    expect(s.phase).toBe('play');
    // now it's just the top heart: it leads like any card
    expect(g.actions(s, 0).find((a) => a.type === 'play')!.select!.cards.some((c) => c.includes('X'))).toBe(true);
  });

  it('a suitless joker is led by calling a suit not yet led; the others must follow it', () => {
    const { s } = noTrumps();
    g.apply(s, 0, { type: 'bury', cards: cardsOf(s, 'hand:0').filter((c) => !c.includes('X')).slice(0, 3) });
    g.apply(s, 0, { type: 'nominate', amount: 4 });
    expect(s.data.jokerSuit).toBeNull();
    const plays = g.actions(s, 0).find((a) => a.type === 'play')!.select!.cards;
    expect(plays.some((c) => c.includes('X'))).toBe(false);
    const lead = g.actions(s, 0).find((a) => a.type === 'leadJoker')!;
    expect(lead.choose!.options).toHaveLength(4);
    g.apply(s, 0, { type: 'leadJoker', amount: 2 }); // diamonds
    const legal = g.actions(s, 1).find((a) => a.type === 'play')!.select!.cards;
    const diamonds = cardsOf(s, 'hand:1').filter((c) => c.endsWith('D') || c === 'JH');
    if (diamonds.length) expect(legal.every((c) => diamonds.includes(c) || c.endsWith('D'))).toBe(true);
    for (const i of [1, 2, 3]) g.apply(s, i, { type: 'play', cards: [g.actions(s, i).find((a) => a.type === 'play')!.select!.cards[0]] });
    g.system!(s)!.run(s);
    expect(s.data.tricks[0]).toBe(1); // the joker won
    // diamonds have now been led, so the joker can't call them again
    expect(s.data.ledSuits).toContain('D');
  });

  it('misère: the contractor holding the joker must give it a suit', () => {
    const { s, maker } = noTrumps(true);
    // move the joker to the misère bidder
    const j = s.zones['hand:0'].cards.findIndex((c) => c.id.includes('X'));
    [s.zones['hand:0'].cards[j], s.zones[`hand:${maker}`].cards[0]] = [s.zones[`hand:${maker}`].cards[0], s.zones['hand:0'].cards[j]];
    g.apply(s, maker, { type: 'bury', cards: cardsOf(s, `hand:${maker}`).filter((c) => !c.includes('X')).slice(0, 3) });
    expect(s.phase).toBe('joker');
    expect(g.actions(s, maker)[0].choose!.options.map((o) => o.value)).toEqual([0, 1, 2, 3]);
  });

  it('bots play no-trump and misère hands with the joker through to the end', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = g.setup(bots(4), seed, defaults(g));
      run(g, s, (x) => x.phase === 'roundOver', 3000);
    }
  });
});

describe('cut for deal (pagat: low card deals)', () => {
  it.each(['cribbage', 'gin-rummy'])('%s cuts for the first dealer', (id) => {
    const g = GAMES[id];
    const dealers = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = g.setup(bots(2), seed, defaults(g));
      expect(s.log.some((l) => l.text.startsWith('Cut for deal'))).toBe(true);
      dealers.add(s.dealer);
    }
    expect(dealers.size).toBe(2);
  });
});

describe('cribbage (pagat)', () => {
  const g = GAMES.cribbage as GameModule<any>;
  it('the loser deals first in the next game, and a skunk is called', () => {
    const s = g.setup(bots(2), 4, { ...defaults(g), target: 121 });
    run(g, s);
    expect(s.phase).toBe('gameOver');
    const loser = s.winner!.includes(0) ? 1 : 0;
    const lost = s.data.scores[loser];
    if (lost < 91) expect(s.data.result.lines.join(' ')).toMatch(/skunk/);
    g.apply(s, 0, { type: 'rematch' });
    expect(s.dealer).toBe(loser);
  });
});

describe('gin rummy (pagat)', () => {
  it('the defender arranges melds to lay off as much as possible', async () => {
    const { bestMelds } = await import('../src/engine/lib/melds');
    // 7-8-9♠ would leave 7♥ 7♦; the three 7s instead let 8♠ 9♠ go on the knocker's 10-J-Q♠
    const r = bestMelds(['7S', '7H', '7D', '8S', '9S'], [['TS', 'JS', 'QS']]);
    expect(r.points).toBe(0);
    expect(r.laid.sort()).toEqual(['8S', '9S']);
    expect(bestMelds(['7S', '7H', '7D', '8S', '9S']).points).toBe(14);
  });

  it('the game bonus doubles on a shutout', () => {
    const g = GAMES['gin-rummy'] as GameModule<any>;
    const s = g.setup(people(2), 3, defaults(g));
    s.data.scores = [95, 0];
    const me = 0;
    // rig a gin hand for seat 0 with a spare card to discard
    for (const z of Object.values(s.zones)) if (z.id.startsWith('hand')) z.cards = [];
    s.zones['hand:0'].cards = ['AS', '2S', '3S', '4H', '5H', '6H', '7C', '8C', '9C', 'TC', 'KD'].map((id) => ({ id }));
    s.zones['hand:1'].cards = ['KS', 'QH', 'JD', '9S', '8H', '7D', '6S', '5C', '4D', '3H'].map((id) => ({ id }));
    s.phase = 'discard';
    s.turn = me;
    g.apply(s, me, { type: 'gin', cards: ['KD'] });
    expect(s.phase).toBe('gameOver');
    expect(s.data.result.lines.join(' ')).toMatch(/200 shutout/);
  });
});

describe('bots play with their partner', () => {
  const g = GAMES['five-hundred'] as GameModule<TrickData>;
  /** Seat 2 (partner of seat 0) to play to a trick seat 0 is winning. */
  function rig(hand2: string[], trump: string | null) {
    const s = g.setup(bots(4), 5, defaults(g));
    for (const z of Object.values(s.zones)) z.cards = [];
    s.zones.trick.cards = [{ id: 'AH', by: 0, up: true }, { id: '5H', by: 1, up: true }];
    s.zones['hand:2'].cards = hand2.map((id) => ({ id }));
    s.zones['hand:3'].cards = ['6H', '7C'].map((id) => ({ id }));
    Object.assign(s.data, { trump, maker: 0, contract: { tricks: 7, suit: trump ?? 'NT', value: 140 }, trickNo: 3, handSize: 10, sittingOut: null, ledSuits: ['H'] });
    s.phase = 'play';
    s.turn = 2;
    return s;
  }

  it('plays low under partner’s winning card instead of wasting a high one', () => {
    const s = rig(['KH', '4H'], 'S');
    expect(g.bot!(s, 2)).toEqual({ type: 'play', cards: ['4H'] });
  });

  it('void: throws a cheap card rather than trumping partner’s trick', () => {
    const s = rig(['9S', 'QC', 'AC'], 'S');
    expect(g.bot!(s, 2)).toEqual({ type: 'play', cards: ['QC'] });
  });

  it('still beats an opponent who is winning', () => {
    const s = rig(['KH', '4H'], 'S');
    s.zones.trick.cards = [{ id: 'QH', by: 1, up: true }];
    s.turn = 2;
    expect(g.bot!(s, 2)).toEqual({ type: 'play', cards: ['KH'] });
  });
});
