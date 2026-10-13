import { parseCard } from '../cards';

export const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'] as const;

export interface HandValue {
  /** Comparable score: higher is better. */
  score: number;
  category: number;
  name: string;
  cards: string[];
}

/** Encode a category plus up to five tiebreak ranks as one comparable number. */
const encode = (cat: number, ranks: number[]) => ranks.slice(0, 5).reduce((acc, r, i) => acc + r * 15 ** (4 - i), cat * 15 ** 5);

/** Evaluate exactly five cards. */
export function eval5(ids: string[]): HandValue {
  const cards = ids.map(parseCard);
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);

  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join() === '14,5,4,3,2') straightHigh = 5; // the wheel
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // groups sorted by size then rank
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  const shape = groups.map((g) => g[1]).join('');

  let cat: number;
  let tiebreak: number[];
  if (straightHigh && flush) [cat, tiebreak] = [8, [straightHigh]];
  else if (shape === '41') [cat, tiebreak] = [7, byGroup];
  else if (shape === '32') [cat, tiebreak] = [6, byGroup];
  else if (flush) [cat, tiebreak] = [5, ranks];
  else if (straightHigh) [cat, tiebreak] = [4, [straightHigh]];
  else if (shape === '311') [cat, tiebreak] = [3, byGroup];
  else if (shape === '221') [cat, tiebreak] = [2, byGroup];
  else if (shape === '2111') [cat, tiebreak] = [1, byGroup];
  else [cat, tiebreak] = [0, ranks];

  return { score: encode(cat, tiebreak), category: cat, name: HAND_NAMES[cat], cards: ids };
}

/** Best five-card hand from 5–7 cards. */
export function bestHand(ids: string[]): HandValue {
  if (ids.length < 5) throw new Error('Need at least 5 cards');
  let best: HandValue | null = null;
  const n = ids.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = eval5([ids[a], ids[b], ids[c], ids[d], ids[e]]);
            if (!best || v.score > best.score) best = v;
          }
  return best!;
}

function combos<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
}

/**
 * Best hand from hole + board cards. `useHole` = 0 means any five cards (hold'em);
 * otherwise exactly that many hole cards must be used (Omaha: 2).
 */
export function bestWithHole(hole: string[], board: string[], useHole = 0): HandValue {
  if (!useHole) return bestHand([...hole, ...board]);
  let best: HandValue | null = null;
  for (const h of combos(hole, useHole))
    for (const b of combos(board, 5 - useHole)) {
      const v = eval5([...h, ...b]);
      if (!best || v.score > best.score) best = v;
    }
  if (!best) throw new Error('Not enough cards');
  return best;
}
