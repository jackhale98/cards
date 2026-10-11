import { moduleFor } from '../engine/families';
import type { GameConfig, GameModule } from '../engine/types';

/**
 * Game registry. Every folder in `src/games/` with a `game.json` is a game, run by the family
 * engine named in its `rules` block (Free Table if none). For rules no family covers, a
 * `rules.ts` in the folder can export its own GameModule instead.
 */
const configs = import.meta.glob<GameConfig>('./*/game.json', { eager: true, import: 'default' });
const custom = import.meta.glob<GameModule>('./*/rules.ts', { eager: true, import: 'default' });

export const GAMES: Record<string, GameModule> = {};
for (const [path, config] of Object.entries(configs)) {
  const dir = path.slice(0, path.lastIndexOf('/'));
  GAMES[config.id] = custom[`${dir}/rules.ts`] ?? moduleFor(config);
}

/** Display order on the game picker; anything else follows alphabetically. */
const ORDER = ['holdem', 'hearts', 'spades', 'euchre', 'five-hundred', 'cribbage', 'bridge', 'gin-rummy', 'rummy-500', 'oh-hell', 'omaha', 'freetable'];
const rank = (id: string) => (ORDER.indexOf(id) + 1 || 99);
export const GAME_LIST: GameModule[] = Object.values(GAMES).sort(
  (a, b) => rank(a.config.id) - rank(b.config.id) || a.config.name.localeCompare(b.config.name),
);

export function getGame(id: string): GameModule {
  const g = GAMES[id];
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}
