import type { GameModule, GameState } from '../engine/types';
import type { Pick } from './brain';

/** The first bot in `seats` with a move under these rules (shared by the host and the bots' worker). */
export function pickWith(m: GameModule, s: GameState, seats: number[]): Pick | null {
  if (!m.bot) return null;
  for (const seat of seats) {
    const action = m.bot(s, seat);
    if (action) return { seat, action };
  }
  return null;
}
