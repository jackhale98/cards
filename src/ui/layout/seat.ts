import type { CardRef } from '../../engine/types';
import { isHidden } from '../../engine/redact';
import { ASPECT, type Placed, spot } from './types';

/** How many backs stand for the cards a seat holds that you can't see (one in a crowded row, leaving room for names). */
export const seatBacks = (hidden: number, crowded: boolean) => Math.min(hidden, crowded ? 1 : 4);

/**
 * A player's cards beside their name: the ones everyone can see face up (big enough that each
 * corner's rank and suit can be read), then a few backs standing for the rest, overlapped like a
 * hand held closed. The backs have no lasting ids: the seat names them (`seat:<n>:<i>`), and they
 * only show how many there are (the seat's frame is a `tally`).
 */
export function seatRow(cards: CardRef[], o: { seat: number; up: number; back: number; crowded: boolean }): Placed {
  const shown = cards.filter((c) => !isHidden(c.id));
  const items = [
    ...shown.map((c) => ({ key: c.id, id: c.id, w: o.up, up: true })),
    ...Array.from({ length: seatBacks(cards.length - shown.length, o.crowded) }, (_, i) => ({
      key: `seat:${o.seat}:${i}`,
      id: `?${o.seat}.${i}`,
      w: o.back,
      up: false,
    })),
  ];
  const h = Math.max(0, ...items.map((c) => c.w * ASPECT));
  let x = 0;
  const spots = items.map((c, i) => {
    // (face-up cards show a little more of each, so their corners can be read)
    if (i) x -= (c.up && items[i - 1].up ? 0.55 : 0.7) * c.w;
    const at = spot(c.key, c.id, x + c.w / 2, h / 2, c.w, i, { down: !c.up });
    x += c.w;
    return at;
  });
  return { w: x, h, spots };
}
