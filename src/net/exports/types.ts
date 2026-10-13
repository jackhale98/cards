import type { Action, GameState } from '../../engine/types';

/**
 * The seat to write a file for that shows every hand: for checking our records with other
 * programs (tests and tools/), never for a player.
 */
export const EVERYONE = -2;

/** Who's at the table, for the file's headings. */
export interface RecordMeta {
  /** Players' names by game seat. */
  names: string[];
  /** The table's code (a game number, in a hand history). */
  table: string;
}

/**
 * A game's standard record format (PBN, Open Hand History). It follows each hand as it's played,
 * keeping only what its file needs (`H`, per hand), then writes the file for one player: what
 * they saw, never cards they didn't.
 */
export interface HandFormat<H> {
  /** A hand is dealt (the host's state: everyone's cards). */
  start(deal: GameState, at: Date): H;
  /** After each change at the table; `move` when a player (or bot) made it. */
  step(hand: H, prev: GameState, next: GameState, move?: { seat: number; action: Action }): void;
  /** The hand is over. */
  end(hand: H, last: GameState): void;
  /** The file, for the player in `seat` (-1: someone watching; EVERYONE: every card, for checking). */
  write(hands: H[], seat: number, meta: RecordMeta): string;
}
