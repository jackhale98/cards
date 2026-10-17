import type { CardRef } from '../../engine/types';
import { ASPECT, type Placed, spot } from './types';

/**
 * Where a row of cards is, which decides how much its cards overlap and whether it wraps:
 *  - `middle`: a pile in the middle of the table. Up to four side by side; from five, overlapped;
 *    from twelve (a whole hand), overlapped down to the corner indices.
 *  - `strip`: everyone's melds along the bottom of the middle: always overlapped, one row (it
 *    scrolls) unless given a width to wrap in (a table screen's strip).
 *  - `sheet`: the full-screen melds: overlapped, a gap before each meld, wrapping.
 *  - `dummy`: a whole hand face up (bridge's dummy): the same overlap from thirteen cards down to
 *    one, a little room between suits, one row.
 */
export type SpreadStyle = 'middle' | 'strip' | 'sheet' | 'dummy';

export interface SpreadOptions {
  style: SpreadStyle;
  /** Wrap onto more rows within this width (Infinity: one row). */
  maxW: number;
  /** The middle has room: side by side, no overlap. */
  roomy?: boolean;
  /**
   * Room kept for this many cards, filled from the left (a pile that grows card by card, rummy
   * 500's discards or cribbage's count): it changes without the piles beside it sliding about.
   */
  reserve?: number;
  /** At least this wide (a dummy keeps its thirteen cards' width all hand). */
  minW?: number;
  /** Between rows (default: the gap between cards, a tenth of a card). */
  rowGap?: number;
  /** Cards here can be picked now: each shows at least this much (px), to tap. */
  tap?: number;
}

/** Between two cards side by side (in card widths). */
const GAP = 0.1;
/** A face-up hand's overlap: each card shows this much of the one under it… */
const STEP = 0.38;
/** …and a new suit this much more (in card widths). */
const SUIT_GAP = 0.32;
/** A whole face-up hand of thirteen, four suits, in card widths (the middle must have this room for one). */
export const FULL_HAND = 1 + 12 * (STEP + GAP) + 3 * SUIT_GAP;
/** A face-up hand of `n` cards in `groups + 1` suits, in card widths. */
export const handWidth = (n: number, groups: number) => 1 + (Math.max(1, n) - 1) * (STEP + GAP) + groups * SUIT_GAP;

/**
 * A whole hand face up (bridge's dummy) as it empties: its cards grow into the width its thirteen
 * took (`cw` is a thirteen-card dummy's card), up to half as big again, and no taller than the
 * middle has height for (`growTo`).
 */
export function dummyCw(cw: number, growTo: number, cards: { group?: number }[]): number {
  const groups = cards.filter((c, i) => i > 0 && c.group != null && c.group !== cards[i - 1].group).length;
  return Math.round(Math.min(cw * 1.45, Math.max(cw, growTo), (cw * FULL_HAND) / handWidth(cards.length, groups)));
}
/** Room kept per card after the first, for a pile with a `reserve` (in card widths). */
const RESERVE_STEP = 0.65;

/** How far a card sits from the one before it, past touching (in card widths: negative overlaps). */
export function overlap(o: Pick<SpreadOptions, 'style' | 'roomy' | 'reserve'>, n: number, newGroup: boolean): number {
  if (o.style === 'dummy') return newGroup ? STEP + SUIT_GAP - 1 : STEP - 1;
  if (o.style === 'sheet') return newGroup ? 0.22 : -0.45;
  if (newGroup) return n >= 12 ? -0.5 : 0.22;
  if (o.reserve) return n >= 17 ? -0.85 : n >= 12 ? -0.8 : n >= 9 ? -0.65 : -0.45;
  if (o.style === 'strip') return -0.45;
  if (o.roomy) return 0;
  return n >= 12 ? -0.66 : n >= 5 ? -0.45 : 0;
}

/** A row of cards, wrapping onto more rows if it must; each new group (a meld, a suit) set apart. */
export function spread(cards: CardRef[], cw: number, o: SpreadOptions): Placed {
  const n = cards.length;
  const h = cw * ASPECT;
  const gap = GAP * cw;
  const rowGap = o.rowGap ?? gap;
  const minW = Math.max(o.minW ?? 0, o.reserve ? cw * (1 + (o.reserve - 1) * RESERVE_STEP) : 0);
  if (!n) return { w: Math.max(minW, 2 * cw), h, spots: [] };
  // each card's left edge along its row, and the rows
  const rows: { lefts: number[]; from: number; width: number }[] = [];
  let row = { lefts: [0], from: 0, width: cw };
  for (let i = 1; i < n; i++) {
    const step = Math.max(o.tap ?? 0, cw + gap + overlap(o, n, cards[i].group != null && cards[i].group !== cards[i - 1].group) * cw);
    if (row.width + step > o.maxW) {
      rows.push(row);
      row = { lefts: [0], from: i, width: cw };
    } else {
      row.lefts.push(row.width - cw + step);
      row.width += step;
    }
  }
  rows.push(row);
  const w = Math.max(minW, ...rows.map((r) => r.width));
  const spots = rows.flatMap((r, k) => {
    // (centred, except a pile kept room for, which fills from the left)
    const start = o.reserve ? 0 : (w - r.width) / 2;
    const y = k * (h + rowGap) + h / 2;
    return r.lefts.map((left, j) => {
      const c = cards[r.from + j];
      return spot(c.id, c.id, start + left + cw / 2, y, cw, r.from + j + 1, { down: c.up === false, dim: c.dim });
    });
  });
  return { w, h: rows.length * h + (rows.length - 1) * rowGap, spots };
}
