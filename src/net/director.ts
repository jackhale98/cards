import {
  currentRound,
  isDuplicate,
  nextRound,
  otherTable,
  publicView,
  recordReport,
  recordResult,
  startEvent,
  type EventPublic,
  type EventState,
  type Round,
  type TableRound,
} from '../engine/events';
import type { HostSnapshot } from './host';
import type { BotSeat, EventSeat, EventTable, TableNews } from './host/event';
import { cleanReport } from './director/clean';
import type { TableLink } from './director/tables';

/**
 * The director of a tournament: it runs the event (src/engine/events), seats each round's tables,
 * hears how they went, and moves on when every table is done (after a pause for everyone to see
 * the standings, unless held). Where a table is hosted is up to `makeTable`: on this device
 * (LocalTable), or on a phone at the table.
 */

export interface DirectorSnapshot {
  event: EventState;
  /** The round's tables hosted here, as their hosts saw them. */
  tables: Record<number, HostSnapshot>;
  /** Of those, the ones people play at: the rooms they play in. */
  rooms?: Record<number, string>;
  /** Waiting between rounds by the director's choice. */
  held?: boolean;
}

export interface DirectorOptions {
  event: EventState;
  /**
   * A link to a table of round `round`: restored from its snapshot (the director coming back, or
   * taking over a table from its host's backup), and hosted here in `room` when people play there.
   */
  makeTable: (round: number, t: TableRound, o?: { restore?: HostSnapshot; room?: string }) => TableLink;
  /** The key that holds `member`'s seat at that table (each table gets only its own players' keys). */
  keyFor: (member: string, round: number, table: number) => string;
  /** The event's code, for the tables' lobbies. */
  code: string;
  /** How long between rounds before the next starts by itself (ms); null: only when the director says. */
  pause?: number | null;
  /** How long a table waits for its players before bots stand in (ms). */
  grace?: number;
  /** A round has been seated (null: the event is over), for telling those without a table. */
  onRound?: (r: Round | null) => void;
  restore?: DirectorSnapshot;
}

/** How long everyone gets to look at the standings between rounds. */
export const ROUND_PAUSE_MS = 30_000;

export class Director {
  readonly event: EventState;
  private links = new Map<number, TableLink>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private held: boolean;
  private closed = false;
  /** Something changed (for the screens, and to save the event). */
  onChange: () => void = () => {};

  constructor(private readonly o: DirectorOptions) {
    this.event = o.restore?.event ?? o.event;
    this.held = !!o.restore?.held;
  }

  /**
   * Back after a reload (or a takeover): the round's tables as they were, and the next round in a
   * while if this one's done. Once whatever makes the tables is ready (the desk, for those on
   * phones), since they're made here.
   */
  resume() {
    if (this.resumed) return;
    this.resumed = true;
    const r = currentRound(this.event);
    const saved = this.o.restore;
    if (saved && r && this.event.phase !== 'registering' && this.event.phase !== 'done')
      for (const t of r.tables) {
        const link = this.o.makeTable(r.n, t, { restore: saved.tables[t.table], room: saved.rooms?.[t.table] });
        this.listen(link, r, t);
        this.links.set(t.table, link);
        if (!saved.tables[t.table]) link.seat(this.tableFor(r, t));
      }
    if (r && this.event.phase === 'playing') for (const t of r.tables) this.share(r, t);
    if (this.event.phase === 'between') this.schedule();
  }
  private resumed = false;

  /** What the screens and phones may see. */
  get view(): EventPublic {
    return publicView(this.event);
  }

  /** The draw and the first round. False: not yet (see startProblem). */
  start(): boolean {
    const r = startEvent(this.event);
    if (!r) return false;
    this.seatRound(r);
    this.changed();
    return true;
  }

  /** On to the next round now (between rounds), or the end. */
  advance() {
    if (this.event.phase !== 'between') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const r = nextRound(this.event);
    if (r) this.seatRound(r);
    else {
      this.closeTables();
      this.o.onRound?.(null);
    }
    this.changed();
  }

  /** Hold the event between rounds (or let it go on by itself). */
  hold(on: boolean) {
    this.held = on;
    if (on && this.timer) clearTimeout(this.timer);
    if (on) this.timer = null;
    else this.schedule();
    this.changed();
  }
  get holding() {
    return this.held;
  }

  /** A table's link this round (the director's screens feature tables live). */
  link(table: number): TableLink | undefined {
    return this.links.get(table);
  }

  /**
   * A table played on a phone is hosted here from now on, from its host's backup (the phone went
   * quiet: see Desk.adopt), in the room its players are in.
   */
  hostHere(table: number, restore: HostSnapshot, room: string) {
    const r = currentRound(this.event);
    const t = r?.tables.find((x) => x.table === table);
    const was = this.links.get(table);
    if (this.closed || !r || !t || !was) return;
    const link = this.o.makeTable(r.n, t, { restore, room });
    this.listen(link, r, t);
    this.links.set(table, link);
    was.close();
    this.share(r, t);
    this.changed();
  }

  /** Development and tests: one step of the event, the same every time: the first table with something to do, then the next round. */
  step(): boolean {
    for (const link of [...this.links.values()].sort((a, b) => a.table - b.table)) if (link.step()) return true;
    if (this.event.phase === 'between') {
      this.advance();
      return true;
    }
    return false;
  }

  snapshot(): DirectorSnapshot {
    const tables: Record<number, HostSnapshot> = {};
    const rooms: Record<number, string> = {};
    for (const [n, link] of this.links) {
      const s = link.snapshot();
      if (s) tables[n] = s;
      if (s && link.room) rooms[n] = link.room;
    }
    return { event: structuredClone(this.event), tables, ...(Object.keys(rooms).length ? { rooms } : {}), ...(this.held ? { held: true } : {}) };
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.closeTables();
  }

  // ---- the round's tables --------------------------------------------------------------------

  private seatRound(r: Round) {
    // (the last round's tables close once the new ones are seated: players at them hear where to go next through them)
    const last = [...this.links.values()];
    this.links.clear();
    for (const t of r.tables) {
      const link = this.o.makeTable(r.n, t);
      this.listen(link, r, t);
      this.links.set(t.table, link);
      link.seat(this.tableFor(r, t));
    }
    for (const link of last) link.close();
    this.o.onRound?.(r);
  }

  private listen(link: TableLink, r: Round, t: TableRound) {
    link.onNews = (n) => this.news(r.n, t.table, n);
  }

  private closeTables() {
    for (const link of this.links.values()) link.close();
    this.links.clear();
  }

  /** What a table is told: its game, who sits where (each member with their seat's key), its deal. */
  private tableFor(r: Round, t: TableRound): EventTable {
    const e = this.event;
    const seats = t.seats.map((s, seat): EventSeat | BotSeat | null => {
      const x = e.entrants.find((y) => y.id === s.entrant);
      if (!x) return null;
      // (a bot entrant's seats have its names; a person's bot partner is named at the table)
      const j = e.config.sides.find((side) => side.includes(seat))?.indexOf(seat) ?? 0;
      if (!s.member) return { bot: true, name: x.bot ? (x.names?.[j] ?? x.name) : '' };
      const i = x.members.indexOf(s.member);
      return { id: s.member, name: x.names?.[i] ?? x.name, key: this.o.keyFor(s.member, r.n, t.table) };
    });
    const other = otherTable(r, t);
    // (duplicate: where these boards are compared)
    const note =
      e.config.format === 'teams' && other
        ? `Teams: your teammates play these boards at table ${other.table}`
        : e.config.format === 'pairs'
          ? 'Pairs: every table plays these boards'
          : undefined;
    return {
      info: { code: this.o.code, name: e.config.name, round: r.n, table: t.table, ...(note ? { note } : {}) },
      game: e.config.game,
      seats,
      seed: t.seed,
      ...(t.setup ? { setup: t.setup } : {}),
      ...(this.o.grace != null ? { grace: this.o.grace } : {}),
    };
  }

  /** News from a table: how it's going (each hand), or its result; the round may be done. */
  private news(round: number, table: number, n: TableNews) {
    if (this.closed) return;
    const r = currentRound(this.event);
    const t = r?.n === round ? r.tables.find((x) => x.table === table) : undefined;
    if (n.kind === 'hand') {
      const report = cleanReport(n.report);
      if (!r || !t || !report || !recordReport(this.event, round, table, report)) return;
      this.share(r, t);
      return this.changed();
    }
    if (n.kind !== 'over') return;
    const done = recordResult(this.event, round, table, n.result, cleanReport(n.result.report));
    if (done) this.schedule();
    this.changed();
  }

  /**
   * Duplicate teams: a table's results so far to the other table of its match, and theirs to it
   * (each table takes only boards it has played itself: see Host.compare).
   */
  private share(r: Round, t: TableRound) {
    const o = isDuplicate(this.event) ? otherTable(r, t) : undefined;
    if (!o) return;
    const tell = (to: TableRound, from: TableRound) => {
      const boards = from.report?.boards ?? [];
      if (boards.length) this.links.get(to.table)?.compare(boards.map((b) => ({ ...b, at: `Table ${from.table}` })));
    };
    tell(o, t);
    tell(t, o);
  }

  /** Between rounds: on by itself after the pause, unless held. */
  private schedule() {
    if (this.timer || this.held || this.event.phase !== 'between' || this.o.pause == null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, this.o.pause);
  }

  private changed() {
    if (!this.closed) this.onChange();
  }
}
