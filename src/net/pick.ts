import type { GameModule, GameState } from '../engine/types';
import type { Pick } from './brain';

/**
 * The first bot in `seats` with a move under these rules (shared by the host and the bots' worker).
 * Each bot thinks with its own seat's view of the game (see botView.ts), never the real deal.
 */
export function pickWith(m: GameModule, views: Record<number, GameState>, seats: number[]): Pick | null {
  if (!m.bot) return null;
  for (const seat of seats) {
    const action = m.bot(views[seat], seat);
    if (action) return { seat, action };
  }
  return null;
}
