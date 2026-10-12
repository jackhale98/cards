/**
 * Helpers for the real-time games (slap, spit, spoons), where everyone acts at once and the host
 * settles races by reaction time.
 */

/**
 * How long the host waits after the first good grab (a slap, a spoon) for quicker reactions to
 * arrive: a player on a slower connection whose tap was faster still wins.
 */
export const REACTION_WINDOW = 350;

/** Milliseconds from now until a time on the host's clock (never negative). */
export const msUntil = (at: number) => Math.max(0, at - Date.now());

/** A bot's reaction time, somewhere between `lo` and `hi` ms (Math.random: the bot's own dice, not the game's). */
export const span = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
