import { parseCard } from '../../../cards';
import { ALL_SHAPES, type Shape } from './shape';

/**
 * A bridge hand as the bidding bots see it: each suit's ranks (2 … 14 for the ace), highest
 * first, in the order spades, hearts, diamonds, clubs.
 */
export type Hand = number[][];

const SUIT_AT: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };

export function handOf(cards: string[]): Hand {
  const h: Hand = [[], [], [], []];
  for (const c of cards) {
    const p = parseCard(c);
    h[SUIT_AT[p.suit]].push(p.rank);
  }
  for (const x of h) x.sort((a, b) => b - a);
  return h;
}

export const shapeOf = (h: Hand): Shape => h.map((x) => x.length) as Shape;
/** High-card points: ace 4, king 3, queen 2, jack 1. */
export const hcp = (h: Hand) => h.reduce((n, x) => n + x.reduce((m, r) => m + Math.max(0, r - 10), 0), 0);
/** Controls: ace 2, king 1 (twelve in the pack). */
export const controls = (h: Hand) => h.reduce((n, x) => n + x.reduce((m, r) => m + (r === 14 ? 2 : r === 13 ? 1 : 0), 0), 0);
export const suitHcp = (x: number[]) => x.reduce((m, r) => m + Math.max(0, r - 10), 0);

// ---- a small, seedable random source for the bots' own thinking -------------------------

/** Bots may think with any randomness (it never changes the deal); a seed keeps tests repeatable. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- what partner might hold ------------------------------------------------------------

/** What a player's calls have shown, as far as the system goes. */
export interface Picture {
  hcp: [number, number];
  controls: [number, number];
  /** The shapes still possible (null: any within the lengths). */
  shapes: Shape[] | null;
  minLen: number[];
  maxLen: number[];
  /** Anything else the calls said that ranges can't hold ("fewer than 9 points, or fewer than two controls"). */
  test?: (h: Hand) => boolean;
}

export const anyHand = (): Picture => ({ hcp: [0, 37], controls: [0, 12], shapes: null, minLen: [0, 0, 0, 0], maxLen: [13, 13, 13, 13] });

const choose = (n: number, k: number) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/**
 * Hands partner could hold, given what's in `mine` and what partner has shown: a shape drawn in
 * proportion to how many hands have it, then cards at random in each suit, kept when the points
 * and controls fit. If the picture can't be met (a call that stretched the truth), the points
 * are let go before giving up.
 */
export function samplePartner(mine: Hand, pic: Picture, n: number, rand: () => number): Hand[] {
  const free = [0, 1, 2, 3].map((k) => {
    const out: number[] = [];
    for (let r = 14; r >= 2; r--) if (!mine[k].includes(r)) out.push(r);
    return out;
  });
  const shapes = (pic.shapes ?? ALL_SHAPES).filter((x) => x.every((len, k) => len <= free[k].length && len >= pic.minLen[k] && len <= pic.maxLen[k]));
  if (!shapes.length) return samplePartner(mine, anyHand(), n, rand);
  const weights = shapes.map((x) => x.reduce((w, len, k) => w * choose(free[k].length, len), 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Hand[] = [];
  // strict first; if hands that fit are rare, a few good ones beat many that don't fit; only if
  // none turn up are the extra tests, then the points, let go (a call that stretched the truth)
  let stage = 0;
  for (let tries = 0; out.length < n; tries++) {
    if (tries === n * 500) {
      if (out.length >= Math.min(8, n)) break;
      stage = 1;
    }
    if (tries === n * 900) stage = 2;
    if (tries > n * 1200) break;
    let pick = rand() * total;
    let at = 0;
    while (at < shapes.length - 1 && (pick -= weights[at]) > 0) at++;
    const h: Hand = shapes[at].map((len, k) => {
      const pool = [...free[k]];
      for (let i = 0; i < len; i++) {
        const j = i + Math.floor(rand() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, len).sort((a, b) => b - a);
    });
    if (stage < 2) {
      const p = hcp(h);
      const c = controls(h);
      if (p < pic.hcp[0] || p > pic.hcp[1] || c < pic.controls[0] || c > pic.controls[1]) continue;
      if (stage < 1 && pic.test && !pic.test(h)) continue;
    }
    out.push(h);
  }
  return out;
}
