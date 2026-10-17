import { ASPECT, type Placed, spot } from './types';

/** The fan's cards turn about a point this far down the card (in card heights)… */
const PIVOT = 1.2;
/** …stop this far above the bottom of its room… */
const FOOT = 6;
/** …which is a card tall and this much more (for the arc and a selected card's rise). */
const EXTRA = 26;

/** The height a fan of `cw`-wide cards takes. */
export const fanHeight = (cw: number) => cw * ASPECT + EXTRA;

/** How far apart a fan's cards are (what shows of each, to tap), and how far its outer cards lean past their own width. */
function spacing(n: number, width: number, cw: number) {
  const h = cw * ASPECT;
  const mid = (n - 1) / 2;
  const spread = Math.min(3.2, 26 / n);
  // the outer cards' top corners reach past the card's own width as they lean: keep that inside
  const lean = ((spread * mid) / 180) * Math.PI;
  const reach = n > 1 ? Math.max(0, (cw / 2) * (Math.cos(lean) - 1) + PIVOT * h * Math.sin(lean)) : 0;
  const room = width - 2 * reach;
  return { spread, gap: Math.min(cw * 0.62, n > 1 ? (room - cw - 8) / (n - 1) : 0) };
}

/** What shows of each card in a fan of `n` `cw`-wide cards across `width` (where you tap it). */
export const fanGap = (n: number, width: number, cw: number) => (n > 1 ? spacing(n, width, cw).gap : cw);

/**
 * Your hand as a fan across `width`: overlapped as much as the width needs (and no more than
 * most of a card apart), the outer cards leaning out and dropping a little.
 */
export function fan(ids: string[], width: number, cw: number): Placed {
  const n = ids.length;
  const h = cw * ASPECT;
  const placed: Placed = { w: width, h: n ? fanHeight(cw) : 0, spots: [] };
  if (!n || width <= 0) return placed;
  const mid = (n - 1) / 2;
  const { spread, gap } = spacing(n, width, cw);
  const left = (width - (cw + gap * (n - 1))) / 2;
  const top = placed.h - FOOT - h;
  placed.spots = ids.map((id, i) => {
    const off = i - mid;
    const rot = off * spread;
    const drop = Math.abs(off) ** 2 * Math.min(1.4, 40 / (n * n)) + Math.abs(off) * 0.6;
    // turned about a point below the card: its centre swings out along that circle
    const t = (rot * Math.PI) / 180;
    const arm = (PIVOT - 0.5) * h;
    return spot(id, id, left + i * gap + cw / 2 + arm * Math.sin(t), top + PIVOT * h + drop - arm * Math.cos(t), cw, i + 1, { rot });
  });
  return placed;
}

/** Which of the fan's places a card dragged along it to `x` lands in (the nearest). */
export function landing(placed: Placed, x: number): number {
  let best = 0;
  placed.spots.forEach((p, i) => {
    if (Math.abs(p.x - x) < Math.abs(placed.spots[best].x - x)) best = i;
  });
  return best;
}
