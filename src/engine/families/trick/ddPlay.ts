import { parseCard } from '../../cards';
import { moreSamples, now, TESTING, type SearchBudget } from '../../bots/search';
import { solveCards } from '../../bots/dds';
import { ids, nextSeat, zone } from '../../state';
import { isMisere, legalCards, rankFor, suitFor, suitless, suitOf } from './play';
import { readAuction } from './systems/bidder';
import { biddingSystem } from './systems/choice';
import { handInfo } from './systems/auction';
import type { Hand, Picture } from './systems/hands';
import { playersThisHand, teamOf, teamsFor } from './sides';
import type { S, TrickGame } from './types';
import type { Action } from '../../types';
import { ALL_BIDS, NAMEABLE } from './contracts';
import { higherBids } from './bidding';

/**
 * Hard card play in the partnership trick games (bridge, Spades, Whist, Euchre, 500): the way the
 * strong bridge programs play. The bot deals the cards it can't see many times over, each deal
 * fitting everything that's public (the cards played, who has shown out of a suit, and in bridge
 * what each player's bids promised), has DDS (the double-dummy solver) work out what every card
 * it may play is worth on each deal with all the cards known, and plays the card that does best
 * across them.
 *
 * DDS plays by bridge's rules: follow suit, the highest trump or else the highest card of the suit
 * led wins. Other games fit by renaming their cards: Euchre's bowers and 500's joker become the top
 * trumps, each suit's cards ranked in the order they really take tricks.
 *
 * It only ever sees its own seat's view (see botView.ts): its own hand, dummy once it's down, and
 * the cards played. Returns null when DDS isn't loaded yet, or the hand isn't one it can solve.
 */

const SUITS = ['S', 'H', 'D', 'C'];

/** Hard's budget: deals per card, and time (early in a hand each deal takes longest to solve). */
export const DD_BUDGET: SearchBudget & { least: number } = { samples: 40, ms: 1200, least: 6 };

/** The budget to use: under the test runner a fixed few deals (DD_SAMPLES to measure with more). */
export function ddBudget(): SearchBudget & { least: number } {
  if (!TESTING) return DD_BUDGET;
  const n = Number(typeof process !== 'undefined' ? process.env?.DD_SAMPLES : 0) || 4;
  return { samples: n, ms: Infinity, least: n };
}

/**
 * Whether DDS can play this hand: four players in two partnerships across the table, all in it,
 * playing for tricks (not Hearts' points, a misère, or a Spades nil on this side), and every card
 * ranking in a plain suit.
 */
/** A game whose four-handed play DDS could solve (before the deal: whether to fetch it). */
export const ddGame = (g: TrickGame, players: number) =>
  players === 4 && JSON.stringify(teamsFor(g, 4)) === '[[0,2],[1,3]]' && g.R.scoring.type !== 'penalty' && !g.R.trumpAnytime && !g.R.duplicates;

export function ddPlayable(g: TrickGame, s: S, seat: number): boolean {
  const d = s.data;
  if (s.players.length !== 4 || s.phase !== 'play' || playersThisHand(g, s) !== 4) return false;
  if (JSON.stringify(teamsFor(g, 4)) !== '[[0,2],[1,3]]') return false;
  if (g.R.scoring.type === 'penalty' || g.R.trumpAnytime || g.R.duplicates || isMisere(s)) return false;
  // (a nil bid on this side: it wants one player to take no tricks, not the side to take most)
  if (g.nilAllowed && d.bids.some((b, i) => b === 0 && teamOf(g, s, i) === teamOf(g, s, seat))) return false;
  // (a joker with no suit, in no trumps: no plain card plays like it)
  if (s.players.some((p) => ids(zone(s, `hand:${p.seat}`)).some((c) => suitless(g, s, c)))) return false;
  return !!ranks(g, d.trump);
}

/** Each card as DDS sees it (suit 0–3: spades, hearts, diamonds, clubs; rank 0–12), for this trump. */
const RANKS_FOR = new Map<string, Map<string, { suit: number; rank: number }> | null>();
function ranks(g: TrickGame, trump: string | null) {
  const key = `${g.config.id}:${trump}`;
  if (RANKS_FOR.has(key)) return RANKS_FOR.get(key)!;
  const out = new Map<string, { suit: number; rank: number }>();
  let ok = true;
  for (const [k, x] of SUITS.entries()) {
    // the suit's cards (a trump suit with its bowers and joker), best first, renamed A, K, Q …
    const cards = g.deckCards.filter((c) => suitFor(g, c, trump as never) === x).sort((a, b) => rankFor(g, b, trump as never) - rankFor(g, a, trump as never));
    if (cards.length > 13 || new Set(cards.map((c) => rankFor(g, c, trump as never))).size < cards.length) ok = false;
    cards.forEach((c, i) => out.set(c, { suit: k, rank: 12 - i }));
  }
  if (out.size !== g.deckCards.length) ok = false;
  RANKS_FOR.set(key, ok ? out : null);
  return ok ? out : null;
}

export function ddCard(g: TrickGame, s: S, seat: number, budget = DD_BUDGET, rand: () => number = Math.random): string | null {
  const d = s.data;
  const mover = s.turn!;
  if (!ddPlayable(g, s, seat)) return null;
  const map = ranks(g, d.trump)!;
  const legal = legalCards(g, s, mover);
  if (legal.length <= 1) return legal[0] ?? null;

  // what this seat knows: its hand, dummy (once down), the trick, and the cards already played
  const known = new Map<number, string[]>();
  known.set(seat, ids(zone(s, `hand:${seat}`)));
  const dummy = d.dummyUp && d.dummy != null ? d.dummy : null;
  if (dummy != null) known.set(dummy, ids(zone(s, 'dummy')));
  const trick = zone(s, 'trick').cards;
  const gone = new Set<string>([...trick.map((c) => c.id), ...(d.played ?? []).flat()]);
  for (const cards of known.values()) for (const c of cards) gone.add(c);
  const pool = g.deckCards.filter((c) => !gone.has(c));
  const hidden = [0, 1, 2, 3].filter((x) => !known.has(x));
  const counts = hidden.map((x) => (x === dummy ? 0 : zone(s, `hand:${x}`).cards.length));
  // (the cards nobody holds: a kitty, or those not dealt)
  const rest = pool.length - counts.reduce((a, b) => a + b, 0);
  if (rest < 0) return null;

  // in bridge, what each hidden hand's bids promised (its whole hand: the cards it holds and those it played)
  const system = g.bridgeBids ? biddingSystem(g, s) : null;
  const team = teamOf(g, s, seat);
  const vul = d.vul ?? [false, false];
  const pics = hidden.map((x) => (system ? readAuction(system, d.calls ?? [], (x + 2) % 4, [!!vul[team], !!vul[1 - team]]).pic : null));
  const voids = hidden.map((x) => new Set(d.voids?.[x] ?? []));
  const suitIn = (c: string) => suitOf(g, s, c);

  const leader = trick.length ? trick[0].by! : mover;
  const trump = d.trump ? SUITS.indexOf(d.trump) : 4;
  const shown = trick.map((c) => map.get(c.id)!);
  const maskOf = (cards: string[]) => {
    const m = [0, 0, 0, 0];
    for (const c of cards) {
      const p = map.get(c)!;
      m[p.suit] |= 1 << p.rank;
    }
    return m;
  };
  const named = new Map([...map].map(([c, p]) => [`${p.suit}:${p.rank}`, c]));

  const total = new Map<string, number>(legal.map((c) => [c, 0]));
  const best = new Map<string, number>(legal.map((c) => [c, 0]));
  let runs = 0;
  let strict = true;
  const stop = now() + budget.ms;
  for (let tries = 0; moreSamples(runs, budget.samples, budget.least, stop) && tries < budget.samples * 60; tries++) {
    // (after many misses, the bids are let go: someone may have bid a little off the card)
    if (tries === budget.samples * 30) strict = false;
    const dealt = deal(pool, [...counts, rest], [...voids, new Set<string>()], suitIn, rand);
    if (!dealt) continue;
    if (strict && !hidden.every((x, i) => !pics[i] || fits(pics[i]!, [...dealt[i], ...(d.played?.[x] ?? [])]))) continue;
    const hands = [0, 1, 2, 3].map((x) => maskOf(known.get(x) ?? dealt[hidden.indexOf(x)]));
    const values = solveCards({ hands, trump, leader, trick: shown });
    if (!values) return null;
    runs++;
    const top = Math.max(...values.map((v) => v.tricks));
    for (const v of values) {
      const id = named.get(`${v.suit}:${v.rank}`)!;
      if (!total.has(id)) continue;
      total.set(id, total.get(id)! + v.tricks);
      if (v.tricks === top) best.set(id, best.get(id)! + 1);
    }
  }
  if (!runs) return null;
  // the most tricks on average; then the card that's best most often (it keeps the most chances);
  // then the cheapest
  const score = (c: string) => total.get(c)! / runs + (0.05 * best.get(c)!) / runs;
  return [...legal].sort((a, b) => score(b) - score(a) || map.get(a)!.rank - map.get(b)!.rank)[0];

  function fits(p: Picture, cards: string[]): boolean {
    const hand: Hand = SUITS.map((x) =>
      cards
        .filter((c) => suitOf(g, s, c) === x)
        .map((c) => parseCard(c).rank)
        .sort((a, b) => b - a),
    );
    const h = handInfo(hand);
    if (h.hcp < p.hcp[0] || h.hcp > p.hcp[1]) return false;
    if (h.len.some((n, k) => n < p.minLen[k] || n > p.maxLen[k])) return false;
    return !p.test || p.test(hand);
  }
}

/** The unseen cards dealt to the hidden hands (sizes `counts`), none in a suit its holder is out of. */
function deal(pool: string[], counts: number[], voids: Set<string>[], suitIn: (c: string) => string, rand: () => number): string[][] | null {
  const cards = [...pool];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const out: string[][] = counts.map(() => []);
  // the cards that can only go one way first, so the free choices don't use up the room they need
  const choices = (c: string) => counts.map((_, i) => i).filter((i) => !voids[i].has(suitIn(c)));
  cards.sort((a, b) => choices(a).length - choices(b).length);
  for (const c of cards) {
    const open = choices(c).filter((i) => out[i].length < counts[i]);
    if (!open.length) return null;
    out[open[Math.floor(rand() * open.length)]].push(c);
  }
  return out;
}

/**
 * Hard bidding in the trick-count games (Spades): how many tricks this side is nearly sure to take,
 * found by dealing the other hands many times and solving each deal double dummy from the opening
 * lead (the tricks it makes on all but the worst deal in seven); then this player's share of them (the rest, when partner has bid; else what their cards are worth
 * beside an average partner's). Returns null when DDS can't help (not loaded, not this kind of game).
 */
export function ddBid(g: TrickGame, s: S, seat: number, quick: (cards: string[]) => number, rand: () => number = Math.random): number | null {
  const d = s.data;
  if (!g.trickBids || !ddGame(g, s.players.length) || !d.trump) return null;
  const map = ranks(g, d.trump);
  if (!map) return null;
  const mine = ids(zone(s, `hand:${seat}`));
  const pool = g.deckCards.filter((c) => !mine.includes(c));
  const size = d.handSize;
  if (pool.length < 3 * size) return null;
  const others = [0, 1, 2, 3].filter((x) => x !== seat);
  const partner = (seat + 2) % 4;
  const leader = nextSeat(s, s.dealer);
  const trump = SUITS.indexOf(d.trump);
  const maskOf = (cards: string[]) => {
    const m = [0, 0, 0, 0];
    for (const c of cards) {
      const p = map.get(c)!;
      m[p.suit] |= 1 << p.rank;
    }
    return m;
  };
  const budget = ddBudget();
  const samples = Math.max(4, Math.round(budget.samples / 4));
  const sideTricks: number[] = [];
  let partnerWorth = 0;
  let runs = 0;
  const stop = now() + budget.ms;
  while (moreSamples(runs, samples, Math.min(4, samples), stop)) {
    const cards = [...pool];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    const hands = new Map<number, string[]>([[seat, mine]]);
    others.forEach((x, k) => hands.set(x, cards.slice(k * size, (k + 1) * size)));
    const values = solveCards({ hands: [0, 1, 2, 3].map((x) => maskOf(hands.get(x)!)), trump, leader, trick: [] });
    if (!values) return null;
    const best = Math.max(...values.map((v) => v.tricks));
    // (the solver counts the leader's side's tricks)
    sideTricks.push(leader % 2 === seat % 2 ? best : size - best);
    partnerWorth += quick(hands.get(partner)!);
    runs++;
  }
  if (!runs) return null;
  // what the side makes on all but the worst deals in seven: one trick short costs the whole bid,
  // one over only a bag, so the side bids what it's nearly sure of, not what it takes on average
  sideTricks.sort((a, b) => a - b);
  const side = sideTricks[Math.floor(sideTricks.length * 0.15)];
  const theirs = d.bids[partner];
  let bid: number;
  if (theirs != null && theirs > 0) bid = Math.floor(side - theirs);
  else {
    const me = quick(mine);
    const share = me / Math.max(0.5, me + partnerWorth / runs);
    bid = Math.floor(side * share);
  }
  return Math.max(g.nilAllowed ? 1 : 0, Math.min(size, bid));
}

/**
 * Hard Euchre: whether to order up (or, in the second round, which suit to name), by trying each
 * choice on many deals of the hidden cards, each solved double dummy and scored as Euchre scores
 * it (the makers 1 for three or four tricks, 2 for all five; euchred, 2 to the defenders). Passing
 * counts as nothing either way. Going alone stays with the quick rules (`quick`); so does anything
 * DDS can't help with (returns null).
 */
export function ddEuchreCall(g: TrickGame, s: S, seat: number, quick: Action | null, rand: () => number = Math.random): Action | null {
  const d = s.data;
  if (!g.euchreBids || !ddGame(g, s.players.length) || !d.upcard || (s.phase !== 'order' && s.phase !== 'name')) return null;
  if (quick && (quick.type === 'orderAlone' || quick.type === 'nameAlone')) return quick;
  const mine = ids(zone(s, `hand:${seat}`));
  const up = d.upcard;
  const upSuit = parseCard(up).suit;
  const size = mine.length;
  const leader = nextSeat(s, s.dealer);
  const myTeam = seat % 2;
  // each choice: its trumps, and the action
  const choices: { trump: string; action: Action }[] =
    s.phase === 'order'
      ? [{ trump: upSuit, action: { type: 'order' } }]
      : NAMEABLE.filter((x) => x !== upSuit).map((x) => ({ trump: x, action: { type: 'name', amount: NAMEABLE.indexOf(x) } }));
  const stuck = s.phase === 'name' && g.euchreBids.stickTheDealer && seat === s.dealer;
  const pool = g.deckCards.filter((c) => !mine.includes(c) && c !== up);
  const samples = TESTING ? Number(typeof process !== 'undefined' ? process.env?.DD_SAMPLES : 0) || 12 : 40;
  let best: { action: Action; ev: number } | null = null;
  for (const choice of choices) {
    const map = ranks(g, choice.trump);
    if (!map) return null;
    const maskOf = (cards: string[]) => {
      const m = [0, 0, 0, 0];
      for (const c of cards) m[map.get(c)!.suit] |= 1 << map.get(c)!.rank;
      return m;
    };
    let ev = 0;
    for (let k = 0; k < samples; k++) {
      const cards = [...pool];
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      const hands: string[][] = [];
      let at = 0;
      for (let x = 0; x < 4; x++) hands.push(x === seat ? [...mine] : cards.slice(at, (at += size)));
      // ordered up: the dealer takes the upcard and throws away their weakest card
      if (s.phase === 'order') {
        const dealt = hands[s.dealer];
        dealt.push(up);
        const weak = (c: string) => (suitFor(g, c, choice.trump as never) === choice.trump ? 100 : 0) + rankFor(g, c, choice.trump as never);
        dealt.splice(dealt.indexOf([...dealt].sort((a, b) => weak(a) - weak(b))[0]), 1);
      }
      const values = solveCards({ hands: hands.map(maskOf), trump: SUITS.indexOf(choice.trump), leader, trick: [] });
      if (!values) return null;
      const top = Math.max(...values.map((v) => v.tricks));
      const ours = leader % 2 === myTeam ? top : size - top;
      ev += ours >= 3 ? (ours === size ? 2 : 1) : -2;
    }
    ev /= samples;
    if (!best || ev > best.ev) best = { action: choice.action, ev };
  }
  if (!best) return null;
  // (a little margin: a doubtful call hands the other side two points when it fails)
  return best.ev > 0.15 || stuck ? best.action : { type: 'decline' };
}

/**
 * Hard 500: what to bid, by trying each trump suit on deals of the hidden cards: taking the kitty,
 * burying the three weakest cards, and solving the play double dummy with this player leading, as
 * the contractor does. It bids the cheapest contract still open that it makes on most deals, or
 * passes. No trumps and misère stay with
 * the quick rules (`quick`): a joker with no suit plays like no plain card.
 */
export function dd500Bid(g: TrickGame, s: S, seat: number, quick: Action | null, rand: () => number = Math.random): Action | null {
  if (!g.auction || !ddGame(g, s.players.length) || s.phase !== 'auction') return null;
  const open = higherBids(g, s);
  if (quick?.type === 'bid500' && ALL_BIDS[quick.amount!]?.misere) return quick;
  const mine = ids(zone(s, `hand:${seat}`));
  const size = mine.length;
  const kitty = g.R.kitty ?? 3;
  const pool = g.deckCards.filter((c) => !mine.includes(c));
  if (pool.length !== 3 * size + kitty) return null;
  const samples = TESTING ? Number(typeof process !== 'undefined' ? process.env?.DD_SAMPLES : 0) || 6 : 16;
  // tricks this side takes with each suit as trumps, deal by deal
  const taken = new Map<string, number[]>();
  for (const trump of NAMEABLE) {
    if (!open.some((b) => !b.misere && b.suit === trump)) continue;
    const map = ranks(g, trump);
    if (!map) return null;
    const maskOf = (cards: string[]) => {
      const m = [0, 0, 0, 0];
      for (const c of cards) m[map.get(c)!.suit] |= 1 << map.get(c)!.rank;
      return m;
    };
    const keep = (c: string) => (suitFor(g, c, trump) === trump ? 100 : 0) + rankFor(g, c, trump);
    const out: number[] = [];
    for (let k = 0; k < samples; k++) {
      const cards = [...pool];
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      const hands: string[][] = [];
      let at = 0;
      for (let x = 0; x < 4; x++) hands.push(x === seat ? [...mine] : cards.slice(at, (at += size)));
      // the contractor takes the kitty and buries the three weakest
      hands[seat] = [...mine, ...cards.slice(at, at + kitty)].sort((a, b) => keep(b) - keep(a)).slice(0, size);
      const values = solveCards({ hands: hands.map(maskOf), trump: SUITS.indexOf(trump), leader: seat, trick: [] });
      if (!values) return null;
      out.push(Math.max(...values.map((v) => v.tricks)));
    }
    taken.set(trump, out);
  }
  // the cheapest contract still open that the side makes on most deals: enough to win the
  // auction for now (if someone bids over it, this is asked again, and goes up only as far as it
  // still makes). The solver sees every card, so it's held to making it seven deals in ten.
  const cheapest = open.find(
    (b) => !b.misere && b.suit !== 'NT' && taken.has(b.suit) && taken.get(b.suit)!.filter((t) => t >= b.tricks).length / samples >= 0.7,
  );
  if (cheapest) return { type: 'bid500', amount: ALL_BIDS.indexOf(cheapest) };
  // (no trumps: the quick rules, when they'd bid it and nothing in a suit will do)
  if (quick?.type === 'bid500' && ALL_BIDS[quick.amount!]?.suit === 'NT') return quick;
  return { type: 'decline' };
}
