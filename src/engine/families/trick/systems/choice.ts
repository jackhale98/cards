import type { System } from './rules';

/**
 * The system the bots bid (the bridge lobby's "Bots bid"): 0 their own plain natural bidding, 1
 * SAYC, 2 two over one. A person partnering a bot is taken to play the same system.
 */
export function biddingSystem(g: { bridgeBids: boolean }, s: { options: Record<string, unknown>; players: unknown[] }): System | null {
  if (!g.bridgeBids || s.players.length !== 4) return null;
  const n = Number(s.options.system ?? 1);
  return n === 1 ? 'sayc' : n === 2 ? 'twoOverOne' : null;
}
