import type { TableChange } from '../../engine/types';
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
  seat(t: EventTable): void;
  hold(on: boolean): void;
  adjust(change: TableChange): string | null;
  /** A bot for a player who isn't here (their game seat), until they're back. */
  standInFor(seat: number): void;
  /** News from the table (each hand, the game's end, a hold reached). */
  onNews: (news: TableNews) => void;
  /** The table as a screen shows it (null: not to hand here). */
  view(): View | null;
  /** How far it's got, for its tile (null: not heard yet). */
  progress(): TableTile | null;
  /** Development and tests: one step of its game (see Host.step). False: nothing to do. */
  step(): boolean;
  /** For the director's own snapshot (null: hosted elsewhere, which keeps its own). */
  snapshot(): HostSnapshot | null;
  close(): void;
}

/**
 * A table hosted on the director's device: a Host of its own (the director's device its screen),
 * on a network of its own for the people who play there, or none at all when bots play every seat.
 */
export class LocalTable implements TableLink {
  readonly host: Host;
  onNews: (news: TableNews) => void = () => {};
  /** Anything changed at the table (the screens, if they're showing it). */
  onView: () => void = () => {};
  private snap: HostSnapshot | null = null;

  constructor(
    readonly round: number,
    readonly table: number,
    opts: { code: string; transport?: Transport | null; brain?: Brain; restore?: HostSnapshot; still?: boolean },
  ) {
    this.host = new Host(opts.transport ?? null, opts.code, { cid: 'director', name: `Table ${table}` }, opts.restore, {
      brain: opts.brain,
      still: opts.still,
    });
    this.host.onTable = (n) => this.onNews(n);
    this.host.onPersist = (s) => {
      this.snap = s;
      this.onView();
    };
    if (opts.restore) this.host.resume();
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
  view() {
    return this.host.viewFor(null);
  }
  progress() {
    return this.host.tile();
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
