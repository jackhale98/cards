import { allowThinking, now } from '../engine/bots/search';
import type { GameModule, GameState } from '../engine/types';
import type { Pick } from './brain';

/**
 * Battery: the bots on one device think at most this share of the time, over a game night (a phone
 * thinking flat out runs hot and drains). Each move has its own budget too; this only bites where
 * those add up, as in Hard bridge play on a slow phone (dozens of deals solved a card).
 */
export const THINK_SHARE = 0.2;
/** ...in bursts of up to this long (a hand's hardest moves, at a table with people on it, are well within it). */
export const THINK_BURST_MS = 6000;
/** However tired the bots, a move still gets this long (they play their first idea, not a random card). */
export const THINK_LEAST_MS = 30;

/** The thinking time saved up (refilled at THINK_SHARE of the time that passes, thinking included), and when it was last topped up. */
const bank = { ms: THINK_BURST_MS, at: now() };

/**
 * The first bot in `seats` with a move under these rules (shared by the host and the bots' worker).
 * Each bot thinks with its own seat's view of the game (see botView.ts), never the real deal.
 */
export function pickWith(m: GameModule, views: Record<number, GameState>, seats: number[]): Pick | null {
  if (!m.bot) return null;
  for (const seat of seats) {
    const t = now();
    bank.ms = Math.min(THINK_BURST_MS, bank.ms + (t - bank.at) * THINK_SHARE);
    bank.at = t;
    allowThinking(Math.max(THINK_LEAST_MS, bank.ms));
    let action;
    try {
      action = m.bot(views[seat], seat);
    } finally {
      allowThinking(Infinity);
      bank.ms -= now() - t;
    }
    if (action) return { seat, action };
  }
  return null;
}

/** (tests) The bank full again. */
export function restThinking() {
  bank.ms = THINK_BURST_MS;
  bank.at = now();
}
