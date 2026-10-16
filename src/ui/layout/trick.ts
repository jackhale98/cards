import type { CardRef } from '../../engine/types';
import { type Placed, spot } from './types';

/**
 * The trick: three cards wide, each card between the middle and the seat that played it, a little
 * askew. A card keeps its place whatever else is played.
 */
export function trick(cards: CardRef[], cw: number, you: number, players: number): Placed {
  const w = cw * 3;
  const h = cw * 2.25;
  return {
    w,
    h,
    spots: cards.map((c, i) => {
      const rel = ((c.by ?? 0) - Math.max(0, you) + players) % players;
      const angle = Math.PI / 2 + (rel * 2 * Math.PI) / players;
      return spot(c.id, c.id, w / 2 + Math.cos(angle) * cw * 0.9, h / 2 + Math.sin(angle) * cw * 0.42, cw, i + 1, {
        rot: (rel % 2 ? 1 : -1) * (3 + rel * 2),
        down: c.up === false,
      });
    }),
  };
}
