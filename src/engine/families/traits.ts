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
  if (config.rules?.family === 'rummy') return T(true, config.rules.style !== '500');
  return BY_FAMILY[family] ?? T(false, false);
}

/** Everyone for themselves. */
const solo = (n: number) => Array.from({ length: n }, (_, i) => [i]);
/** Partners sitting opposite: four as two pairs, six as three pairs. */
const across = (n: number) => Array.from({ length: n / 2 }, (_, i) => [i, i + n / 2]);

/**
 * The partnerships at a table of `n`, as the game's engine has them (its `sides`), worked out from
 * game.json alone so the lobby can show who partners whom without loading the rules: seat numbers
 * in the order players sit. Everyone alone is `n` sides of one. Checked against every engine at
 * every size it seats (tests/traits.test.ts).
 */
export function sidesOf(config: GameConfig, n: number): number[][] {
  const rules = { ...config.rules, ...(config.byPlayers?.[n]?.rules ?? {}) } as Record<string, unknown>;
  switch (config.rules?.family) {
    case 'trick-taking': {
      // (the game's partnerships when they fit the table, as the engine's teamsFor)
      const teams = rules.teams as number[][] | undefined;
      return teams?.filter((t) => t.every((x) => x < n)).length ? teams : solo(n);
    }
    case 'canasta':
      return n === 4 || n === 6 ? across(n) : solo(n);
    case 'cribbage':
      return n === 4 ? across(n) : solo(n);
    case 'pinochle':
      return [
        [0, 2],
        [1, 3],
      ];
    case 'handfoot':
      // (four or six: two teams, alternate seats)
      return n === 4 || n === 6 ? [0, 1].map((t) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === t)) : solo(n);
    default:
      return solo(n);
  }
}
