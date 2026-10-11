import type { GameConfig, GameModule } from '../types';
import { climbingFamily } from './climbing';
import { cribbageFamily } from './cribbage';
import { freeFamily } from './free';
import { pokerFamily } from './poker';
import { rummyFamily } from './rummy';
import { rummy500Family } from './rummy500';
import { trickTakingFamily } from './trickTaking';

/**
 * Family engines. A game's `game.json` picks one with `"rules": { "family": "…" }` and sets its
 * parameters; most new games need no code at all. Add a family here when a new kind of game
 * (rummy, cribbage, …) needs mechanics the existing ones don't have.
 */
export const FAMILIES: Record<string, (config: GameConfig) => GameModule> = {
  free: freeFamily,
  climbing: climbingFamily,
  cribbage: cribbageFamily,
  'trick-taking': trickTakingFamily,
  poker: pokerFamily,
  // Gin (two players, knock) or Rummy 500 (melds on the table, any number)
  rummy: (config) => ((config.rules as { style?: string }).style === '500' ? rummy500Family(config) : rummyFamily(config)),
};

export function moduleFor(config: GameConfig): GameModule {
  const family = config.rules?.family ?? 'free';
  const make = FAMILIES[family];
  if (!make) throw new Error(`${config.id}: unknown rules family "${family}"`);
  return make(config);
}
