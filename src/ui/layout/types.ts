/**
 * The card layout's vocabulary. A zone's layout (see index.ts) is a pure function from the zone's
 * cards and its card size to the room it needs and a `Spot` for each card it draws, in the zone's
 * own pixels (its top left is 0, 0). The card layer (components/CardLayer.svelte) moves each spot
 * to where the zone's frame is on screen and draws the card there, easing it from wherever it
 * was. Nothing here reads the page.
 */

/** A rectangle in px. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A card's height for its width. */
export const ASPECT = 1.4;

/** Where one card is drawn, and how. `x`, `y` are its centre; `rot` is in degrees. */
export interface Spot {
  /**
   * What the card layer knows the card by from one moment to the next: its id, or for a card
   * nobody can see that has no lasting id (the top of the deck), the pile's own name for it.
   */
  key: string;
  /** The card to draw (a placeholder `?…` draws its back). */
  id: string;
  x: number;
  y: number;
  /** Card width (its height is ASPECT times this). */
  w: number;
  rot: number;
  /** Stacking within the zone (higher is on top). */
  z: number;
  /** Drawn face down. */
  down?: boolean;
  selected?: boolean;
  /** One you can play now (with hints on, and some you can't). */
  playable?: boolean;
  /** Shaded: one you can't use now, or one the game marks (a dead card). */
  dim?: boolean;
  /** Just came into your hand. */
  fresh?: boolean;
  /** The pile is yours to tap now: its top card glows. */
  glow?: boolean;
  /** A squared pile's size, shown on its top card (canasta's melds). */
  count?: number;
  /** Following your finger: no easing. */
  held?: boolean;
}

/** A zone laid out: the room it takes and its cards in it. */
export interface Placed {
  w: number;
  h: number;
  spots: Spot[];
}

export const spot = (key: string, id: string, x: number, y: number, w: number, z: number, rest: Partial<Spot> = {}): Spot => ({
  key,
  id,
  x,
  y,
  w,
  rot: 0,
  z,
  ...rest,
});
