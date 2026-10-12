/**
 * The game registry with every game's rules loaded, for tests: `GAMES.hearts.setup(…)` and
 * `GAME_LIST` hold full rules engines here (the app loads them one at a time, when picked).
 */
import { GAME_LIST as INFO, loadAllRules } from '../src/games';
import type { GameModule } from '../src/engine/types';

export * from '../src/games';
export const GAMES: Record<string, GameModule> = await loadAllRules();
export const GAME_LIST: GameModule[] = INFO.map((g) => GAMES[g.config.id]);
