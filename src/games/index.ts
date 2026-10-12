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
  const g = (GAMES[config.id] = custom[`${dir}/rules.ts`] ?? moduleFor(config));
  // games whose bots can think harder get the strength setting
  if (g.botLevels && !g.config.options?.some((o) => o.id === 'botLevel'))
    g.config.options = [...(g.config.options ?? []), { id: 'botLevel', label: 'Bots', type: 'number', choices: ['Easy', 'Normal', 'Hard'], default: 1 }];
}

/** Game picker order: alphabetical by name, with the rules-free Free Table last. */
const LAST = ['freetable'];
export const GAME_LIST: GameModule[] = Object.values(GAMES).sort(
  (a, b) =>
    Number(LAST.includes(a.config.id)) - Number(LAST.includes(b.config.id)) ||
    a.config.name.localeCompare(b.config.name, 'en', { numeric: true }),
);

/** Picker sections, in order. Games pick one with `category`, or get one from their rules family. */
export const CATEGORIES = ['Poker', 'Casino', 'Trick-taking', 'Rummy', 'Shedding', 'Family', 'More'] as const;
const BY_FAMILY: Record<string, string> = {
  poker: 'Poker',
  'trick-taking': 'Trick-taking',
  rummy: 'Rummy',
  canasta: 'Rummy',
  handfoot: 'Rummy',
  climbing: 'Shedding',
  eights: 'Shedding',
  cheat: 'Shedding',
  palace: 'Shedding',
  pinochle: 'Trick-taking',
  gofish: 'Family',
  corners: 'Family',
  baccarat: 'Casino',
  blackjack: 'Casino',
};
export function categoryOf(g: GameModule): string {
  const c = g.config.category ?? BY_FAMILY[g.config.rules?.family ?? 'free'] ?? 'More';
  return (CATEGORIES as readonly string[]).includes(c) ? c : 'More';
}

/** Player counts a game takes, as text: "4", "2–8", "2 or 4". */
export function playersText(g: GameModule): string {
  const p = g.config.players;
  if (!p.counts) return p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
  // runs of three or more read as a range: 2, 3, 4, 6 → "2–4 or 6"
  const runs: number[][] = [];
  for (const c of [...p.counts].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && c === last.at(-1)! + 1) last.push(c);
    else runs.push([c]);
  }
  return runs.flatMap((r) => (r.length >= 3 ? [`${r[0]}–${r.at(-1)}`] : r.map(String))).join(' or ');
}

/**
 * Can the people at the table play this? Bots fill missing seats in games that have them, so only
 * too many people (or too few, without bots) rules a game out. Returns why not, or null.
 */
export function misfit(g: GameModule, people: number): string | null {
  const p = g.config.players;
  const max = p.counts ? Math.max(...p.counts) : p.max;
  if (people > max) return `up to ${max}`;
  if (!g.bot && people < p.min) return `needs ${p.min}+`;
  if (p.counts && !g.bot && !p.counts.includes(people)) return `${p.counts.join(' or ')} players`;
  return null;
}

export function getGame(id: string): GameModule {
  const g = GAMES[id];
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}
