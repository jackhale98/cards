import type { CardRef } from '../../engine/types';
import { ASPECT, type Placed, spot } from './types';

/**
 * The trick: about three cards wide, each card between the middle and the seat that played it, a
 * little askew. A card keeps its place whatever else is played, and the frame takes in every
 * seat's card whole, turned corners and all (with many players the outer ones lean far enough to
 * reach past three cards by two and a quarter: over the headline, once the cards are big).
 */
export function trick(cards: CardRef[], cw: number, you: number, players: number): Placed {
  const h = cw * ASPECT;
  // each seat's place, about the frame's middle, and how far its card reaches from there
  const place = (rel: number) => {
    const angle = Math.PI / 2 + (rel * 2 * Math.PI) / players;
    const rot = (rel % 2 ? 1 : -1) * (3 + rel * 2);
    const t = (Math.abs(rot) * Math.PI) / 180;
    return {
      x: Math.cos(angle) * cw * 0.9,
      y: Math.sin(angle) * cw * 0.42,
      rot,
      rx: (cw * Math.cos(t) + h * Math.sin(t)) / 2,
      ry: (h * Math.cos(t) + cw * Math.sin(t)) / 2,
    };
  };
  const places = Array.from({ length: Math.max(1, players) }, (_, rel) => place(rel));
  const halfW = Math.max(cw * 1.5, ...places.map((p) => Math.abs(p.x) + p.rx));
  const halfH = Math.max(cw * 1.125, ...places.map((p) => Math.abs(p.y) + p.ry));
  return {
    w: 2 * halfW,
    h: 2 * halfH,
    spots: cards.map((c, i) => {
      const p = places[((((c.by ?? 0) - Math.max(0, you)) % players) + players) % players];
      return spot(c.id, c.id, halfW + p.x, halfH + p.y, cw, i + 1, { rot: p.rot, down: c.up === false });
    }),
  };
}
