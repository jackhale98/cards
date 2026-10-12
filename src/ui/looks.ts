/**
 * Card backs and table cloths. The host picks one of each for the whole table (`lobby.look`), so
 * every phone and the TV show the same deck on the same cloth. They're drawn in CSS (nothing to
 * download): a back is two colours and a pattern laid over its base colour; a cloth is the three
 * shades of the felt gradient.
 */
export interface CardBack {
  id: string;
  name: string;
  /** Base colour and the colour of the frame line. */
  a: string;
  b: string;
  /** Background layers drawn over the base (CSS `background` list). */
  pattern: string;
}

export interface Cloth {
  id: string;
  name: string;
  /** Centre, middle and edge of the felt. */
  felt: [string, string, string];
}

const W = (a: number) => `rgba(255, 255, 255, ${a})`;
const lattice = (a = 0.07, s = 0.35) =>
  `repeating-linear-gradient(45deg, transparent 0 ${s}em, ${W(a)} ${s}em ${s * 2}em), repeating-linear-gradient(-45deg, transparent 0 ${s}em, ${W(a)} ${s}em ${s * 2}em)`;

export const BACKS: CardBack[] = [
  { id: 'classic', name: 'Classic', a: '#23395b', b: '#c99a2e', pattern: `radial-gradient(circle at 50% 50%, ${W(0.12)} 0 18%, transparent 19%), ${lattice()}` },
  { id: 'crimson', name: 'Crimson', a: '#8e1b26', b: '#f3efe6', pattern: lattice(0.09, 0.22) },
  { id: 'forest', name: 'Forest', a: '#1f4d36', b: '#e9c46a', pattern: `repeating-linear-gradient(90deg, transparent 0 0.42em, ${W(0.08)} 0.42em 0.5em)` },
  {
    id: 'deco',
    name: 'Art Deco',
    a: '#16171b',
    b: '#d4af37',
    pattern: `repeating-radial-gradient(circle at 50% 110%, transparent 0 0.5em, rgba(212, 175, 55, 0.35) 0.5em 0.58em), linear-gradient(90deg, transparent 49%, rgba(212, 175, 55, 0.4) 49% 51%, transparent 51%)`,
  },
  {
    id: 'lamplight',
    name: 'Lamplight',
    a: '#2a1f3d',
    b: '#e9c46a',
    pattern: `radial-gradient(circle at 50% 42%, rgba(255, 214, 120, 0.55) 0 8%, rgba(233, 196, 106, 0.18) 9% 30%, transparent 46%), radial-gradient(circle at 50% 42%, transparent 0 34%, rgba(233, 196, 106, 0.22) 34.5% 36%, transparent 36.5%)`,
  },
  {
    id: 'tartan',
    name: 'Tartan',
    a: '#7a1d22',
    b: '#e9c46a',
    pattern: `repeating-linear-gradient(0deg, transparent 0 0.6em, rgba(20, 70, 45, 0.55) 0.6em 1.1em, transparent 1.1em 1.3em, rgba(233, 196, 106, 0.35) 1.3em 1.38em), repeating-linear-gradient(90deg, transparent 0 0.6em, rgba(20, 70, 45, 0.55) 0.6em 1.1em, transparent 1.1em 1.3em, rgba(233, 196, 106, 0.35) 1.3em 1.38em)`,
  },
  {
    id: 'stars',
    name: 'Night sky',
    a: '#121a3a',
    b: '#cfd8ff',
    pattern: `radial-gradient(circle at 30% 30%, ${W(0.85)} 0 0.06em, transparent 0.08em), radial-gradient(circle at 70% 60%, ${W(0.6)} 0 0.05em, transparent 0.07em)`,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    a: '#0f5c6b',
    b: '#f3efe6',
    pattern: `repeating-radial-gradient(circle at 0 100%, transparent 0 0.45em, ${W(0.13)} 0.45em 0.55em), repeating-radial-gradient(circle at 100% 0, transparent 0 0.45em, ${W(0.07)} 0.45em 0.55em)`,
  },
  {
    id: 'rose',
    name: 'Rose',
    a: '#a8456b',
    b: '#fbf8f1',
    pattern: `radial-gradient(circle, ${W(0.2)} 0 0.12em, transparent 0.14em)`,
  },
];

/** Patterns of small repeating dots need a tile size (one per layer, the base colour last). */
export const BACK_TILE: Record<string, string> = { stars: '0.7em 0.7em, 0.9em 0.9em, 100% 100%', rose: '0.55em 0.55em, 100% 100%' };

export const CLOTHS: Cloth[] = [
  { id: 'green', name: 'Green baize', felt: ['#1d5c47', '#0f3a2d', '#071a14'] },
  { id: 'blue', name: 'Navy', felt: ['#1f4470', '#122a47', '#08131f'] },
  { id: 'red', name: 'Burgundy', felt: ['#6b2230', '#41131d', '#1d080d'] },
  { id: 'purple', name: 'Plum', felt: ['#4d2b5e', '#2e1838', '#150a1a'] },
  { id: 'wood', name: 'Oak', felt: ['#7a5432', '#4a311c', '#22160c'] },
  { id: 'black', name: 'Charcoal', felt: ['#3a3d42', '#212327', '#0c0d0f'] },
];

export interface Look {
  back: string;
  cloth: string;
}

export const DEFAULT_LOOK: Look = { back: 'classic', cloth: 'green' };

export const backOf = (id?: string) => BACKS.find((b) => b.id === id) ?? BACKS[0];
export const clothOf = (id?: string) => CLOTHS.find((c) => c.id === id) ?? CLOTHS[0];

/** CSS custom properties that draw a back (set on any element: cards inside it use them). */
export function backVars(id?: string): Record<string, string> {
  const b = backOf(id);
  return { '--back-a': b.a, '--back-b': b.b, '--back-pattern': b.pattern, '--back-tile': BACK_TILE[b.id] ?? 'auto' };
}

export function clothVars(id?: string): Record<string, string> {
  const [c1, c2, c3] = clothOf(id).felt;
  return { '--felt-1': c1, '--felt-2': c2, '--felt-3': c3 };
}

/** Dress the whole page in the table's look (or back to the default, with none). */
export function applyLook(look: Look | null | undefined) {
  const root = document.documentElement.style;
  const vars = { ...backVars(look?.back), ...clothVars(look?.cloth) };
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
}
