import type { ZoneState } from '../../engine/types';
import { piles } from './piles';
import { spread, type SpreadStyle } from './spread';
import { stack } from './stack';
import { trick } from './trick';
import type { Placed } from './types';

export type { Box, Placed, Spot } from './types';
export { fan, fanHeight, landing } from './fan';
export { dummyCw, FULL_HAND, handWidth } from './spread';
export { seatBacks, seatRow } from './seat';

/** The least of a card that shows when it's one you can pick (px): enough to tap. */
export const TAP = 30;

/** Where a zone is drawn, and what it has to fit in. */
export interface Where {
  /** Card width. */
  cw: number;
  /** Your seat (-1 watching) and how many play: a trick's cards sit toward whoever played them. */
  you: number;
  players: number;
  /** Where on the table (spread.ts): it decides a row's overlap and wrapping. */
  style: Exclude<SpreadStyle, 'dummy'>;
  /** The widest it may be before a row wraps (Infinity: never). */
  maxW: number;
  /** The middle has room for its rows side by side. */
  roomy?: boolean;
  rowGap?: number;
  /** Some of its cards can be picked now: each shows at least this much (px), to tap. */
  tap?: number;
  /** A whole hand face up (`faceUpHand`): its cards' own size, and the width it keeps all hand. */
  dummy?: { cw: number; minW: number };
}

/**
 * A zone laid out, by its `layout`: the room it takes and where each of its cards goes. A new way
 * of laying out cards is a function like these (pure: cards and sizes in, places out), added here.
 */
export function layoutZone(zone: ZoneState, where: Where): Placed {
  switch (zone.layout) {
    case 'trick':
      return trick(zone.cards, where.cw, where.you, where.players);
    case 'stack':
      return stack(zone, where.cw);
    default:
      if (zone.piles) return piles(zone.cards, where.cw, where);
      if (zone.faceUpHand && where.dummy) return spread(zone.cards, where.dummy.cw, { style: 'dummy', maxW: Infinity, minW: where.dummy.minW });
      return spread(zone.cards, where.cw, {
        style: where.style,
        maxW: where.maxW,
        roomy: where.roomy,
        reserve: zone.reserve,
        rowGap: where.rowGap,
        tap: where.tap,
      });
  }
}
