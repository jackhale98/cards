import type { Board } from '../../engine/types';
import type { HostSnapshot } from '../host';
import type { LobbySeat } from '../protocol';
import type { BotSeat, EventSeat, EventTable } from './event';

/**
 * Duplicate in a room (bridge's Scoring: Duplicate, compared with another table): a second table
 * plays the same boards, hosted on this device too. Whoever is sitting out plays there (bots in any
 * seats left), or, with nobody sitting out, bots alone. It's run as a tournament's table is (each
 * seat held by its player's key, nothing there to change), and each table hears the other's result
 * on a board once it has played that board itself (see Host.compare).
 */

/** What the host keeps of its other table (in its snapshots and backups: a takeover carries it on). */
export interface TwinSaved {
  /** The other table, as its host saw it. */
  snap: HostSnapshot;
  /** Its room (people play there), or null (bots alone, with no network). */
  room: string | null;
  /** How this table names it ("Bots", "Table 2"). */
  label: string;
  /** Which game of boards this is (each new one is the next). */
  match: number;
  seats: (EventSeat | BotSeat)[];
}

/**
 * Who plays at the other table: whoever is sitting out here and connected (the first two partners,
 * North and South), and bots in the seats left.
 */
export function twinSeats(seats: LobbySeat[], keys: Record<string, string>, count: number): (EventSeat | BotSeat)[] {
  const people = seats.filter((s) => s.out && !s.bot && !s.host && !s.screen && s.connected && keys[s.id]).slice(0, count);
  const order = count === 4 ? [0, 2, 1, 3] : Array.from({ length: count }, (_, i) => i);
  const out: (EventSeat | BotSeat)[] = Array.from({ length: count }, () => ({ bot: true, name: '' }));
  people.forEach((p, i) => (out[order[i]] = { id: p.id, name: p.name, ...(p.avatar ? { avatar: p.avatar } : {}), key: keys[p.id] }));
  return out;
}

/** The other table's seating for game `match`: the same game, these boards. `code`: this table's room. */
export function twinTable(o: {
  code: string;
  match: number;
  game: { id: string; options: Record<string, number | boolean> };
  seats: (EventSeat | BotSeat)[];
  boards: Board[];
}): EventTable {
  return {
    info: { code: o.code, name: 'Duplicate', round: o.match, table: 2, note: 'The same boards as table 1' },
    game: o.game,
    seats: o.seats,
    setup: { boards: o.boards, compared: true },
  };
}

/** A set of boards, told apart from another (a new game deals new ones). */
export const boardsKey = (boards: Board[]) => boards.map((b) => `${b.n}:${b.hands.map((h) => h.join('')).join('/')}`).join('|');
