import type { Box, Spot } from './types';

/** A card on screen: where it is drawn (in the card layer's px) and how it looks there. */
export interface Placement extends Spot {
  opacity: number;
  /** Wait this long (ms) before moving: a deal comes in a card at a time. */
  delay: number;
}

export const placement = (s: Spot): Placement => ({ ...s, opacity: 1, delay: 0 });

/** How long a card takes to get somewhere (ms): longer for further, within reason. */
export function travel(a: Pick<Spot, 'x' | 'y'>, b: Pick<Spot, 'x' | 'y'>): number {
  return Math.round(Math.min(520, 240 + Math.hypot(b.x - a.x, b.y - a.y) * 0.35));
}

/**
 * Where a card is just before it arrives (`arriving`) or just after it goes, when it wasn't on
 * the table a moment ago or isn't any more: at `from` (a seat, a pile), small and see-through for
 * a seat, card-sized (`w`) for a pile. With nowhere to come from, it rises into place (or lifts
 * out of it) as it fades.
 */
export function offstage(p: Placement, from: Box | null, o: { arriving: boolean; pile?: { w: number } }): Placement {
  const away = { ...p, delay: 0 };
  if (!from) return { ...away, y: p.y + (o.arriving ? 24 : -16), opacity: 0 };
  const x = from.x + from.w / 2;
  const y = from.y + from.h / 2;
  if (o.pile) return { ...away, x, y, w: o.pile.w, rot: 0 };
  return { ...away, x, y, w: p.w * 0.45, rot: 0, opacity: 0 };
}
