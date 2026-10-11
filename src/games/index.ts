import type { GameConfig, GameModule } from '../engine/types';
import { freeTableModule } from './freetable/rules';

/**
 * Game registry. Every folder in `src/games/` with a `game.json` is a game.
 * If the folder also has a `rules.ts`, its default export enforces the rules;
 * otherwise the game runs as a Free Table preset using the config.
 */
const configs = import.meta.glob<GameConfig>('./*/game.json', { eager: true, import: 'default' });
const rules = import.meta.glob<GameModule>('./*/rules.ts', { eager: true, import: 'default' });

export const GAMES: Record<string, GameModule> = {};
for (const [path, config] of Object.entries(configs)) {
  const dir = path.slice(0, path.lastIndexOf('/'));
  GAMES[config.id] = rules[`${dir}/rules.ts`] ?? freeTableModule(config);
}

/** Display order on the game picker. */
const ORDER = ['holdem', 'hearts', 'freetable'];
export const GAME_LIST: GameModule[] = Object.values(GAMES).sort(
  (a, b) => (ORDER.indexOf(a.config.id) + 1 || 99) - (ORDER.indexOf(b.config.id) + 1 || 99),
);

export function getGame(id: string): GameModule {
  const g = GAMES[id];
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}
