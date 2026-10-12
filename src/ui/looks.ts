/**
 * Card backs and table cloths. The host picks one of each for the whole table (`lobby.look`), so
 * every phone and the TV show the same deck on the same cloth. Nothing is downloaded or sent: only
 * the ids travel, and each device draws them itself. A back is a small SVG of the whole card
 * (ui/backArt.ts); a cloth is the three shades of the felt gradient.
 */
import { BACK_ART, backImage } from './backArt';
export interface CardBack {
  id: string;
  name: string;
  /** Flat colour of the field, shown behind the art. */
  colour: string;
  /** The art as a CSS background image. */
  image: string;
}

export interface Cloth {
  id: string;
  name: string;
  /** Centre, middle and edge of the felt. */
  felt: [string, string, string];
}

export const BACKS: CardBack[] = BACK_ART.map((b) => ({ id: b.id, name: b.name, colour: b.colour, image: backImage(b.svg) }));

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
  return { '--back-a': b.colour, '--back-art': b.image };
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
