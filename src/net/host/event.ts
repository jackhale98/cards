import { standingsOf } from '../../engine/state';
import type { GameModule, GameState, TableReport, TableSetup } from '../../engine/types';
import { AVATAR_COLORS, AVATAR_EMOJI, type Avatar, type LobbyEvent, type LobbySeat } from '../protocol';
import { BOT_NAMES } from './limits';
import { totalsOf } from './records';

/**
 * A table in a tournament (see src/engine/events and src/net/director.ts). The director decides
 * who sits where, what's dealt and when the table moves on; the table's host runs the game as any
 * other, except that nobody at the table can change the game, its seats or deal again, and it
 * tells the director how each hand and the game went.
 */

/** A member's place at the table: who they are, and the key that holds the seat. */
export interface EventSeat {
  id: string;
  name: string;
  avatar?: Avatar;
  key: string;
}

/** A bot playing for an entrant (an event against bots). */
export interface BotSeat {
  bot: true;
  /** Empty: the table names it (a person's bot partner). */
  name: string;
}
const isMember = (m: EventSeat | BotSeat | null): m is EventSeat => !!m && !('bot' in m);

export interface EventTable {
  /** What everyone at the table may know (it goes in the lobby). */
  info: LobbyEvent;
  game: { id: string; options: Record<string, number | boolean> };
  /** Who sits where, in game-seat order: a member, a bot playing for an entrant (by its name), or null for a bot filling a gap. */
  seats: (EventSeat | BotSeat | null)[];
  /** The game's private inputs (boards, chips): never in the lobby. */
  setup?: TableSetup;
  /** Deal from this seed (the director's, so an event can be replayed), else at random. */
  seed?: number;
  /** How long to wait for everyone (ms) before bots play for whoever isn't here yet. */
  grace?: number;
}

/** What a finished game tells the director: each seat's place (0 = first), its score when it has one of its own, and the game's report. */
export interface TableResult {
  places: number[];
  scores?: number[];
  report?: TableReport;
}

/** News from a tournament table for its director. */
export type TableNews = { kind: 'hand'; report?: TableReport } | { kind: 'over'; result: TableResult } | { kind: 'held' };

/** What the host keeps about its tournament table (in its snapshots and backups: a takeover keeps the table's place in the event). */
export interface HostEvent {
  table: EventTable;
  /** The director asked the table to stop at the end of the hand (to move players, say). */
  held: boolean;
  /** The game has ended and the director has been told. */
  over: boolean;
  /** Opened for the tournament, its seating still on its way from the director: nothing to deal yet. */
  pending?: boolean;
  /** Hands finished in this game. */
  hands?: number;
}

/** How long a table waits for everyone before bots stand in, unless the director says. */
export const EVENT_GRACE_MS = 90_000;

/**
 * The lobby's seats for a tournament table, in game-seat order. The host plays in its member's
 * seat if it has one; otherwise its device is the table's screen (the director hosting the table)
 * and sits out. Members show as away until they arrive; bots are named by their place.
 */
export function eventSeats(t: EventTable, host: { cid: string; name: string; avatar?: Avatar }): LobbySeat[] {
  const plays = t.seats.some((m) => isMember(m) && m.id === host.cid);
  const seats: LobbySeat[] = plays ? [] : [{ id: host.cid, name: host.name, avatar: host.avatar, host: true, connected: true, screen: true, out: true }];
  const used = new Set(t.seats.map((m) => m?.name));
  const names = BOT_NAMES.filter((n) => !used.has(n));
  t.seats.forEach((m, i) => {
    if (isMember(m) && m.id === host.cid) seats.push({ id: m.id, name: m.name, avatar: m.avatar ?? host.avatar, host: true, connected: true });
    else if (isMember(m)) seats.push({ id: m.id, name: m.name, avatar: m.avatar, connected: false });
    else
      seats.push({
        id: `bot:t${t.info.table}s${i}`,
        name: m?.name || names.shift() || `Bot ${i + 1}`,
        avatar: { emoji: AVATAR_EMOJI[(i * 7 + 3) % AVATAR_EMOJI.length], color: AVATAR_COLORS[(i * 3 + 1) % AVATAR_COLORS.length] },
        bot: true,
        connected: true,
      });
  });
  return seats;
}

/** A finished game's result for the director. Scores only when the game keeps one per player (a partnership's is in its places). */
export function tableResult(m: GameModule, s: GameState): TableResult {
  const totals = totalsOf(m, s);
  // (the scoreboard's rows are named: each player's own, found by name, if every player has one)
  const names = s.players.map((p) => p.name);
  const at = names.map((n) => totals?.names.indexOf(n) ?? -1);
  const own = !!totals && new Set(names).size === names.length && at.every((i) => i >= 0);
  return {
    places: standingsOf(m, s),
    ...(own ? { scores: at.map((i) => totals!.totals[i]) } : {}),
    ...(m.report ? { report: m.report(s) } : {}),
  };
}
