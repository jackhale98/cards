import { bidOf, bridgeScore, type BridgeContract } from '../contracts';
import type { Hand } from './hands';
import { estimate, SPREAD } from './tricks';

/**
 * Choosing a contract: for each hand partner might hold, the estimated tricks in each strain,
 * spread a little either way (an estimate is only an estimate); each contract's expected score is
 * the average over those hands. The bot bids whichever is best.
 */

/** Estimate order (spades, hearts, diamonds, clubs, no trumps) for each bid strain (clubs first). */
const AT: Record<string, number> = { C: 3, D: 2, H: 1, S: 0, NT: 4 };

const erf = (x: number) => {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const cdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

/** The chance of taking each number of tricks (0 … 13), around an estimate. */
export function trickOdds(est: number, spread: number): number[] {
  const out: number[] = [];
  for (let t = 0; t <= 13; t++) {
    const lo = t === 0 ? 0 : cdf((t - 0.5 - est) / spread);
    const hi = t === 13 ? 1 : cdf((t + 0.5 - est) / spread);
    out.push(hi - lo);
  }
  return out;
}

/** For each sampled partner hand, the odds of each number of tricks in each strain (estimate order). */
export const oddsFor = (mine: Hand, partners: Hand[]) => partners.map((p) => estimate(mine, p).map((e, k) => trickOdds(e, SPREAD[k === 4 ? 1 : 0])));

export type Odds = number[][][];

/**
 * Our expected score declaring `bid` in a contested auction: the other side doubles whenever it
 * pays them (when we go down), so running from one contract to another is never free.
 */
export function evContested(odds: Odds, bid: number, vul: boolean): number {
  const { level, strain } = bidOf(bid);
  const made = Array.from({ length: 14 }, (_, t) => bridgeScore({ level, strain, dbl: 0 }, vul, t));
  const doubled = Array.from({ length: 14 }, (_, t) => bridgeScore({ level, strain, dbl: 1 }, vul, t));
  let sum = 0;
  for (const o of odds) {
    const p = o[AT[strain]];
    for (let t = 0; t <= 13; t++) sum += p[t] * (t >= level + 6 ? made[t] : doubled[t]);
  }
  return sum / Math.max(1, odds.length);
}

/** Our expected score declaring `bid` (doubled or not). */
export function evDeclare(odds: Odds, bid: number, vul: boolean, dbl: 0 | 1 | 2 = 0): number {
  const { level, strain } = bidOf(bid);
  const c: BridgeContract = { level, strain, dbl };
  const scores = Array.from({ length: 14 }, (_, t) => bridgeScore(c, vul, t));
  let sum = 0;
  for (const o of odds) {
    const p = o[AT[strain]];
    for (let t = 0; t <= 13; t++) sum += p[t] * scores[t];
  }
  return sum / Math.max(1, odds.length);
}

/**
 * Our expected score defending the other side's `bid`: they take roughly what we'd leave them
 * declaring the same strain ourselves (13 less our tricks).
 */
export function evDefend(odds: Odds, bid: number, theirVul: boolean, dbl: 0 | 1 | 2 = 0): number {
  const { level, strain } = bidOf(bid);
  const c: BridgeContract = { level, strain, dbl };
  const scores = Array.from({ length: 14 }, (_, t) => bridgeScore(c, theirVul, t));
  let sum = 0;
  for (const o of odds) {
    const p = o[AT[strain]];
    for (let t = 0; t <= 13; t++) sum -= p[t] * scores[13 - t];
  }
  return sum / Math.max(1, odds.length);
}

export interface Choice {
  /** A bid, or 'P' to leave the contract where it is. */
  call: number | 'P';
  ev: number;
}

/** International Match Points for a difference in score (the WBF scale). */
const IMP_STEPS = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000];
export function imps(diff: number): number {
  const a = Math.abs(diff);
  let n = 0;
  while (n < IMP_STEPS.length && a >= IMP_STEPS[n]) n++;
  return diff < 0 ? -n : n;
}

/** Each contract's score for every number of tricks, by its strain's place in the estimates. */
function scoresOf(bid: number, vul: boolean) {
  const { level, strain } = bidOf(bid);
  const c: BridgeContract = { level, strain, dbl: 0 };
  return { at: AT[strain], scores: Array.from({ length: 14 }, (_, t) => bridgeScore(c, vul, t)) };
}

/** Expected IMPs for playing `bid` rather than `field`, hand by hand over the sampled partners. */
export function impsAgainst(odds: Odds, bid: number, field: number, vul: boolean): number {
  if (bid === field) return 0;
  const a = scoresOf(bid, vul);
  const b = scoresOf(field, vul);
  let sum = 0;
  for (const o of odds) {
    const pa = o[a.at];
    const pb = o[b.at];
    for (let t = 0; t <= 13; t++) {
      if (pa[t] < 1e-4) continue;
      // (the same strain: the same tricks at both tables; another strain, its own tricks)
      if (a.at === b.at) sum += pa[t] * imps(a.scores[t] - b.scores[t]);
      else for (let u = 0; u <= 13; u++) if (pb[u] >= 1e-4) sum += pa[t] * pb[u] * imps(a.scores[t] - b.scores[u]);
    }
  }
  return sum / Math.max(1, odds.length);
}

/**
 * The best contract above `above` (bids `skip` rules out are conventional at this point), or
 * passing to stay in `keep` (our side's contract now, if there is one). Judged as at a teams
 * match: in IMPs against the contract with the best expected score short of slam (what most
 * tables would reach), so a slam has to be better than an even chance, not merely worth more on
 * average.
 */
export function bestContract(odds: Odds, vul: boolean, o: { above: number; keep?: number | null; skip?: (bid: number) => boolean; top?: number }): Choice {
  const options: number[] = [];
  if (o.keep != null) options.push(o.keep);
  for (let b = o.above + 1; b <= (o.top ?? 34); b++) if (!o.skip?.(b) && b !== o.keep) options.push(b);
  if (!options.length) return { call: 'P', ev: -Infinity };
  const raw = new Map(options.map((b) => [b, evDeclare(odds, b, vul)]));
  const short = options.filter((b) => bidOf(b).level < 6);
  // (with only slams on offer, a grand is weighed against staying in the small slam)
  const field = short.length ? short.reduce((x, y) => (raw.get(y)! > raw.get(x)! ? y : x)) : (o.keep ?? options[0]);
  // (only contracts within reach of the best are worth the closer look)
  const top = Math.max(...raw.values());
  let best = field;
  let bestImps = 0;
  for (const b of options) {
    if (b === field || raw.get(b)! < top - 400) continue;
    const v = impsAgainst(odds, b, field, vul);
    if (v > bestImps + 0.05) {
      best = b;
      bestImps = v;
    }
  }
  return { call: best === o.keep ? 'P' : best, ev: raw.get(best)! };
}

/** Game (or more) in this bid's strain. */
export const isGame = (bid: number) => {
  const { level, strain } = bidOf(bid);
  return level >= 5 || (level >= 4 && (strain === 'H' || strain === 'S')) || (level >= 3 && strain === 'NT');
};
