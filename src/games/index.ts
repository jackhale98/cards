import { loadModule } from '../engine/families';
import { traitsOf, type Traits } from '../engine/families/traits';
import type { GameConfig, GameModule } from '../engine/types';

/**
 * Game registry. Every folder in `src/games/` with a `game.json` is a game, run by the family
 * engine named in its `rules` block (Free Table if none). For rules no family covers, a
 * `rules.ts` in the folder can export its own GameModule instead (its bots and real-time play
 * then need declaring in `engine/families/traits.ts`; `tests/traits.test.ts` will say so).
 *
 * The game files are small and load with the app (the picker, lobby and table need them); the
 * rules engines are the bulk of the code and load only when a game is picked (`loadRules`), and
 * only on the host's device: everyone else just shows what the host sends.
 */
const configs = import.meta.glob<GameConfig>('./*/game.json', { eager: true, import: 'default' });
const custom = import.meta.glob<GameModule>('./*/rules.ts', { import: 'default' });

/** A game as the picker and table know it, without its rules engine. */
export interface GameInfo extends Traits {
  config: GameConfig;
}

export const GAMES: Record<string, GameInfo> = {};
for (const config of Object.values(configs)) {
  const info = (GAMES[config.id] = { config, ...traitsOf(config) });
  // games whose bots can think harder get the strength setting
  if (info.botLevels && !config.options?.some((o) => o.id === 'botLevel'))
    config.options = [...(config.options ?? []), { id: 'botLevel', label: 'Bots', type: 'number', choices: ['Easy', 'Normal', 'Hard'], default: 1 }];
}

/** Game picker order: alphabetical by name, with the rules-free Free Table last. */
const LAST = ['freetable'];
export const GAME_LIST: GameInfo[] = Object.values(GAMES).sort(
  (a, b) =>
    Number(LAST.includes(a.config.id)) - Number(LAST.includes(b.config.id)) ||
    a.config.name.localeCompare(b.config.name, 'en', { numeric: true }),
);

const loaded = new Map<string, GameModule>();
const loading = new Map<string, Promise<GameModule>>();

/** Load a game's rules (once; later calls share the same download). */
export function loadRules(id: string): Promise<GameModule> {
  const ready = loaded.get(id);
  if (ready) return Promise.resolve(ready);
  let p = loading.get(id);
  if (!p) {
    const info = getGame(id);
    const own = Object.entries(custom).find(([path]) => path.startsWith(`./${dirOf(id)}/`))?.[1];
    p = (own ? own() : loadModule(info.config)).then(
      (m) => (loaded.set(id, m), m),
      (e) => {
        loading.delete(id); // (a failed download can be tried again)
        throw e;
      },
    );
    loading.set(id, p);
  }
  return p;
}

/** A game's rules, already loaded with `loadRules` (null if they aren't yet). */
export function rulesFor(id: string): GameModule | null {
  return loaded.get(id) ?? null;
}

/** Every game's rules (tests, and anything that needs them all). */
export async function loadAllRules(): Promise<Record<string, GameModule>> {
  const all = await Promise.all(GAME_LIST.map((g) => loadRules(g.config.id)));
  return Object.fromEntries(all.map((m) => [m.config.id, m]));
}

const dirOf = (id: string) => {
  const path = Object.entries(configs).find(([, c]) => c.id === id)?.[0] ?? '';
  return path.slice(2, path.lastIndexOf('/'));
};

/** Picker sections, in order. Games pick one with `category`, or get one from their rules family. */
export const CATEGORIES = ['Poker', 'Casino', 'Trick-taking', 'Rummy', 'Shedding', 'Family', 'Speed', 'More'] as const;
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
  slap: 'Speed',
  spit: 'Speed',
  spoons: 'Speed',
  baccarat: 'Casino',
  blackjack: 'Casino',
};
export function categoryOf(g: { config: GameConfig }): string {
  const c = g.config.category ?? BY_FAMILY[g.config.rules?.family ?? 'free'] ?? 'More';
  return (CATEGORIES as readonly string[]).includes(c) ? c : 'More';
}

/** Player counts a game takes, as text: "4", "2–8", "2 or 4". */
export function playersText(g: { config: GameConfig }): string {
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
export function misfit(g: { config: GameConfig; bot?: unknown }, people: number): string | null {
  const p = g.config.players;
  const max = p.counts ? Math.max(...p.counts) : p.max;
  if (people > max) return `up to ${max}`;
  if (!g.bot && people < p.min) return `needs ${p.min}+`;
  if (p.counts && !g.bot && !p.counts.includes(people)) return `${p.counts.join(' or ')} players`;
  return null;
}

export function getGame(id: string): GameInfo {
  const g = GAMES[id];
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}

/** Lower case, no accents or apostrophes ("Hold'em" → "holdem"), words split on anything else. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const seats = (g: { config: GameConfig }, n: number) => {
  const p = g.config.players;
  return p.counts ? p.counts.includes(n) : n >= p.min && n <= p.max;
};

/**
 * The picker's search. Every word typed must match the start of a word in the game's name, other
 * names, kind or tagline; a number also matches games that seat that many ("6" finds the games for
 * six). Best matches first: the name itself, then other names, then the rest.
 */
export function searchGames(query: string): GameInfo[];
export function searchGames<G extends { config: GameConfig }>(query: string, games: G[]): G[];
export function searchGames<G extends { config: GameConfig }>(query: string, games: G[] = GAME_LIST as unknown as G[]): G[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return games;
  const scored: { g: G; score: number }[] = [];
  for (const g of games) {
    const name = ` ${fold(g.config.name)}`;
    const aliases = ` ${fold((g.config.aliases ?? []).join(' '))}`;
    const rest = ` ${fold([categoryOf(g), g.config.rules?.family ?? '', g.config.tagline].join(' '))}`;
    let score = 0;
    let ok = true;
    for (const w of words) {
      const at = ` ${w}`;
      if (name.includes(at)) score += name.startsWith(at) ? 4 : 3;
      else if (aliases.includes(at)) score += 2;
      else if (rest.includes(at)) score += 1;
      else if (/^\d+$/.test(w) && seats(g, Number(w))) score += 1;
      else ok = false;
    }
    if (ok) scored.push({ g, score });
  }
  // (a stable sort: equal scores keep the picker's alphabetical order)
  return scored.sort((a, b) => b.score - a.score).map((x) => x.g);
}
