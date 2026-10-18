import type { TableRound } from '../../engine/events';
import type { OtherResult, TableChange } from '../../engine/types';
import type { EventOutMsg, TableTile } from '../eventProtocol';
import type { EventTable, TableNews } from '../host/event';
import type { View } from '../protocol';
import type { TableLink } from './tables';

/** How a remote table reaches the director's desk (see desk.ts). */
export interface RemoteDesk {
  place(t: RemoteTable): void;
  retire(t: RemoteTable): void;
}

/**
 * A table hosted on a player's phone: the director's side of its link. The desk picks which player
 * hosts it and sends everyone their move; the host's phone links back (see host/uplink.ts) and gets
 * its seating, holds and changes from here, and sends its news, progress and, featured, its view.
 */
export class RemoteTable implements TableLink {
  readonly table: number;
  onNews: (news: TableNews) => void = () => {};
  /** The table's room, and the player hosting it. */
  room: string | null = null;
  hostCid: string | null = null;
  /** Players asked to host it so far (another is asked if one never links up). */
  tried: string[] = [];
  /** Its host's link: how to reach it, in the director's room it's in (paced with the rest: see Desk.send), and its peer there. */
  link: { send: (msg: EventOutMsg) => void; peer: string } | null = null;
  seating: EventTable | null = null;
  tile: TableTile | null = null;
  live: View | null = null;
  featured = false;
  private held = false;
  /** Duplicate teams: the other table's results so far (sent again when its host links up). */
  private others: OtherResult[] = [];
  /** When it was placed (its host has a while to link up). */
  placedAt = 0;
  /** When its host's link last said anything. */
  heardAt = 0;
  /** Its latest backup, from its host (sealed: the relay holds the key), and the token that takes it over. */
  backup: { blob: string; v: number; token: string } | null = null;
  /** Being taken over by the director now; and not to be tried again before this time (see Desk.adopt). */
  adopting = false;
  tryAfter = 0;

  constructor(
    private readonly desk: RemoteDesk,
    readonly round: number,
    readonly seats: TableRound['seats'],
    table: number,
    saved?: { room: string; hostCid: string; tried: string[] },
  ) {
    this.table = table;
    if (saved) Object.assign(this, { room: saved.room, hostCid: saved.hostCid, tried: [...saved.tried] });
  }

  /** The people who play here (bots aside). */
  get members(): string[] {
    return this.seats.map((s) => s.member).filter((m): m is string => !!m);
  }

  seat(t: EventTable) {
    this.seating = t;
    // (placed already: back after the director's reload, the table carries on in its room)
    if (this.room) return this.send({ t: 'evSeat', table: t });
    this.desk.place(this);
  }

  /** Its host's phone has linked up (or again, after a reload or a takeover). */
  attach(send: (msg: EventOutMsg) => void, peer: string) {
    this.link = { send, peer };
    this.heardAt = Date.now();
    if (this.seating) this.send({ t: 'evSeat', table: this.seating });
    if (this.held) this.send({ t: 'evHold', on: true });
    if (this.featured) this.send({ t: 'evFeature', on: true });
    if (this.others.length) this.send({ t: 'evCompare', others: this.others });
  }
  detach() {
    this.link = null;
  }

  send(msg: EventOutMsg) {
    this.link?.send(msg);
  }

  hold(on: boolean) {
    this.held = on;
    this.send({ t: 'evHold', on });
  }
  adjust(change: TableChange): string | null {
    if (!this.link) return 'The table isn’t linked up';
    this.send({ t: 'evAdjust', change });
    return null;
  }
  standInFor(seat: number) {
    this.send({ t: 'evStandIn', seat });
  }
  compare(others: OtherResult[]) {
    this.others = others;
    this.send({ t: 'evCompare', others });
  }
  feature(on: boolean) {
    this.featured = on;
    if (!on) this.live = null;
    this.send({ t: 'evFeature', on });
  }
  view() {
    return this.live;
  }
  progress() {
    return this.tile;
  }
  idle() {
    return !!this.tile && !this.tile.started;
  }
  step() {
    return false;
  }
  snapshot() {
    return null;
  }
  close() {
    this.desk.retire(this);
  }
}
