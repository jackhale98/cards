import type { ZoneState } from '../../engine/types';
import { isHidden } from '../../engine/redact';
import { ASPECT, type Placed, spot } from './types';

/** A cascade's bottom card peeks out this far above the top one (in card widths). */
export const CASCADE = 0.42;
/** Each card fanned out under a pile's top (`peek`) shows this much (in card widths). */
const PEEK = 0.3;

/**
 * A pile: its top card, and the edge of the cards under it (one more edge past eight cards). The
 * card under the top shows as itself when it's face up, so it stays in sight while a new card
 * flies in to cover it. Two variants:
 *  - `peek`: the few cards under the top fanned out to its left (Egyptian Rat Screw's slaps).
 *  - `cascade`: the bottom card peeks out above the top one (Kings Corners' foundations), with
 *    room kept for it from the start, so the pile doesn't jump when it comes.
 * Cards nobody can see have no lasting id; the pile names the ones it draws ("top", "under").
 */
export function stack(zone: Pick<ZoneState, 'id' | 'cards' | 'peek' | 'cascade'>, cw: number): Placed {
  const { cards, peek, cascade } = zone;
  const n = cards.length;
  const h = cw * ASPECT;
  const left = peek ? PEEK * cw * (peek - 1) : 0;
  const above = cascade ? CASCADE * cw : 0;
  const placed: Placed = { w: left + cw, h: above + h, spots: [] };
  const x = left + cw / 2;
  const y = above + h / 2;
  const shown = (c: (typeof cards)[number]) => c.up !== false && !isHidden(c.id);
  if (cascade && n > 1) placed.spots.push(spot(cards[0].id, cards[0].id, x, h / 2, cw, 1));
  if (n > 8) placed.spots.push(spot(`${zone.id}#under2`, '?u2', x + 4, y + 4, cw, 2, { down: true }));
  const below = peek ? cards.slice(-peek, -1).filter(shown) : [];
  const under = !peek && !(cascade && n === 2) && n > 1 ? cards[n - 2] : undefined;
  if (n > 1)
    placed.spots.push(
      under && shown(under) ? spot(under.id, under.id, x + 2, y + 2, cw, 3) : spot(`${zone.id}#under`, '?u', x + 2, y + 2, cw, 3, { down: true }),
    );
  below.forEach((c, i) => {
    const k = below.length - i;
    placed.spots.push(spot(c.id, c.id, x - PEEK * cw * k, y, cw, 4 + i, { rot: -4 * k }));
  });
  const top = cards[n - 1];
  if (top) placed.spots.push(spot(top.id, top.id, x, y, cw, 20, { down: top.up === false || isHidden(top.id) }));
  return placed;
}
