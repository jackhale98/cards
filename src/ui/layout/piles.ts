import type { CardRef } from '../../engine/types';
import { parseCard } from '../../engine/cards';
import { ASPECT, type Placed, type Spot, spot } from './types';

/** Each card squared on a pile sits this far up and along from the one under it (px), up to six. */
const SQUARE = 2;
const SQUARED = 6;
/** Piles stand this far apart (in card widths). */
const PILE_GAP = 0.22;

export interface Pile {
  /** What the card layer knows the pile by: its meld. */
  key: string;
  /** Its cards of the first card's rank, squared up (a finished meld: all of them). */
  same: CardRef[];
  /** The others (wild cards), fanned beside it. */
  odd: CardRef[];
}

/** A zone's cards as piles: a new one at each new group (meld). */
export function pilesOf(cards: CardRef[]): Pile[] {
  const out: Pile[] = [];
  for (const c of cards) {
    const last = out.at(-1);
    if (last && c.group === last.same[0].group) {
      (c.square || parseCard(c.id).rank === parseCard(last.same[0].id).rank ? last.same : last.odd).push(c);
      // (known by its meld, not its first card: a card sorted in at the front mustn't make it a new pile)
    } else out.push({ key: c.group != null && !out.some((p) => p.key === `g${c.group}`) ? `g${c.group}` : c.id, same: [c], odd: [] });
  }
  return out;
}

/**
 * Melds drawn as piles (`zone.piles`, canasta's): each meld's cards of its first card's rank
 * squared into one pile with its count on it, and any others (wild cards) fanned beside it; the
 * piles in rows, wrapping within `maxW`, standing on a common line.
 */
export function piles(cards: CardRef[], cw: number, o: { maxW: number; rowGap?: number }): Placed {
  const h = cw * ASPECT;
  const gap = PILE_GAP * cw;
  const rowGap = o.rowGap ?? gap;
  // each pile on its own: its size and its cards, from its top left
  const each = pilesOf(cards).map((p) => {
    const lift = Math.min(p.same.length - 1, SQUARED) * SQUARE;
    const spots: Spot[] = p.same.map((c, k) => {
      const q = Math.min(k, SQUARED) * SQUARE;
      return spot(c.id, c.id, cw / 2 + q, lift + h / 2 - q, cw, k + 1, {
        dim: c.dim,
        count: k === p.same.length - 1 && p.same.length > 1 ? p.same.length : undefined,
      });
    });
    let right = cw;
    p.odd.forEach((c, j) => {
      const left = right - (j ? 0.6 : 0.5) * cw;
      spots.push(spot(c.id, c.id, left + cw / 2, lift + h / 2, cw, SQUARED + 2 + j, { dim: c.dim }));
      right = left + cw;
    });
    // (the squared cards reach a little right of the pile, as far as they rise)
    return { w: Math.max(right, cw + lift), h: lift + h, spots };
  });
  if (!each.length) return { w: 2 * cw, h, spots: [] };
  // into rows
  const rows: { piles: typeof each; width: number; height: number }[] = [];
  for (const p of each) {
    const row = rows.at(-1);
    if (row && row.width + gap + p.w <= o.maxW) {
      row.piles.push(p);
      row.width += gap + p.w;
      row.height = Math.max(row.height, p.h);
    } else rows.push({ piles: [p], width: p.w, height: p.h });
  }
  const w = Math.max(...rows.map((r) => r.width));
  const spots: Spot[] = [];
  let y = 0;
  let z = 0;
  for (const r of rows) {
    let x = (w - r.width) / 2;
    for (const p of r.piles) {
      // (each pile stands on the row's foot)
      const dy = y + r.height - p.h;
      for (const s of p.spots) spots.push({ ...s, x: s.x + x, y: s.y + dy, z: z + s.z });
      z += 20;
      x += p.w + gap;
    }
    y += r.height + rowGap;
  }
  return { w, h: y - rowGap, spots };
}
