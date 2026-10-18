/**
 * A tournament's board on a screen (a TV, a laptop): how big its type is for the window, and how
 * many tables' tiles fit across. Pure arithmetic, set on the page inline (see EventBoard.svelte).
 */

/** The board's type size (px, the page's rem): read across a room on a TV, still tidy on a laptop. */
export const boardRem = (vw: number, vh: number) => Math.round(Math.max(14, Math.min(34, vw * 0.0125, vh * 0.024)));

/** A table's tile is this many rem wide at the least. */
export const TILE_REM = 15;
/** Between tiles (rem). */
export const TILE_GAP_REM = 0.8;

/** How many tiles fit across `width` px (at least one, at most one per table). */
export function tileColumns(width: number, rem: number, tables: number): number {
  const fit = Math.floor((width + TILE_GAP_REM * rem) / ((TILE_REM + TILE_GAP_REM) * rem));
  return Math.max(1, Math.min(Math.max(1, tables), fit));
}

/** The board's padding at its sides (rem). */
export const BOARD_PAD_X_REM = 1.6;

/** A board's traveller is this many rem wide at the least. */
export const TRAVELLER_REM = 24;

/** How many boards' travellers fit across `width` px (the latest ones show; at least one). */
export const travellerColumns = (width: number, rem: number) => Math.max(1, Math.floor((width + TILE_GAP_REM * rem) / ((TRAVELLER_REM + TILE_GAP_REM) * rem)));

/** Standings rows that fit `height` px (a row is about 2.4rem; the rest wait for the next page). */
export const standingsRows = (height: number, rem: number) => Math.max(4, Math.floor(height / (2.4 * rem)));

/** Poker: the board checks the time to the next blind level this often (ms): minutes are all it shows. */
export const CLOCK_EVERY_MS = 15_000;

/** How long the board shows each of its views before the next (ms). */
export const BOARD_TURN_MS = 15_000;
