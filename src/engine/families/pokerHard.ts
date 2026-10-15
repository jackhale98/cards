import { parseCard } from '../cards';
import { moreSamples, now, shuffled } from '../bots/search';
import * as bet from '../lib/betting';
import type { HandValue } from '../lib/pokerEval';
import type { Action, GameState } from '../types';
import type { PokerData } from './poker';

/**
 * The Hard poker bots: how a strong player thinks, rather than the Normal bot's longer sums.
 *
 * - Each opponent holds a range, not just "something": every hand they could hold counts for as
 *   much as the betting they've done this hand makes it likely (a raise makes strong hands likely
 *   and keeps a few bluffs; a call, middling ones; a check, rarely the very best). The bot deals
 *   the cards it can't see over and over, weighs each deal by how well it fits everyone's betting,
 *   and so knows how often it wins against what they're likely to hold.
 * - Hold'em before the flop: opening, calling and re-raising ranges by position, as the standard
 *   charts give them (here as shares of a ranking of the 169 starting hands); with fifteen big
 *   blinds or fewer, all in or fold, as the worked-out short-stack charts do.
 * - Betting: value bets sized to the board; bluffs at the rate the bet size calls for, mostly with
 *   hands that can still improve, and fewer against players who call too much; calls when the pot
 *   pays for the chance of winning against the bettor's range.
 * - Each player's habits (how many hands they play, how often they raise) loosen or tighten the
 *   ranges the bot puts them on, so it reads a loose player's raise as weaker than a tight one's.
 */

type S = GameState<PokerData>;

export interface HardGame {
  kind: 'holdem' | 'omaha' | 'stud' | 'draw';
  /** Cards each player is dealt before the first betting (board games' hole cards). */
  holeCards: number;
  /** Board cards dealt by the start of each street (board games). */
  boardAt: number[];
  lastStreet: number;
  /** A player's best hand from their hole cards and the board (board games). */
  evaluate: (hole: string[], board: string[]) => HandValue;
  /** The best five of the cards (stud and draw). */
  best: (cards: string[]) => HandValue;
  deck: () => string[];
  /** Draw poker, before the draw: the cards this seat would throw away. */
  discards: (s: S, seat: number) => string[];
}

/** One move in the betting, as everyone saw it. */
export interface Move {
  seat: number;
  street: number;
  act: 'fold' | 'check' | 'call' | 'raise';
  /** What it cost to call before the move, the bet it faced, the pot before it, and the seat's bet after it. */
  toCall: number;
  bet: number;
  pot: number;
  to: number;
}

/** A player's habits over the hands so far: hands dealt in, hands played before the flop, raises, calls. */
export interface Habit {
  hands: number;
  played: number;
  raises: number;
  calls: number;
}

// ---- Hold'em starting hands -------------------------------------------------------------------

/**
 * The 169 starting hands from best to worst: by their chance against one random hand and against
 * three (so hands that play well in a crowd, suited connectors, rank above weak offsuit aces).
 * Worked out with this game's own hand values, 5,000 deals each.
 */
const ORDER =
  'AA KK QQ JJ TT 99 AKs AJs 88 AQs AKo ATs KQs 77 AQo AJo KJs ATo A9s KQo KTs A8s KJo QJs 66 K9s A7s KTo A6s A9o QTs JTs A5s Q9s A4s QJo A8o A3s K8s 55 A2s A7o K9o J9s K7s QTo T9s JTo K6s J8s A6o A5o Q9o Q8s A4o K5s Q7s K8o T8s K3s A3o K7o K4s 44 A2o Q6s J9o Q8o 98s J7s T7s Q5s K6o T9o 87s K2s J6s Q4s 97s K5o 33 J8o T8o T6s Q3s Q2s J5s Q7o 98o K4o 96s J4s Q6o 22 J3s 76s Q5o T5s 86s J2s J7o T7o T4s 95s K3o 87o 85s T3s K2o J6o Q3o 97o 75s T6o J5o 65s Q4o 96o T2s 93s 94s 54s 86o Q2o 84s 76o 64s 74s T5o 92s J4o 95o J3o T3o 85o 65o 63s T4o J2o 83s 75o 73s 53s 82s 43s 52s T2o 94o 62s 93o 74o 54o 42s 64o 72s 84o 32s 92o 63o 53o 43o 83o 73o 82o 52o 72o 42o 62o 32o'.split(
    ' ',
  );
/** Each starting hand's place as a share of all 1,326 deals: AA 0.005 (the top half a percent) … 32o 1. */
const SHARE = (() => {
  const out = new Map<string, number>();
  let seen = 0;
  for (const h of ORDER) {
    seen += h.length === 2 ? 6 : h[2] === 's' ? 4 : 12;
    out.set(h, seen / 1326);
  }
  return out;
})();
const RANKS = '23456789TJQKA';
/** The share of all starting hands at least as good as these two cards (0: the best). */
export function holdemShare(cards: string[]): number {
  const [a, b] = cards.map(parseCard).sort((x, y) => y.rank - x.rank);
  const name = RANKS[a.rank - 2] + RANKS[b.rank - 2] + (a.rank === b.rank ? '' : a.suit === b.suit ? 's' : 'o');
  return SHARE.get(name) ?? 1;
}

// ---- how strong a hand looks at a moment of the betting ----------------------------------------

const sig = (x: number) => 1 / (1 + Math.exp(-x));

/** Omaha before the flop: big cards, pairs, suits that pair up, and cards close together. */
function omahaStart(cards: string[]): number {
  const cs = cards.map(parseCard);
  const ranks = cs.map((c) => c.rank).sort((a, b) => b - a);
  let v = ranks.reduce((t, r) => t + Math.max(0, r - 9), 0) / 20;
  const pairs = ranks.filter((r, i) => ranks.indexOf(r) !== i);
  if (pairs.length === 1) v += 0.1 + pairs[0] / 70;
  if (pairs.length >= 2 && new Set(pairs).size === 2) v += 0.18;
  if (pairs.length >= 2 && new Set(pairs).size === 1) v -= 0.1; // (three or four of a rank: dead cards)
  const suits = new Map<string, number>();
  for (const c of cs) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
  const two = [...suits.values()].filter((n) => n === 2).length;
  v += two === 2 ? 0.15 : two === 1 ? 0.08 : 0;
  const distinct = [...new Set(ranks)];
  if (distinct.length === 4 && distinct[0] - distinct[3] <= 4) v += 0.12;
  else if (distinct.length >= 3 && distinct[0] - distinct[2] <= 3) v += 0.06;
  return Math.max(0, Math.min(1, v + 0.15));
}

/** A hand of five or more cards (stud, draw), or a stud hand still short of five. */
function cardsStrength(g: HardGame, cards: string[]): number {
  if (cards.length >= 5) {
    const v = g.best(cards);
    if (v.category === 0) return Math.max(...cards.map((c) => parseCard(c).rank)) / 45;
    if (v.category === 1) {
      const ranks = cards.map((c) => parseCard(c).rank);
      const pair = Math.max(...ranks.filter((r, i) => ranks.indexOf(r) !== i));
      return 0.33 + (pair / 14) * 0.2;
    }
    return Math.min(1, 0.6 + v.category * 0.055);
  }
  const ranks = cards.map((c) => parseCard(c).rank);
  const pairs = ranks.filter((r, i) => ranks.indexOf(r) !== i);
  if (pairs.length >= 2) return 0.8;
  if (pairs.length) return 0.5 + pairs[0] / 50;
  const suited = new Set(cards.map((c) => parseCard(c).suit)).size === 1 && cards.length >= 3;
  return Math.max(...ranks) / 30 + (suited ? 0.12 : 0);
}

/** A board game's hand after the flop: what it makes with the board, and what it could still make. */
function boardStrength(g: HardGame, hole: string[], board: string[], river: boolean): number {
  const v = g.evaluate(hole, board);
  const boardRanks = board.map((c) => parseCard(c).rank);
  const top = Math.max(...boardRanks);
  let base: number;
  if (v.category === 0) base = 0.08 + (Math.max(...hole.map((c) => parseCard(c).rank)) / 14) * 0.12;
  else if (v.category === 1) {
    // which pair: over the board, the top card's, or one lower down
    const ranks = [...hole, ...board].map((c) => parseCard(c).rank);
    const counted = new Map<number, number>();
    for (const r of ranks) counted.set(r, (counted.get(r) ?? 0) + 1);
    const holeRanks = hole.map((c) => parseCard(c).rank);
    const pairs = [...counted].filter(([r, n]) => n >= 2 && holeRanks.includes(r)).map(([r]) => r);
    const pair = pairs.length ? Math.max(...pairs) : 0;
    base = !pair ? 0.2 : pair > top ? 0.56 : pair === top ? 0.5 : pair >= boardRanks.sort((a, b) => b - a)[1] ? 0.4 : 0.32;
  } else base = Math.min(0.98, 0.6 + (v.category - 2) * 0.065);
  // made only from the board (a paired board, five on board): no better than anyone's
  if (board.length >= 5 && v.category >= 1 && g.best(board).category >= v.category) base = Math.min(base, 0.25);
  if (river || base >= 0.7) return base;
  // draws: four to a flush, or four in a row
  const all = [...hole, ...board];
  const suits = new Map<string, number>();
  for (const c of all) suits.set(parseCard(c).suit, (suits.get(parseCard(c).suit) ?? 0) + 1);
  const flushDraw = [...suits].some(([x, n]) => n === 4 && hole.some((c) => parseCard(c).suit === x));
  const rs = [...new Set(all.map((c) => parseCard(c).rank))].sort((a, b) => a - b);
  let straightDraw = false;
  for (let i = 0; i + 3 < rs.length; i++) if (rs[i + 3] - rs[i] === 3) straightDraw = true;
  return Math.min(0.69, base + (flushDraw ? 0.18 : 0) + (straightDraw ? 0.1 : 0));
}

// ---- reading the betting -------------------------------------------------------------------------

/** How loose a player is (0 tight … 1 very loose) and how aggressive, from their habits (a few hands' prior). */
function looseness(h: Habit | undefined): { loose: number; aggr: number } {
  const played = ((h?.played ?? 0) + 0.3 * 8) / ((h?.hands ?? 0) + 8);
  const aggr = ((h?.raises ?? 0) + 0.35 * 6) / ((h?.raises ?? 0) + (h?.calls ?? 0) + 6);
  return { loose: played, aggr };
}

/** How likely a player holding a hand of `strength` was to make move `m` (relative: only ratios matter). */
function likelihood(m: Move, strength: number, h: Habit | undefined): number {
  const { loose, aggr } = looseness(h);
  // looser players play weaker hands the same way
  const shift = (loose - 0.3) * 0.5;
  if (m.act === 'check') return 1 - 0.75 * sig((strength - 0.74) / 0.05);
  if (m.act === 'call') {
    const price = m.toCall / Math.max(1, m.pot + m.toCall);
    const t = 0.18 + 0.5 * price - shift;
    // (the very best hands would more often have raised)
    return 0.05 + sig((strength - t) / 0.09) * (1 - 0.45 * sig((strength - 0.9) / 0.04));
  }
  if (m.act === 'raise') {
    const size = (m.to - m.bet) / Math.max(1, m.pot);
    // (players bet draws and middling hands as well as strong ones)
    const t = 0.42 + 0.2 * Math.min(1, Math.max(0, size)) - shift;
    // a few raises are bluffs: more from aggressive players, fewer when the raise is big
    const bluff = 0.12 * Math.min(2, aggr / 0.35) * (size > 1 ? 0.5 : 1);
    return bluff + (1 - bluff) * sig((strength - t) / 0.09);
  }
  return 1;
}

// ---- the chance of winning against everyone's range --------------------------------------------------

interface Equity {
  /** The chance of winning, weighing each deal by how well it fits the betting. */
  eq: number;
  /** The same against everyone's whole range (no reading of the betting), for comparison. */
  raw: number;
}

export function rangeEquity(g: HardGame, s: S, seat: number, budget: { samples: number; ms: number }): Equity {
  const d = s.data;
  const rivals = s.players.map((p) => p.seat).filter((i) => i !== seat && !d.b.folded[i] && !d.b.out[i]);
  if (!rivals.length) return { eq: 1, raw: 1 };
  const history = d.history ?? [];
  const habits = d.habits ?? [];
  const board = g.kind === 'holdem' || g.kind === 'omaha' ? s.zones.board.cards.map((c) => c.id) : [];
  const mineDown = s.zones[`hand:${seat}`].cards.map((c) => c.id);
  const ups = (i: number) => (g.kind === 'stud' ? s.zones[`up:${i}`].cards.map((c) => c.id) : []);
  const mine = [...mineDown, ...ups(seat)];
  const seen = new Set([...mine, ...board, ...rivals.flatMap(ups)]);
  // (stud: folded players' up cards were seen too)
  if (g.kind === 'stud') for (const p of s.players) if (!rivals.includes(p.seat)) for (const c of ups(p.seat)) seen.add(c);
  const unseen = g.deck().filter((c) => !seen.has(c));
  const boardLeft = g.kind === 'holdem' || g.kind === 'omaha' ? g.boardAt[g.lastStreet] - board.length : 0;
  const tossed = g.kind === 'draw' && d.street === 0 && d.drawn?.[seat] == null ? g.discards(s, seat) : [];
  const kept = mine.filter((c) => !tossed.includes(c));
  // each rival's hidden cards now, and (stud) those still to come
  const hidden = rivals.map((i) => s.zones[`hand:${i}`].cards.length);
  const toCome = g.kind === 'stud' ? 7 - mine.length : 0;
  const moves = rivals.map((i) => history.filter((m) => m.seat === i && m.act !== 'fold'));

  const score = (cards: string[], full: string[]) => (g.kind === 'holdem' || g.kind === 'omaha' ? g.evaluate(cards, full).score : g.best(cards).score);
  /** How strong rival j's cards looked at the time of a move (board, or stud cards, as they were then). */
  const strengthAt = (j: number, down: string[], m: Move) => {
    if (g.kind === 'holdem' || g.kind === 'omaha') {
      const b = board.slice(0, g.boardAt[m.street]);
      if (!b.length) return g.kind === 'holdem' ? 1 - holdemShare(down) : omahaStart(down);
      return boardStrength(g, down, b, m.street === g.lastStreet);
    }
    if (g.kind === 'stud') {
      // third street: two down, one up; a card more up each street to sixth; the last down
      const up = ups(rivals[j]).slice(0, Math.min(4, m.street + 1));
      return cardsStrength(g, [...down.slice(0, m.street === 4 ? 3 : 2), ...up]);
    }
    return cardsStrength(g, down);
  };

  const ws: number[] = [];
  const wins: number[] = [];
  const stop = now() + budget.ms;
  let runs = 0;
  while (moreSamples(runs, budget.samples * 8, 20, stop)) {
    const deck = shuffled([...unseen]);
    let k = 0;
    const take = (n: number) => deck.slice(k, (k += n));
    const me = [...kept, ...take(tossed.length)];
    const downs = rivals.map((_, j) => take(hidden[j]));
    const later = rivals.map(() => take(toCome));
    const full = [...board, ...take(boardLeft)];
    let w = 1;
    rivals.forEach((i, j) => {
      for (const m of moves[j]) w *= likelihood(m, strengthAt(j, downs[j], m), habits[i]);
    });
    const v = g.kind === 'stud' ? score([...me, ...take(toCome)], full) : score(me, full);
    const theirs = rivals.map((i, j) => (g.kind === 'stud' ? score([...downs[j], ...ups(i), ...later[j]], full) : score(downs[j], full)));
    const best = Math.max(...theirs);
    const tied = theirs.filter((x) => x === best).length;
    ws.push(w);
    wins.push(v > best ? 1 : v === best ? 1 / (1 + tied) : 0);
    runs++;
  }
  const raw = wins.reduce((a, b) => a + b, 0) / Math.max(1, wins.length);
  // (a few deals carrying all the weight would make a noisy answer: soften the weights until enough count)
  for (const power of [1, 0.5, 0.25]) {
    const p = ws.map((w) => w ** power);
    const sum = p.reduce((a, b) => a + b, 0);
    const ess =
      sum ** 2 /
      Math.max(
        1e-300,
        p.reduce((a, b) => a + b * b, 0),
      );
    if (sum > 0 && ess >= Math.min(25, ws.length / 4)) return { eq: p.reduce((a, x, i) => a + x * wins[i], 0) / sum, raw };
  }
  return { eq: raw, raw };
}

// ---- Hold'em before the flop: the charts ----------------------------------------------------------

/** Push-or-fold with this many big blinds: the share of hands to go all in with, by how many are left to act. */
function pushShare(bbs: number, behind: number): number {
  const at = (five: number, ten: number, fifteen: number) =>
    bbs <= 5 ? five : bbs <= 10 ? five + ((ten - five) * (bbs - 5)) / 5 : ten + ((fifteen - ten) * (bbs - 10)) / 5;
  if (behind <= 1) return at(0.85, 0.58, 0.42);
  if (behind === 2) return at(0.5, 0.3, 0.22);
  if (behind === 3) return at(0.36, 0.21, 0.16);
  return at(0.28, 0.16, 0.12);
}
/** …and to call an all in with, by the all-in player's stack. */
function callShare(bbs: number, behind: number): number {
  const v = bbs <= 5 ? 0.6 : bbs <= 10 ? 0.6 - ((0.6 - 0.37) * (bbs - 5)) / 5 : Math.max(0.15, 0.37 - ((0.37 - 0.25) * (bbs - 10)) / 5);
  // (others still to act behind: tighter)
  return v * (behind > 0 ? 0.7 : 1);
}

function holdemPreflop(s: S, seat: number, o: bet.BetOptions, raise: (to: number) => Action): Action | null {
  const d = s.data;
  const share = holdemShare(s.zones[`hand:${seat}`].cards.map((c) => c.id));
  const r = Math.random();
  // (a little mixing at the edges of each range, as the charts' mixed strategies do)
  const within = (limit: number) => share <= limit * (0.9 + 0.2 * r);
  const moves = (d.history ?? []).filter((m) => m.street === 0);
  const raises = moves.filter((m) => m.act === 'raise');
  const limpers = moves.filter((m) => m.act === 'call').length > 0 && !raises.length;
  const n = s.players.length;
  const order = (x: number) => (x - d.button - 1 + n) % n;
  const live = s.players.filter((p) => !d.b.out[p.seat] && !d.b.folded[p.seat]);
  // players still to act after this one (before the flop the big blind acts last)
  const behind = live.filter(
    (p) => p.seat !== seat && !d.b.allIn[p.seat] && !moves.some((m) => m.seat === p.seat) && preflopOrder(p.seat) > preflopOrder(seat),
  ).length;
  function preflopOrder(x: number) {
    // the seat after the big blind acts first; the big blind last
    const bbSeat = live.length === 2 ? (d.button + 1) % n : (d.button + 2) % n;
    return (x - bbSeat - 1 + 2 * n) % n;
  }
  const bb = d.bb;
  const stack = (i: number) => s.players[i].chips + d.b.bets[i];
  const others = live.filter((p) => p.seat !== seat).map((p) => stack(p.seat));
  const eff = Math.min(stack(seat), Math.max(0, ...others)) / bb;
  const allIn = (): Action => (o.canRaise ? { type: 'allin' } : { type: 'call' });
  const fold = (): Action => (o.canCheck ? { type: 'check' } : { type: 'fold' });
  const habits = d.habits ?? [];

  // short stacked: all in or fold, as the worked-out charts do
  if (eff <= 15 && raises.length <= 1) {
    if (!raises.length)
      return o.canRaise && within(pushShare(eff, behind)) ? allIn() : o.canCheck ? { type: 'check' } : within(pushShare(eff, behind) * 0.5) ? allIn() : fold();
    const raiser = raises[0].seat;
    const theirBbs = Math.min(stack(raiser), stack(seat)) / bb;
    return within(callShare(theirBbs, behind)) ? allIn() : fold();
  }

  if (!raises.length) {
    // first in (or only limpers): open, by position, or fold (the big blind checks)
    let open = live.length === 2 ? 0.75 : behind <= 1 ? 0.45 : behind === 2 ? 0.42 : behind === 3 ? 0.27 : behind === 4 ? 0.2 : 0.15;
    const limps = moves.filter((m) => m.act === 'call').length;
    let size = 2.5 + limps;
    // against players who call too much a raise steals little: open fewer hands, and bigger for value
    const callers = live.filter((p) => p.seat !== seat && preflopOrder(p.seat) > preflopOrder(seat));
    const loose = callers.reduce((t, p) => t + looseness(habits[p.seat]).loose, 0) / Math.max(1, callers.length);
    if (loose > 0.4) {
      open *= Math.max(0.55, 1 - (loose - 0.4) * 1.5);
      size += Math.min(1.5, (loose - 0.4) * 5);
    }
    if (o.canRaise && within(limpers ? open * 0.55 : open)) return raise(Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, Math.round(bb * size))));
    if (o.canCheck) return { type: 'check' };
    // (a limped pot from the small blind, or behind limpers, with a hand that plays well cheaply)
    if (limpers && o.toCall <= bb && within(0.3)) return { type: 'call' };
    return { type: 'fold' };
  }

  const last = raises.at(-1)!;
  const raiser = last.seat;
  const { loose } = looseness(habits[raiser]);
  // a loose raiser's range is wider: defend wider against them
  const wider = Math.max(0.8, Math.min(1.6, 1 + (loose - 0.3) * 1.5));
  const sizeBbs = last.to / bb;
  // a big raise: tighter
  const scale = Math.min(1, 3 / Math.max(1, sizeBbs)) * wider;
  const inPosition = order(seat) > order(raiser);
  const bigBlind = d.b.bets[seat] === bb && moves.every((m) => m.seat !== seat);
  if (raises.length === 1) {
    if (o.canRaise && within(0.04 * wider)) return raise(Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, Math.round(last.to * (inPosition ? 3 : 3.5)))));
    // a few re-raises as bluffs, from just outside the calling range (suited aces and the like)
    if (o.canRaise && share > 0.12 && share < 0.25 && r < 0.12)
      return raise(Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, Math.round(last.to * (inPosition ? 3 : 3.5)))));
    const call = (bigBlind ? 0.32 : inPosition ? 0.16 : 0.1) * scale;
    if (within(call) && o.toCall <= stack(seat) * 0.35) return { type: 'call' };
    return fold();
  }
  // re-raised: only the very best go on
  if (within(0.02 * wider)) return o.canRaise ? { type: 'allin' } : { type: 'call' };
  if (within(0.045 * wider) && o.toCall <= stack(seat) * 0.3) return { type: 'call' };
  return fold();
}

// ---- the bot ------------------------------------------------------------------------------------------

export function hardPokerMove(
  g: HardGame,
  s: S,
  seat: number,
  o: bet.BetOptions,
  raise: (to: number) => Action,
  budget: { samples: number; ms: number },
): Action {
  const d = s.data;
  if (g.kind === 'holdem' && d.street === 0) {
    const a = holdemPreflop(s, seat, o, raise);
    if (a) return a;
  }
  const { eq } = rangeEquity(g, s, seat, budget);
  const rivals = s.players.filter((p) => p.seat !== seat && !d.b.folded[p.seat] && !d.b.out[p.seat]);
  const n = rivals.length;
  const pot = bet.potTotal(d.b);
  const r = Math.random();
  const river = d.street === g.lastStreet;
  const board = g.kind === 'holdem' || g.kind === 'omaha' ? s.zones.board.cards.map((c) => c.id) : [];
  // a board with draws on it (two of a suit, or cards close together): bet bigger, to charge them
  const wet = (() => {
    if (board.length < 3) return false;
    const suits = new Map<string, number>();
    for (const c of board) suits.set(parseCard(c).suit, (suits.get(parseCard(c).suit) ?? 0) + 1);
    const rs = [...new Set(board.map((c) => parseCard(c).rank))].sort((a, b) => a - b);
    return Math.max(...suits.values()) >= 2 || rs.some((x, i) => i >= 2 && x - rs[i - 2] <= 4);
  })();
  const frac = river ? 0.75 : wet ? 0.7 : 0.5;
  const sized = (f: number) => Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, d.b.currentBet + Math.round((pot + o.toCall) * f)));
  // what it takes to be ahead of everyone, and to be well ahead
  const value = n === 1 ? 0.58 : n === 2 ? 0.44 : 0.36;
  const strong = n === 1 ? 0.78 : n === 2 ? 0.62 : 0.52;
  const drawing = !river && eq > 0.28 && eq < value;
  // how often the others call: loose players fold less, so bluff them less
  const looseAvg = rivals.reduce((t, p) => t + looseness(d.habits?.[p.seat]).loose, 0) / Math.max(1, n);
  const folds = Math.max(0.15, Math.min(1.3, 1 - (looseAvg - 0.3) * 2.5));

  if (o.canCheck) {
    if (o.canRaise && eq >= strong) {
      // now and then check a big hand heads-up, to let them bet into it
      if (n === 1 && !river && r < 0.12) return { type: 'check' };
      return raise(sized(frac));
    }
    if (o.canRaise && eq >= value && r < 0.85) return raise(sized(frac));
    if (o.canRaise && n <= 2 && d.street > 0) {
      // bluffs: at the rate the bet size calls for (a bet of f of the pot wants f/(1+f) as many
      // bluffs as value bets), mostly hands with chances to improve
      const rate = (frac / (1 + frac)) * folds;
      if (drawing && r < (0.5 * rate * 2) / n) return raise(sized(frac));
      if (eq < 0.2 && r < (0.45 * rate) / n ** 1.5) return raise(sized(frac));
    }
    return { type: 'check' };
  }
  if (o.canRaise && eq >= strong + 0.05 && r < 0.7) return raise(sized(1));
  // a raise with a draw, heads-up: to win now or improve later
  if (o.canRaise && n === 1 && drawing && eq > 0.33 && r < 0.12 * folds) return raise(sized(1));
  // calling: when the pot pays for the chance (counting a little of what's to come before the river)
  const later = river ? 0 : o.toCall * n * 0.35;
  const price = o.toCall / Math.max(1, pot + o.toCall + later);
  if (eq >= price + 0.01) return { type: 'call' };
  return { type: 'fold' };
}
