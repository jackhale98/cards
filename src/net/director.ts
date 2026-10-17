import {
  currentRound,
  nextRound,
  publicView,
  recordResult,
  startEvent,
  type EventPublic,
  type EventState,
  type Round,
  type TableRound,
} from '../engine/events';
import type { HostSnapshot } from './host';
import type { BotSeat, EventSeat, EventTable, TableNews } from './host/event';
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
  /** Waiting between rounds by the director's choice. */
  held?: boolean;
}

export interface DirectorOptions {
  event: EventState;
  /** A link to a table of round `round` (restored from its snapshot, when the director is coming back). */
  makeTable: (round: number, t: TableRound, restore?: HostSnapshot) => TableLink;
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
        const link = this.o.makeTable(r.n, t, saved.tables[t.table]);
        this.listen(link, r, t);
        this.links.set(t.table, link);
        if (!saved.tables[t.table]) link.seat(this.tableFor(r, t));
      }
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
    for (const [n, link] of this.links) {
      const s = link.snapshot();
      if (s) tables[n] = s;
    }
    return { event: structuredClone(this.event), tables, ...(this.held ? { held: true } : {}) };
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
    return {
      info: { code: this.o.code, name: e.config.name, round: r.n, table: t.table },
      game: e.config.game,
      seats,
      seed: t.seed,
      ...(t.setup ? { setup: t.setup } : {}),
      ...(this.o.grace != null ? { grace: this.o.grace } : {}),
    };
  }

  /** News from a table: its result goes in; the round may be done. */
  private news(round: number, table: number, n: TableNews) {
    if (this.closed || n.kind !== 'over') return;
    const done = recordResult(this.event, round, table, n.result, n.result.report);
    if (done) this.schedule();
    this.changed();
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
