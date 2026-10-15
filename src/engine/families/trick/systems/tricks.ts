import { controls, hcp, suitHcp, type Hand } from './hands';

/**
 * How many tricks two hands should take together, declaring in each strain: a quick estimate,
 * not a search. It reads the things bridge players count (points, controls, the trump fit,
 * losers, short suits to ruff in, stoppers) and weighs them with numbers fitted to double-dummy
 * results on thousands of deals (the solver gives the best either hand could do as declarer).
 * Strains go spades, hearts, diamonds, clubs, then no trumps (index 4).
 */

/** Losing tricks in a suit (the losing-trick count: the top three cards, less the ace, king and queen among them). */
function losers(x: number[]): number {
  const top = x.slice(0, 3);
  let n = top.length;
  for (const r of top) if (r >= 12 && (r !== 12 || x.length >= 3)) n--;
  // Qx counts the queen only half; a singleton king is still a loser
  if (x.length === 2 && x[0] === 12) n -= 0.5;
  if (x.length === 1 && x[0] === 13) n += 0;
  return Math.max(0, n);
}

/** A suit the side has stopped for no trumps (one hand holding A, Kx, Qxx or Jxxx). */
const stopped = (a: number[], b: number[]) =>
  [a, b].some((x) => x[0] === 14 || (x.includes(13) && x.length >= 2) || (x.includes(12) && x.length >= 3) || (x.includes(11) && x.length >= 4));

/** Tricks a long suit can bring in without the top cards: its length past what the others hold. */
function lengthTricks(a: number[], b: number[]) {
  const n = a.length + b.length;
  const most = Math.max(a.length, b.length);
  return Math.max(0, most - Math.max(13 - n - (13 - n) / 2, 3)) * (n >= 7 ? 1 : 0.5);
}

/** Sure tricks in a suit: the unbroken run of top cards the side holds, no more than the longer hand has cards. */
function topTricks(a: number[], b: number[]) {
  const all = new Set([...a, ...b]);
  let run = 0;
  while (all.has(14 - run)) run++;
  return Math.min(run, Math.max(a.length, b.length));
}

export function suitFeatures(a: Hand, b: Hand, t: number): number[] {
  const [long, short] = a[t].length >= b[t].length ? [a, b] : [b, a];
  const fit = a[t].length + b[t].length;
  const trumps = [...a[t], ...b[t]];
  let ruffs = 0;
  for (let k = 0; k < 4; k++) if (k !== t) ruffs += Math.max(0, 3 - short[k].length);
  ruffs = Math.min(ruffs, short[t].length);
  let longRuffs = 0;
  for (let k = 0; k < 4; k++) if (k !== t) longRuffs += Math.max(0, 2 - long[k].length);
  let sideLength = 0;
  for (let k = 0; k < 4; k++) if (k !== t) sideLength = Math.max(sideLength, a[k].length + b[k].length - 7);
  let ltc = 0;
  for (let k = 0; k < 4; k++) ltc += losers(a[k]) + losers(b[k]);
  const p = hcp(a) + hcp(b);
  return [
    1,
    p,
    controls(a) + controls(b),
    fit,
    Math.max(0, fit - 7),
    Math.max(0, 7 - fit),
    ruffs,
    Math.min(longRuffs, long[t].length - short[t].length),
    sideLength,
    Math.min(ltc, 16),
    [14, 13, 12].filter((r) => trumps.includes(r)).length,
    suitHcp(a[t]) + suitHcp(b[t]),
    [0, 1, 2, 3].reduce((n, k) => n + (k === t ? 0 : topTricks(a[k], b[k])), 0),
  ];
}

export function ntFeatures(a: Hand, b: Hand): number[] {
  let stops = 0;
  let longest = 0;
  let length = 0;
  let top = 0;
  for (let k = 0; k < 4; k++) {
    top += topTricks(a[k], b[k]);
    if (stopped(a[k], b[k])) stops++;
    longest = Math.max(longest, a[k].length + b[k].length);
    length += lengthTricks(a[k], b[k]);
  }
  const p = hcp(a) + hcp(b);
  return [1, p, controls(a) + controls(b), stops, 4 - stops === 1 ? 1 : 0, Math.max(0, longest - 7), length, Math.max(0, p - 25), top];
}

/** Fitted by tests/tricks.bench.test.ts to 12,000 deals (tools/dd_deals.py); one row for the suits, one for no trumps. */
export const SUIT_WEIGHTS = [-0.1027, 0.2267, 0.3419, 0.3906, 0.4645, -0.6448, -0.0083, 0.2844, -0.1093, -0.1632, 0.1043, 0.0283, -0.07];
export const NT_WEIGHTS = [-4.2598, 0.3286, 0.3791, 0.5443, -0.1096, -0.0844, -0.0536, 0.0493, -0.0241];
/** How far a real double-dummy result typically lands from the estimate (in tricks): suits, no trumps. */
export const SPREAD = [1.07, 1.23];

const dot = (w: number[], f: number[]) => f.reduce((n, x, i) => n + x * (w[i] ?? 0), 0);

/** The estimated tricks in each strain (spades, hearts, diamonds, clubs, no trumps). */
export function estimate(a: Hand, b: Hand): number[] {
  // (a straight line runs ahead of the solver at the top: where it says twelve, the solver averages
  // about eleven and a half, and thirteen about twelve; no trumps keeps to the line)
  const out = [0, 1, 2, 3].map((t) => {
    const e = dot(SUIT_WEIGHTS, suitFeatures(a, b, t));
    return e > 10 ? 10 + (e - 10) * 0.72 : e;
  });
  out.push(dot(NT_WEIGHTS, ntFeatures(a, b)));
  return out.map((x) => Math.max(0, Math.min(13, x)));
}
