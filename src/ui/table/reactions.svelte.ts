import { REACTIONS } from '../../net/protocol';

/** Seconds a reaction stays on a seat. */
const SHOWN_MS = 3600;

/** How the reactions are named for a screen reader, in REACTIONS' order. */
export const REACTION_NAMES = ['Thumbs up', 'Applause', 'Laughing', 'Wow', 'Yikes', 'On fire'];

/** Reactions (an emoji someone sent) showing on seats just now, by game seat, each for a few seconds. */
export class Reactions {
  shown = $state<Record<number, { text: string; key: number }>>({});

  /** Seat `seat` sent reaction `e` (`key`: when, so a newer one on the same seat replaces it). */
  show(seat: number, e: number, key: number) {
    this.shown = { ...this.shown, [seat]: { text: REACTIONS[e], key } };
    setTimeout(() => {
      if (this.shown[seat]?.key !== key) return;
      const rest = { ...this.shown };
      delete rest[seat];
      this.shown = rest;
    }, SHOWN_MS);
  }
}
