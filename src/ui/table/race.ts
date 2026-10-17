/**
 * Real-time games: how quickly you reacted, timed on this device, from when the race (a card worth
 * slapping, say: `GameStatus.race`) was first drawn on this screen, not from when the message came.
 */
export class RaceClock {
  #seen = { race: -1, at: 0 };
  constructor(private readonly now: () => number = () => performance.now()) {}

  /** The table now shows `race` (call on every update). `painted` runs a callback once the screen has been drawn. */
  saw(race: number | undefined, painted: (f: () => void) => void = requestAnimationFrame) {
    if (race === undefined || race === this.#seen.race) return;
    const at = this.now();
    this.#seen = { race, at };
    // (count from when it was painted, not from when the message arrived)
    painted(() => {
      if (this.#seen.race === race) this.#seen.at = Math.max(at, this.now());
    });
  }

  /** What to send with a reaction to `race`: which race, and how long you took (ms). */
  timing(race: number | undefined): { race?: number; rt?: number } {
    if (race === undefined) return {};
    return { race, rt: Math.round(Math.max(0, this.now() - this.#seen.at)) };
  }
}
