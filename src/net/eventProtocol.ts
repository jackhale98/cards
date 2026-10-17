import type { EventPersonal, EventPublic } from '../engine/events';
import type { TableChange } from '../engine/types';
import type { SignedMove } from './eventCrypto';
import type { EventTable, TableNews } from './host/event';
import type { Avatar, View } from './protocol';

/**
 * Messages in a tournament's own rooms (the director's: see src/net/director/desk.ts), between the
 * director and the phones signing up or finding their table, the screens showing the event, and
 * the phones hosting its tables. An older app ignores them (and can't open a tournament's code).
 */

/** Bumped when these messages change: a phone or table on another version is asked to reload. */
export const EVENT_PROTOCOL = 1;

/** A table's progress, for its tile on the screens: whether it's dealt, hands played, who's still to come, and the game's own totals. */
export interface TableTile {
  started: boolean;
  over: boolean;
  hands: number;
  /** Players the table is still waiting for (by name). */
  waiting: string[];
  /** The scoreboard's totals, as everyone sees them (null: none to show). */
  totals: { name: string; total: string }[] | null;
}

/** Someone signed up, as everyone may see: their name, look, and who they asked to partner (partnership games). */
export interface EventPerson {
  id: string;
  name: string;
  avatar?: Avatar;
  partner?: string;
  /** A bot the director put in. */
  bot?: boolean;
}

/**
 * What the screens show, as the director chooses: the tables, the standings and (a knockout) the
 * bracket in turn, or just one of them, or the tables live, one after another.
 */
export type BoardShow = 'turn' | 'tables' | 'standings' | 'bracket' | 'live';
export const BOARD_SHOWS: readonly BoardShow[] = ['turn', 'tables', 'standings', 'bracket', 'live'];

/** To the director. */
export type EventInMsg =
  /** Signing up: who they are and their secret (sent this once). */
  | { t: 'evJoin'; v: number; cid: string; name: string; avatar?: Avatar; secret: string }
  /** Back (signed up before): the director answers with a challenge. */
  | { t: 'evBack'; v: number; cid: string }
  /** A table's host linking up for its round and table: the director answers with a challenge. */
  | { t: 'evLink'; v: number; cid: string; round: number; table: number }
  /** The answer to the challenge. */
  | { t: 'evProve'; mac: string }
  /** A screen showing the event. */
  | { t: 'evScreen'; v: number }
  /** Partnership games: who they'd like to partner (null: nobody yet). */
  | { t: 'evPartner'; with: string | null }
  /** From a table's host: its news (sent again until acknowledged), its progress, its screen's view while featured. */
  | { t: 'evNews'; id: number; news: TableNews }
  | { t: 'evTile'; tile: TableTile }
  | { t: 'evView'; view: View };

/** From the director. */
export type EventOutMsg =
  /** To each newcomer: the director is here (where the network can't vouch for its host, phones speak only to whoever says so). */
  | { t: 'evHere' }
  | { t: 'evChallenge'; n: string }
  /** In (signed up, or back): where they stand. */
  | { t: 'evWelcome'; you: EventPersonal }
  | { t: 'evRefused'; why: string; reload?: boolean }
  /** This room is full: that one instead. */
  | { t: 'evRoom'; code: string }
  | { t: 'evYou'; you: EventPersonal }
  /** The event as the screens show it (and the people signed up, before it starts); `live`: a table being featured. */
  | {
      t: 'evBoard';
      board: EventPublic;
      people: EventPerson[];
      tiles?: { table: number; tile: TableTile | null }[];
      live?: { table: number; view: View } | null;
      show?: BoardShow;
    }
  /** Go to this table. */
  | { t: 'evMove'; move: SignedMove }
  /** To a table's host: the table, who sits where (with their seats' keys), and what to deal. */
  | { t: 'evSeat'; table: EventTable }
  | { t: 'evHold'; on: boolean }
  | { t: 'evAdjust'; change: TableChange }
  | { t: 'evStandIn'; seat: number }
  /** Send the table's screen view while it's featured (or stop). */
  | { t: 'evFeature'; on: boolean }
  /** Pass these moves on to the players at the table (each signed for its player: see eventCrypto). */
  | { t: 'evForward'; moves: { cid: string; move: SignedMove }[] }
  | { t: 'evAck'; id: number };

export type EventMsg = EventInMsg | EventOutMsg;
