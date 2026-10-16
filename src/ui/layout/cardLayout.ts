/**
 * Where every card on the table goes, worked out in one place.
 *
 * The table hands over the areas it has laid out (your hand's strip along the bottom, the trick's
 * box in the middle) and what's in them; this says where each card is drawn: its centre, width,
 * turn and stacking. Nothing here reads the page, so the same table always gives the same
 * places, and a card's move from one place to the next is just the difference between two
 * answers (the card layer eases it).
 */

/** A rectangle on the table, in px from the table's top left. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one card is drawn. `x`, `y` are its centre; `rot` is in degrees. */
export interface Spot {
  id: string;
  x: number;
  y: number;
  /** Card width (its height is 1.4 times this). */
  w: number;
  rot: number;
  z: number;
  /** In your hand: it can be picked, dragged and swiped. */
  inHand: boolean;
  opacity: number;
  /** Wait this long (ms) before moving: a deal comes in a card at a time. */
  delay: number;
}

export interface TableCards {
  /** Your hand, in the order it's shown, along the bottom of `box` (its cards' width `cw`). */
  hand: { ids: string[]; box: Box; cw: number } | null;
  /** The trick, each card with the seat that played it; `box` is three cards wide. */
  trick: { cards: { id: string; by?: number }[]; box: Box } | null;
  /** Your seat (-1 watching) and how many play: a trick card sits toward whoever played it. */
  you: number;
  players: number;
}

export const ASPECT = 1.4;
/** Stacking: the trick over your hand (a card you play rises over its neighbours), and cards on their way out over both. */
const Z_HAND = 100;
const Z_TRICK = 200;
const Z_AWAY = 300;
/** Cards drawn at the edge of the hand area stop this far above its bottom. */
const HAND_FOOT = 6;
/** The fan's cards turn about a point this far down the card (in card heights). */
const PIVOT = 1.2;

/**
 * Your hand as a fan: overlapped as much as the width needs, the outer cards leaning out and
 * dropping a little. (The same fan as the hand drawn on its own: see Hand.svelte.)
 */
export function fan(ids: string[], box: Box, cw: number): Spot[] {
  const n = ids.length;
  if (!n || box.w <= 0) return [];
  const h = cw * ASPECT;
  const mid = (n - 1) / 2;
  const spread = Math.min(3.2, 26 / n);
  // the outer cards' top corners reach past the card's own width as they lean: keep that inside
  const lean = ((spread * mid) / 180) * Math.PI;
  const reach = n > 1 ? Math.max(0, (cw / 2) * (Math.cos(lean) - 1) + PIVOT * h * Math.sin(lean)) : 0;
  const room = box.w - 2 * reach;
  const gap = Math.min(cw * 0.62, n > 1 ? (room - cw - 8) / (n - 1) : 0);
  const left = box.x + (box.w - (cw + gap * (n - 1))) / 2;
  const top = box.y + box.h - HAND_FOOT - h;
  return ids.map((id, i) => {
    const off = i - mid;
    const rot = off * spread;
    const drop = Math.abs(off) ** 2 * Math.min(1.4, 40 / (n * n)) + Math.abs(off) * 0.6;
    // turned about a point below the card: its centre swings out along that circle
    const t = (rot * Math.PI) / 180;
    const px = left + i * gap + cw / 2;
    const py = top + PIVOT * h + drop;
    const arm = (PIVOT - 0.5) * h;
    return { id, x: px + arm * Math.sin(t), y: py - arm * Math.cos(t), w: cw, rot, z: Z_HAND + i, inHand: true, opacity: 1, delay: 0 };
  });
}

/** The trick: each card between the middle and the seat that played it, a little askew. */
export function trick(cards: { id: string; by?: number }[], box: Box, you: number, players: number): Spot[] {
  const cw = box.w / 3;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cards.map((c, i) => {
    const rel = ((c.by ?? 0) - Math.max(0, you) + players) % players;
    const angle = Math.PI / 2 + (rel * 2 * Math.PI) / players;
    return {
      id: c.id,
      x: cx + Math.cos(angle) * cw * 0.9,
      y: cy + Math.sin(angle) * cw * 0.42,
      w: cw,
      rot: (rel % 2 ? 1 : -1) * (3 + rel * 2),
      z: Z_TRICK + i,
      inHand: false,
      opacity: 1,
      delay: 0,
    };
  });
}

/** Every card on the table. */
export function layout(t: TableCards): Spot[] {
  return [...(t.trick ? trick(t.trick.cards, t.trick.box, t.you, t.players) : []), ...(t.hand ? fan(t.hand.ids, t.hand.box, t.hand.cw) : [])];
}

/**
 * Where a card is just before it arrives (`arriving`) or just after it goes, when it wasn't on
 * the table a moment ago or isn't any more: at `from` (a seat, a pile), small and see-through
 * for a seat, card-sized for a pile. With nowhere to come from, it rises into place (or lifts
 * out of it) as it fades.
 */
export function offstage(spot: Spot, from: Box | null, opts: { arriving: boolean; pile?: boolean }): Spot {
  const away = { ...spot, z: opts.arriving ? spot.z : Z_AWAY + spot.z - Z_HAND, delay: 0 };
  if (!from) return { ...away, y: spot.y + (opts.arriving ? 24 : -16), opacity: 0 };
  const x = from.x + from.w / 2;
  const y = from.y + from.h / 2;
  if (opts.pile) return { ...away, x, y, w: from.w || spot.w, rot: 0 };
  return { ...away, x, y, w: spot.w * 0.45, rot: 0, opacity: 0 };
}

/** How long a card takes to get somewhere (ms): longer for further, within reason. */
export function travel(a: Pick<Spot, 'x' | 'y'>, b: Pick<Spot, 'x' | 'y'>): number {
  return Math.round(Math.min(520, 240 + Math.hypot(b.x - a.x, b.y - a.y) * 0.35));
}

/** Which slot of the hand a card dragged sideways to `x` lands in (the nearest). */
export function landing(hand: Spot[], x: number): number {
  let best = 0;
  hand.forEach((p, i) => {
    if (Math.abs(p.x - x) < Math.abs(hand[best].x - x)) best = i;
  });
  return best;
}
