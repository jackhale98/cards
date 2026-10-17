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
 *
 * With `played` (a game with a trick: what they've put in it so far, null for nothing yet), the
 * front card is theirs in the trick, face up and readable, or a back until they've played: so
 * who played what can be read off the seats. It's always that size, so the seat doesn't change
 * width as cards are played. (A copy of the card in the trick, named for the seat: `seat:<n>:played`.)
 * The row is at most `room` tall (the seat's own height, its avatar's).
 */
export function seatRow(cards: CardRef[], o: { seat: number; up: number; back: number; crowded: boolean; played?: CardRef | null; room?: number }): Placed {
  const shown = cards.filter((c) => !isHidden(c.id));
  const backs = seatBacks(cards.length - shown.length, o.crowded);
  const front = o.played !== undefined && (backs > 0 || !!o.played);
  const back = (i: number) => ({ key: `seat:${o.seat}:${i}`, id: `?${o.seat}.${i}`, w: o.back, up: false });
  const items = [
    ...shown.map((c) => ({ key: c.id, id: c.id, w: o.up, up: true })),
    ...Array.from({ length: front ? Math.max(0, backs - 1) : backs }, (_, i) => back(i)),
    ...(!front
      ? []
      : o.played
        ? [{ key: `seat:${o.seat}:played`, id: o.played.id, w: o.up, up: true }]
        : [{ key: `seat:${o.seat}:front`, id: `?${o.seat}.front`, w: o.up, up: false }]),
  ];
  // (no taller than `room`, the seat's own height: a taller card overhangs it evenly, into the seat's
  // padding, so a seat is the same height with cards or without and the table doesn't move)
  const h = Math.min(o.room ?? Infinity, Math.max(0, ...items.map((c) => c.w * ASPECT)));
  let x = 0;
  const spots = items.map((c, i) => {
    // (each shows a strip of the one under it: face-up cards more of each, so their corners can be read)
    if (i) x -= (c.up && items[i - 1].up ? 0.55 : 0.7) * Math.min(c.w, items[i - 1].w);
    const at = spot(c.key, c.id, x + c.w / 2, h / 2, c.w, i, { down: !c.up });
    x += c.w;
    return at;
  });
  return { w: x, h, spots };
}
