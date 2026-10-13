import { parseCard, type Suit } from '../cards';

/** Count value: ace 1, faces 10. */
export const pipValue = (id: string) => Math.min(10, lowRank(id));
const lowRank = (id: string) => {
  const r = parseCard(id).rank;
  return r === 14 ? 1 : r;
};

export interface ShowScore {
  fifteens: number;
  pairs: number;
  runs: number;
  flush: number;
  nobs: number;
  total: number;
}

/** Points for a 4-card hand (or crib) plus the starter, counted the standard way. */
export function scoreHand(hand: string[], starter: string | null, isCrib = false): ShowScore {
  const all = starter ? [...hand, starter] : [...hand];

  // fifteens: every combination of cards summing to 15 scores 2
  let fifteens = 0;
  const vals = all.map(pipValue);
  for (let mask = 1; mask < 1 << all.length; mask++) {
    let sum = 0;
    for (let i = 0; i < all.length; i++) if (mask & (1 << i)) sum += vals[i];
    if (sum === 15) fifteens += 2;
  }

  // pairs: every pair of equal ranks scores 2 (so three of a kind = 6, four = 12)
  let pairs = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (lowRank(all[i]) === lowRank(all[j])) pairs += 2;

  // runs: the longest run of 3+ ranks, multiplied by duplicate ranks within it (double runs…)
  const counts = new Map<number, number>();
  for (const c of all) counts.set(lowRank(c), (counts.get(lowRank(c)) ?? 0) + 1);
  let runs = 0;
  for (let start = 1; start <= 13; start++) {
    if (!counts.has(start) || counts.has(start - 1)) continue;
    let len = 0;
    let mult = 1;
    while (counts.has(start + len)) {
      mult *= counts.get(start + len)!;
      len++;
    }
    if (len >= 3) runs += len * mult;
  }

  // flush: four in the hand (not the crib) scores 4; with the starter too, 5
  let flush = 0;
  const suit = parseCard(hand[0]).suit;
  if (hand.length === 4 && hand.every((c) => parseCard(c).suit === suit)) {
    const withStarter = !!starter && parseCard(starter).suit === suit;
    if (withStarter) flush = 5;
    else if (!isCrib) flush = 4;
  }

  // his nobs: the jack of the starter's suit in hand
  const nobs = starter && hand.some((c) => lowRank(c) === 11 && parseCard(c).suit === (parseCard(starter).suit as Suit)) ? 1 : 0;

  return { fifteens, pairs, runs, flush, nobs, total: fifteens + pairs + runs + flush + nobs };
}

/** "fifteen 4 · pair 2 · run 3 = 9", or the traditional "nineteen" for a zero hand. */
export function describeShow(s: ShowScore): string {
  if (!s.total) return 'nineteen (no points)';
  const parts: string[] = [];
  if (s.fifteens) parts.push(`fifteen ${s.fifteens}`);
  if (s.pairs) parts.push(s.pairs === 2 ? 'pair 2' : s.pairs === 6 ? 'three of a kind 6' : s.pairs === 12 ? 'four of a kind 12' : `pairs ${s.pairs}`);
  if (s.runs) parts.push(`run${s.runs > 5 ? 's' : ''} ${s.runs}`);
  if (s.flush) parts.push(`flush ${s.flush}`);
  if (s.nobs) parts.push('nobs 1');
  return `${parts.join(' · ')} = ${s.total}`;
}

/**
 * Points for the card just played during pegging, given the whole sequence since the count
 * last reset (including that card). 31 here scores 2; "go"/last card is handled by the caller.
 */
export function pegPoints(seq: string[]): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  let points = 0;
  const count = seq.reduce((n, c) => n + pipValue(c), 0);
  if (count === 15) {
    points += 2;
    reasons.push('fifteen for 2');
  }
  if (count === 31) {
    points += 2;
    reasons.push('thirty-one for 2');
  }
  // pairs: how many of the most recent cards share the last card's rank
  const last = lowRank(seq[seq.length - 1]);
  let same = 1;
  for (let i = seq.length - 2; i >= 0 && lowRank(seq[i]) === last; i--) same++;
  const pairPts = [0, 0, 2, 6, 12][same];
  if (pairPts) {
    points += pairPts;
    reasons.push(`${['', '', 'pair', 'three of a kind', 'four of a kind'][same]} for ${pairPts}`);
  }
  // runs: the longest tail (3+ cards) whose ranks are consecutive in any order
  for (let len = seq.length; len >= 3; len--) {
    const ranks = seq
      .slice(-len)
      .map(lowRank)
      .sort((a, b) => a - b);
    if (ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) {
      points += len;
      reasons.push(`run of ${len} for ${len}`);
      break;
    }
  }
  return { points, reasons };
}
