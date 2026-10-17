import { getContext, setContext } from 'svelte';
import type { Spot } from './types';

/**
 * The frames on the table: each zone (and your hand, and each seat) lays out its cards in a frame of its own,
 * the box the page gives it, and registers it here; the card layer draws every frame's cards.
 */
export interface Frame {
  /** The element the spots are placed in: its top left is their 0, 0 (it may be scaled, as the middle is to fit). */
  el: HTMLElement;
  /** The zone it draws: moves to and from it are named by zone in the log. */
  zone: string;
  /** The player whose zone it is (cards new to it come from their seat). */
  owner?: number;
  /** Stacking against the other frames: your hand over the middle, the trick over the piles. */
  layer: number;
  spots: Spot[];
  /**
   * Every card in the zone, drawn or not: a card that leaves the drawing but not the zone (under
   * the top of a pile) is buried, not gone.
   */
  ids: string[];
  /**
   * Its face-down cards only show how many there are (a seat's backs): one that goes fades where
   * it is, and the card itself turns up wherever it went, coming from here.
   */
  tally?: boolean;
}

export class Frames {
  all = $state.raw<Record<string, Frame>>({});
  /**
   * Changed when the table moves whole hands about (bridge's dummy and your hand trading places):
   * cards that change frame then trade places quietly, rather than flying past each other.
   */
  calm = $state('');

  /**
   * The frames themselves, kept outside Svelte's state: a zone drops its frame from an effect's
   * cleanup, where state reads give the value from before the change (stale), and would put back
   * frames dropped meanwhile or lose ones added.
   */
  #frames = new Map<string, Frame>();

  set(key: string, frame: Frame) {
    this.#frames.set(key, frame);
    this.all = Object.fromEntries(this.#frames);
  }

  drop(key: string, el: HTMLElement) {
    if (this.#frames.get(key)?.el !== el) return;
    this.#frames.delete(key);
    this.all = Object.fromEntries(this.#frames);
  }
}

const KEY = Symbol('card frames');
/** The table's frames, for the zones in it (set up by the table, read by its zones and hand). */
export const provideFrames = (frames: Frames) => setContext(KEY, frames);
/** None outside a table (the full-screen melds): there a zone draws its own cards. */
export const useFrames = () => getContext<Frames | undefined>(KEY);

/** Frames' stacking: the middle's piles, the trick, your hand, a card on its way somewhere. */
export const LAYER = { piles: 100, trick: 200, hand: 400, leaving: 900, flying: 1000, held: 2000 } as const;
