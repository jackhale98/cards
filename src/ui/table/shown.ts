import type { GameStatus, ZoneState } from '../../engine/types';

/**
 * Which zones show where on the table: the middle (with the hands turned over at a showdown), the
 * strip of everyone's melds, the seats. Pure: the game's zones and what you can do in, lists out.
 */

/**
 * Hands turned over at a showdown (poker), laid out in the middle beside the board, labelled with
 * who and what they hold: the cards move there from the seat (which shows none meanwhile).
 */
export function showdownZones(showdown: GameStatus['showdown'], zones: Record<string, ZoneState>): ZoneState[] {
  return (showdown ?? [])
    .map(({ seat, label, zones: ids }): ZoneState => ({
      id: `showdown:${seat}`,
      base: 'showdown',
      owner: seat,
      label,
      visibility: 'all',
      layout: 'spread',
      area: 'center',
      cards: ids.flatMap((id) => zones[id]?.cards ?? []),
    }))
    .filter((z) => z.cards.length);
}

/**
 * A hand laid face up on the table (bridge's dummy) that has emptied keeps its room until the
 * middle is clear: its last card goes to the last trick, which would otherwise jump up into its
 * place and grow, for that one trick. The zones keeping their room, after an update.
 */
export function keptRoomAfter(kept: string[], zones: Record<string, ZoneState>): string[] {
  const centre = Object.values(zones).filter((z) => z.area === 'center');
  const down = centre.filter((z) => z.faceUpHand && z.cards.length && !kept.includes(z.id)).map((z) => z.id);
  if (down.length) return [...kept, ...down];
  if (kept.length && centre.every((z) => !z.cards.length)) return [];
  return kept;
}

/** The middle's zones: those in the centre (an empty one left out if it hides when empty, unless it keeps its room), then any showdown. */
export function middleZones(zones: Record<string, ZoneState>, kept: string[], showdown: ZoneState[]): ZoneState[] {
  return [...Object.values(zones).filter((z) => z.area === 'center' && !(z.hideEmpty && !z.cards.length && !kept.includes(z.id))), ...showdown];
}

/** The strip's zones (everyone's melds), leaving out any on show in the middle at a showdown. */
export function stripZonesOf(zones: Record<string, ZoneState>, shownDown: Set<string>): ZoneState[] {
  return Object.values(zones).filter((z) => z.area === 'strip' && !(z.hideEmpty && !z.cards.length) && !shownDown.has(z.id));
}

/**
 * The strip scrolls sideways, so what's yours to play from comes first, then your own, then
 * everyone else's around from your left: in Palace your face-up and face-down cards (all you have
 * left to play) never sit past the edge.
 */
export function stripOrder(list: ZoneState[], usable: (z: ZoneState) => boolean, you: number, players: number): ZoneState[] {
  const rank = (z: ZoneState) =>
    usable(z) ? -2 : z.owner === you && you >= 0 ? -1 : z.owner == null ? players : (z.owner - Math.max(0, you) + players) % players;
  return list
    .map((z, i) => ({ z, i, r: rank(z) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.z);
}

/** Piles with places on the table (Kings Corners' cross) in reading order: row by row. */
export function gridOrder(zones: ZoneState[]): ZoneState[] {
  return [...zones].sort((a, b) => a.grid![0] - b.grid![0] || a.grid![1] - b.grid![1]);
}

/**
 * A whole hand face up on the table that you're playing from now (bridge's dummy, for its
 * declarer): it takes your hand's place at the bottom, full size, and your own hand sits small in
 * its place in the middle until it's your own turn again.
 */
export function playFromOf(middle: ZoneState[], selectable: Set<string> | null): ZoneState | null {
  return middle.find((z) => z.faceUpHand && z.cards.some((c) => selectable?.has(c.id))) ?? null;
}

/**
 * A face-up hand you've played from while your own hand is empty (500's open misère: your own hand,
 * laid down) stays in your hand's place between your turns, rather than going back to the middle
 * each time it's someone else's turn. The zone that stays, after an update (null: none).
 */
export function keptPlayFrom(kept: string | null, middle: ZoneState[], selectable: Set<string> | null, own: number): string | null {
  if (own) return null;
  const up = middle.filter((z) => z.faceUpHand && z.cards.length);
  if (kept && up.some((z) => z.id === kept)) return kept;
  return up.find((z) => z.cards.some((c) => selectable?.has(c.id)))?.id ?? null;
}
