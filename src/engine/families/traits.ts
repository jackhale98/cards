import type { GameConfig } from '../types';

/**
 * What the lobby and table need to know about a game before its rules are loaded: whether it has
 * bots, whether they come in strengths (the "Bots" option), and whether it's played in real time.
 * Kept here, by family, so the game picker never downloads rules; `tests/traits.test.ts` checks
 * every game against its real engine, so this can't drift.
 */
export interface Traits {
  bot: boolean;
  botLevels: boolean;
  realtime: boolean;
}

const T = (bot: boolean, botLevels: boolean, realtime = false): Traits => ({ bot, botLevels, realtime });

const BY_FAMILY: Record<string, Traits> = {
  free: T(false, false),
  baccarat: T(true, false),
  blackjack: T(true, false),
  canasta: T(true, false),
  cheat: T(true, true),
  climbing: T(true, true),
  corners: T(true, false),
  cribbage: T(true, true),
  eights: T(true, true),
  gofish: T(true, true),
  handfoot: T(true, false),
  palace: T(true, false),
  pinochle: T(true, false),
  poker: T(true, true),
  slap: T(true, true, true),
  spit: T(true, true, true),
  spoons: T(true, true, true),
  'trick-taking': T(true, true),
};

export function traitsOf(config: GameConfig): Traits {
  const family = config.rules?.family ?? 'free';
  // (rummy: Gin's bots think harder at higher levels; Rummy 500's don't)
  if (family === 'rummy') return T(true, (config.rules as { style?: string }).style !== '500');
  return BY_FAMILY[family] ?? T(false, false);
}
