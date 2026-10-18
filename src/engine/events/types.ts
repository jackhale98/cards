import type { RngState } from '../rng';
import type { TableReport, TableSetup } from '../types';

/**
 * A tournament: entrants (people, or partnerships that registered together) play rounds at
 * tables, and a format decides who meets whom and who wins. All plain JSON (it's persisted and
 * backed up with the director's table), and it holds nothing secret but the tables' deals, which
 * the public views leave out (see view.ts).
 */

/** How entrants meet; `pairs` and `teams` are duplicate bridge's (see duplicate.ts). */
export type FormatId = 'swiss' | 'roundRobin' | 'knockout' | 'pairs' | 'teams';

export interface EventConfig {
  name: string;
  format: FormatId;
  game: { id: string; options: Record<string, number | boolean> };
  /** Seats at a table. */
  seats: number;
  /** Who partners whom at a table (each side is one entrant): `[[0, 2], [1, 3]]`, or one seat each. */
  sides: number[][];
  /** Swiss and duplicate: how many rounds (round robin and knockout go on until they're done). */
  rounds?: number;
  /** Duplicate: boards a round. */
  boards?: number;
  /** Knockout with more than two sides at a table: how many go through from each (1 or 2). */
  advance?: number;
  /** Who hosts the tables: a player at each, or the director's device. */
  host: 'player' | 'director';
}

export interface Entrant {
  id: string;
  name: string;
  /** Who plays for this entrant, one per seat of a side (people's ids; a duplicate team, two sides' worth); none for a bot entrant. */
  members: string[];
  /** Each member's own name, as they signed up (the entrant's is "Ann & Bo"). */
  names?: string[];
  /** A bot plays for this entrant (an event against bots, or one in tests). */
  bot?: boolean;
  /** Withdrawn: not paired again (their results so far stand). */
  out?: boolean;
  /** Their place in the draw, drawn when the event starts: the last tiebreak, and a knockout's seeding. */
  draw?: number;
}

/** A seat at a table: the entrant it plays for (null: a bot filling a gap) and the person in it (null: a bot plays it). */
export interface TableSeat {
  entrant: string | null;
  member: string | null;
}

export interface TableRound {
  /** Numbered from 1 within the round. */
  table: number;
  /** Duplicate teams: the match it's half of (the match's other table has the same). */
  match?: number;
  seats: TableSeat[];
  /** Private: the seed its game is dealt from, and its private inputs. Never in a public view. */
  seed: number;
  setup?: TableSetup;
  /** Each seat's place (0 = first) when the game is over, and its score when the game keeps one per player. */
  result?: { places: number[]; scores?: number[] };
  report?: TableReport;
}

export interface Round {
  /** Numbered from 1. */
  n: number;
  tables: TableRound[];
  /** Entrants without a table this round. */
  byes: string[];
  /** Knockout, two sides a table: the bracket's places this round, in order (each pair meets; null: nobody there). */
  order?: (string | null)[];
}

export interface EventState {
  config: EventConfig;
  entrants: Entrant[];
  rounds: Round[];
  /** Taking entrants, playing a round, between rounds (every table done), or over. */
  phase: 'registering' | 'playing' | 'between' | 'done';
  rng: RngState;
  /** Round robin: the draw's order, which every round's pairings come from. Knockout: the bracket's slots (null: a bye). */
  order?: (string | null)[];
}

/** One line of the standings. */
export interface StandingRow {
  entrant: string;
  name: string;
  /** 1 = first; equals share a rank. */
  rank: number;
  /** What ranks them: points from places (or matches, duplicate teams); duplicate pairs, a percentage. */
  points: number;
  played: number;
  wins: number;
  /** The game's own score, added up (games that keep one per player); duplicate pairs, matchpoints; teams, IMPs. */
  score: number | null;
  /** Swiss tiebreak: the points of everyone they've played. */
  opponents: number;
  /** Knockout: still in. */
  alive?: boolean;
  out?: boolean;
  bot?: boolean;
}
