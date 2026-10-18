import type { OtherResult, TableChange } from '../../engine/types';
import type { Brain } from '../brain';
import { Host, type HostSnapshot } from '../host';
import type { TableTile } from '../eventProtocol';
import type { EventTable, TableNews } from '../host/event';
import type { View } from '../protocol';
import type { Transport } from '../transport';

/**
 * The director's hold on one table of a round, wherever it's hosted: on the director's own device
 * (`LocalTable`), or on a player's phone at the table (a remote table, over its host's link to
 * the director). The director seats it, may hold it or change it between hands, and hears its news.
 */
export interface TableLink {
  readonly round: number;
  readonly table: number;
  /** The room its players play in (null: none yet, or no people play there). */
  readonly room: string | null;
  seat(t: EventTable): void;
  hold(on: boolean): void;
  adjust(change: TableChange): string | null;
  /** A bot for a player who isn't here (their game seat), until they're back. */
  standInFor(seat: number): void;
  /** Duplicate teams: the other table of its match's results so far (see Host.compare; a repeat is ignored). */
  compare(others: OtherResult[]): void;
  /** News from the table (each hand, the game's end, a hold reached). */
  onNews: (news: TableNews) => void;
  /** The table as a screen shows it (null: not to hand here). */
  view(): View | null;
  /** How far it's got, for its tile (null: not heard yet). */
  progress(): TableTile | null;
  /** Nothing dealt (waiting for its players, or too few to play): as good as held. */
  idle(): boolean;
  /** Development and tests: one step of its game (see Host.step). False: nothing to do. */
  step(): boolean;
  /** For the director's own snapshot (null: hosted elsewhere, which keeps its own). */
  snapshot(): HostSnapshot | null;
  close(): void;
}

/**
 * A table hosted on the director's device: a Host of its own (the director's device its screen),
 * on a network of its own for the people who play there, or none at all when bots play every seat.
 * Restored from a snapshot: carried on after the director's reload, or taken over from a player's
 * phone that hosted it until it went quiet (its backup: see Desk.adopt).
 */
export class LocalTable implements TableLink {
  readonly host: Host;
  readonly room: string | null;
  onNews: (news: TableNews) => void = () => {};
  /** Anything changed at the table (the screens, if they're showing it). */
  onView: () => void = () => {};
  private snap: HostSnapshot | null = null;
  /**
   * Its tile, worked out once a change (undefined: due again). The screens ask for every table's
   * at every change anywhere in the event, and a poker table's names every hand shown at a showdown.
   */
  private tile: TableTile | null | undefined;

  constructor(
    readonly round: number,
    readonly table: number,
    opts: { code: string; transport?: Transport | null; brain?: Brain; restore?: HostSnapshot; still?: boolean },
  ) {
    this.room = opts.transport ? opts.code : null;
    this.host = new Host(opts.transport ?? null, opts.code, { cid: 'director', name: `Table ${table}` }, opts.restore, {
      brain: opts.brain,
      still: opts.still,
      takeover: !!opts.restore,
    });
    this.host.onTable = (n) => this.onNews(n);
    this.host.onPersist = (s) => {
      this.snap = s;
      this.tile = undefined;
      this.onView();
    };
    if (opts.restore) {
      this.host.resume();
      // (its game may have ended just before its host's phone went quiet, the result not yet heard:
      // once the director is listening)
      queueMicrotask(() => this.host.resendResult());
    }
  }

  seat(t: EventTable) {
    this.host.seatTable(t);
  }
  hold(on: boolean) {
    this.host.hold(on);
  }
  adjust(change: TableChange) {
    return this.host.adjust(change);
  }
  standInFor(seat: number) {
    this.host.standInFor(seat);
  }
  compare(others: OtherResult[]) {
    this.host.compare(others);
  }
  view() {
    return this.host.viewFor(null);
  }
  progress() {
    if (this.tile === undefined) this.tile = this.host.tile();
    return this.tile;
  }
  idle() {
    return !this.host.state;
  }
  step() {
    // (a table that's waiting for its rules or its players deals as soon as it can)
    if (!this.host.state && this.host.lobby.event) this.host.start();
    return this.host.step();
  }
  snapshot() {
    return this.snap ? structuredClone(this.snap) : null;
  }
  close() {
    this.host.close();
  }
}
