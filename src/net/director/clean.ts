import { isEventCode, isValidCode, cleanAvatar } from '../protocol';
import type { SignedMove } from '../eventCrypto';
import type { BotSeat, EventSeat, EventTable } from '../host/event';
import type { Board, OtherResult, TableSetup } from '../../engine/types';
import { TABLE_MAX } from '../host/limits';

/**
 * Checks on a tournament's messages from the network (treat every message as hostile): the right
 * kinds of things, of sensible sizes, or nothing.
 */

const int = (x: unknown, min: number, max: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

export function cleanMove(m: unknown): SignedMove | null {
  if (!m || typeof m !== 'object') return null;
  const x = m as Record<string, unknown>;
  if (typeof x.event !== 'string' || !isEventCode(x.event) || typeof x.room !== 'string') return null;
  if (!int(x.round, 1, 999) || !int(x.table, 0, 999) || typeof x.host !== 'boolean' || !text(x.sig, 64)) return null;
  // (table 0: no table this round, wait at the event: its room is the event's own)
  if (x.table === 0 ? x.room !== x.event || x.host : !isValidCode(x.room)) return null;
  return { event: x.event, round: x.round, table: x.table, room: x.room, host: x.host, sig: x.sig };
}

/** A board's cards: a standard pack's (duplicate bridge). */
const CARD = /^[2-9TJQKA][CDHS]$/;
function cleanSetup(s: unknown): TableSetup | undefined | null {
  if (s === undefined) return undefined;
  if (!s || typeof s !== 'object') return null;
  const x = s as Record<string, unknown>;
  const out: TableSetup = {};
  if (x.boards !== undefined) {
    if (!Array.isArray(x.boards) || x.boards.length > 64) return null;
    const boards: Board[] = [];
    for (const b of x.boards) {
      if (!b || !int(b.n, 1, 999) || !Array.isArray(b.hands) || b.hands.length !== 4) return null;
      if (!b.hands.every((h: unknown) => Array.isArray(h) && h.length <= 13 && h.every((c) => typeof c === 'string' && CARD.test(c)))) return null;
      boards.push({ n: b.n, hands: b.hands.map((h: string[]) => [...h]) });
    }
    out.boards = boards;
  }
  if (x.compared === true) out.compared = true;
  if (x.chips !== undefined) {
    if (!Array.isArray(x.chips) || x.chips.length > TABLE_MAX || !x.chips.every((c) => int(c, 0, 1e9))) return null;
    out.chips = [...x.chips];
  }
  if (x.button !== undefined) {
    if (!int(x.button, 0, TABLE_MAX)) return null;
    out.button = x.button;
  }
  if (x.blinds !== undefined) {
    const b = x.blinds as Record<string, unknown>;
    if (!b || !int(b.sb, 0, 1e9) || !int(b.bb, 1, 1e9) || (b.ante !== undefined && !int(b.ante, 0, 1e9))) return null;
    out.blinds = { sb: b.sb, bb: b.bb, ...(b.ante !== undefined ? { ante: b.ante as number } : {}) };
  }
  return out;
}

/** Other tables' results on a duplicate table's boards (see Host.compare), checked: the sensible ones. */
export function cleanOthers(list: unknown): OtherResult[] {
  if (!Array.isArray(list)) return [];
  const out: OtherResult[] = [];
  for (const r of list.slice(0, 256)) {
    if (!r || typeof r !== 'object' || !int(r.n, 1, 999) || !int(r.ns, -10_000, 10_000) || !text(r.at, 24)) continue;
    const passed = r.contract === null && r.declarer === null && r.tricks === null;
    if (!passed && !(typeof r.contract === 'string' && /^[1-7](NT|S|H|D|C)X{0,2}$/.test(r.contract) && int(r.declarer, 0, 3) && int(r.tricks, 0, 13))) continue;
    out.push({ n: r.n, contract: r.contract, declarer: r.declarer, tricks: r.tricks, ns: r.ns, at: r.at });
  }
  return out;
}

/** A table's seating from the director, checked (the host seats nobody on a malformed one). */
export function cleanEventTable(t: unknown): EventTable | null {
  if (!t || typeof t !== 'object') return null;
  const x = t as Record<string, unknown>;
  const info = x.info as Record<string, unknown> | undefined;
  if (!info || typeof info.code !== 'string' || !isEventCode(info.code) || !text(info.name, 60) || !int(info.round, 1, 999) || !int(info.table, 1, 999))
    return null;
  const game = x.game as Record<string, unknown> | undefined;
  if (!game || !text(game.id, 40) || !game.options || typeof game.options !== 'object') return null;
  if (!Array.isArray(x.seats) || !x.seats.length || x.seats.length > TABLE_MAX) return null;
  const seats: (EventSeat | BotSeat | null)[] = [];
  for (const s of x.seats as unknown[]) {
    if (s === null) seats.push(null);
    else if (s && typeof s === 'object' && (s as BotSeat).bot === true && typeof (s as BotSeat).name === 'string' && (s as BotSeat).name.length <= 40)
      seats.push({ bot: true, name: (s as BotSeat).name });
    else if (s && typeof s === 'object' && text((s as EventSeat).id, 64) && text((s as EventSeat).name, 40) && text((s as EventSeat).key, 128)) {
      const m = s as EventSeat;
      const avatar = cleanAvatar(m.avatar);
      seats.push({ id: m.id, name: m.name, key: m.key, ...(avatar ? { avatar } : {}) });
    } else return null;
  }
  const setup = cleanSetup(x.setup);
  if (setup === null) return null;
  return {
    info: { code: info.code, name: info.name, round: info.round, table: info.table, ...(text(info.note, 120) ? { note: info.note } : {}) },
    game: { id: game.id, options: { ...(game.options as Record<string, number | boolean>) } },
    seats,
    ...(setup ? { setup } : {}),
    ...(int(x.seed, 0, 2 ** 32) ? { seed: x.seed } : {}),
    ...(int(x.grace, 0, 30 * 60_000) ? { grace: x.grace } : {}),
  };
}
