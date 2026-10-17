import { vi } from 'vitest';
import { createEvent, type EventConfig } from '../src/engine/events';
import { Client } from '../src/net/client';
import { Director } from '../src/net/director';
import { Desk } from '../src/net/director/desk';
import { Registry } from '../src/net/director/registry';
import { directorSave, type DirectorSave, type Escrow } from '../src/net/director/standby';
import { LocalTable } from '../src/net/director/tables';
import { newSecret, seatKeyFor, type SignedMove } from '../src/net/eventCrypto';
import { EventLink, isOurMove, type EventIdentity } from '../src/net/eventLink';
import { Host } from '../src/net/host';
import { Uplink } from '../src/net/host/uplink';
import { makeRoomCode, type Msg } from '../src/net/protocol';
import type { Transport } from '../src/net/transport';
import { newBackupKey } from '../src/net/backup';
import { Bus, MemTransport } from './netHarness';

/**
 * A tournament over an in-memory network, for the tests (one room per code): a director, and
 * phones doing what the app does (signing up, following each move to a table to host it or sit at
 * it, finding their table again).
 */

export const CODE = 'BCDFGH';

/** Rooms by code. A connection joins its room a moment after it's made (as a real one would). */
export class Net {
  buses = new Map<string, Bus>();
  n = 0;
  /** Every message sent: who from, who to (none: everyone in the room), and what. */
  log: { from: string; to?: string; msg: Msg }[] = [];
  directors = new Set<string>();
  open = (code: string, director = false) => {
    const bus = this.buses.get(code) ?? new Bus();
    this.buses.set(code, bus);
    const t = new MemTransport(bus, `${director ? 'd' : 'p'}${++this.n}`);
    if (director) this.directors.add(t.selfId);
    const send = t.send.bind(t);
    t.send = (msg, to) => {
      this.log.push({ from: t.selfId, to, msg });
      send(msg, to);
    };
    setTimeout(() => bus.join(t), 0);
    return t;
  };
}

/**
 * A phone, doing what the app does: sign up, then follow each move (checked) to host a table or sit
 * at one, keeping its link to the director all the while (quiet at a table). With `escrow`, a
 * table it hosts leaves its backup key with "the relay" (as the app's relay transport does).
 */
export class Phone {
  id: EventIdentity;
  link: EventLink | null;
  client: Client | null = null;
  host: Host | null = null;
  uplink: Uplink | null = null;
  at: SignedMove | null = null;
  moves: SignedMove[] = [];
  constructor(
    private net: Net,
    name: string,
    private escrow?: Escrow,
  ) {
    this.id = { code: CODE, cid: name.toLowerCase(), name, secret: newSecret() };
    this.link = new EventLink(net.open, this.id);
    this.link.onMove = (m) => this.go(m);
  }
  go(m: SignedMove) {
    if (!isOurMove(this.id, m) || (this.at && m.round < this.at.round) || (this.at && m.room === this.at.room)) return;
    this.moves.push(m);
    this.leaveTable();
    this.at = m;
    // (no table this round: wait at the event, with the director)
    if (m.table === 0) return this.findTable();
    // (at a table, a phone is a player there; its link to the director stays, quietly)
    this.link?.setQuiet(true);
    this.sit(m);
  }
  private sit(m: SignedMove) {
    const { cid, name, secret } = this.id;
    if (m.host) {
      const t = this.net.open(m.room);
      const backup = this.escrow ? { backupKey: newBackupKey(), takeoverToken: newBackupKey() } : {};
      this.host = new Host(t, m.room, { cid, name }, undefined, backup);
      if (this.escrow) this.escrow.deposit(m.room, t, backup.backupKey!, backup.takeoverToken!);
      this.host.expectTable({ code: CODE, name: 'Swiss', round: m.round, table: m.table });
      this.uplink = new Uplink(this.net.open, CODE, this.host, { cid, secret, round: m.round, table: m.table });
      this.uplink.onMove = (mv) => this.go(mv);
    } else {
      this.client = new Client(this.net.open(m.room), cid, name, undefined, false, seatKeyFor(secret, CODE, m.round, m.table));
      this.client.onMove = (mm) => mm.ev && this.go(mm.ev);
    }
  }
  /** "Find my table": back to the director, which says where (and shows the event). */
  findTable() {
    if (!this.link) {
      this.link = new EventLink(this.net.open, this.id);
      this.link.onMove = (m) => this.go(m);
    }
    this.link.setQuiet(false);
  }
  /** The phone goes to sleep: everything it had open goes quiet (as a relay sees a phone that's gone). */
  sleep() {
    this.leaveTable();
    this.link?.close();
    this.link = null;
  }
  /** …and wakes: back at its table as a player (whoever hosts it now), and linked to the director again. */
  wake() {
    const m = this.at!;
    this.link = new EventLink(this.net.open, this.id);
    this.link.onMove = (mv) => this.go(mv);
    this.link.setQuiet(m.table !== 0);
    if (m.table) this.sit({ ...m, host: false });
  }
  leaveTable() {
    this.client?.close();
    this.uplink?.close();
    this.host?.close();
    this.client = null;
    this.uplink = null;
    this.host = null;
  }
}

/**
 * A director and its desk, as the app makes them (see src/event.svelte.ts): a new tournament, or
 * one carried on from a save (`restore`: a standby taking over). `backup`: it keeps a standby's
 * copy (`save()` is what goes in it).
 */
export function director(
  net: Net,
  cfg: Partial<EventConfig> = {},
  o: { still?: boolean; backup?: { key: string; token: string; escrow: Escrow }; restore?: DirectorSave } = {},
) {
  const registry = new Registry(o.restore?.registry);
  const event =
    o.restore?.director.event ??
    createEvent(
      { name: 'Swiss', format: 'swiss', game: { id: 'gin-rummy', options: { target: 25 } }, seats: 2, sides: [[0], [1]], host: 'player', rounds: 2, ...cfg },
      11,
    );
  const backup = o.backup ?? o.restore?.backup ?? { key: '', token: '' };
  // (the director's tables are the desk's, and the desk works for the director: each made knowing the other)
  const ref: { desk?: Desk } = {};
  const d = new Director({
    event,
    code: CODE,
    pause: null,
    onRound: (r) => ref.desk!.round(r),
    keyFor: (m, round, table) => seatKeyFor(registry.secretOf(m)!, CODE, round, table),
    makeTable: (round, t, { restore, room } = {}) => {
      // (on one of its players' phones, unless the director hosts the tables, or this one now)
      const people = t.seats.some((s) => s.member);
      if (people && !room && d.event.config.host !== 'director') return ref.desk!.remote(round, t);
      const at = room ?? (people ? makeRoomCode() : null);
      const local = new LocalTable(round, t.table, {
        code: at ?? `B${round}${t.table}`,
        transport: at ? ref.desk!.tableRoom(at) : null,
        still: o.still,
        restore,
      });
      local.onView = () => ref.desk?.viewed(t.table);
      return local;
    },
    restore: o.restore?.director,
  });
  const desk = (ref.desk = new Desk({
    code: CODE,
    registry,
    director: () => d,
    open: (code) => net.open(code, true),
    saved: o.restore?.desk,
    ...(o.backup ? { backup: o.backup, takeover: { escrow: o.backup.escrow, hostKey: o.restore?.hostKey ?? 'host-key' } } : {}),
  }));
  d.onChange = () => desk.changed();
  d.resume();
  const save = () =>
    directorSave({ code: CODE, hostKey: o.restore?.hostKey ?? 'host-key', registry, director: d, desk, backup: { key: backup.key, token: backup.token } });
  return { d, desk, registry, save };
}

/** The relay's escrow, for any room (see relay/src/index.ts): a key left by its host, handed once to a takeover that brings the token, once the host has gone. */
export class FakeEscrow implements Escrow {
  rooms = new Map<string, { key: string; token: string; host: string }>();
  constructor(private net: Net) {}
  deposit(code: string, room: Transport, key: string, token: string) {
    this.rooms.set(code, { key, token, host: room.selfId });
  }
  async takeover(code: string, _newHostKey: string, token: string) {
    const r = this.rooms.get(code);
    if (!r) return { error: 'no-backup' };
    if (this.net.buses.get(code)?.members.has(r.host)) return { error: 'host-here' };
    if (r.token !== token) return { error: 'not-a-player' };
    this.rooms.delete(code);
    return { key: r.key };
  }
}

/** A real moment (the timer as it was before the tests fake them). */
const realTimeout = globalThis.setTimeout;

/**
 * Let the network settle: connections join, hellos are answered (paced), moves followed. Each step
 * waits a real moment too: sealing and opening backups (crypto, compression) finish in real time,
 * not on the fake clock.
 */
export const settle = async (ms = 3000) => {
  for (let i = 0; i < ms / 100; i++) {
    await vi.advanceTimersByTimeAsync(100);
    await new Promise((r) => realTimeout(r, 1));
  }
};

/** Play every table's game to its end, a step at a time (Host.step plays every seat, people's too), and the director's own tables (bots only). */
export async function playOut(phones: Phone[], d?: Director) {
  for (let i = 0; i < 5000; i++) {
    const hosts = phones.map((p) => p.host).filter((h): h is Host => !!h && !!h.state);
    const local = (d?.event.rounds.at(-1)?.tables ?? []).map((t) => d!.link(t.table)).filter((l): l is LocalTable => l instanceof LocalTable);
    if (!hosts.some((h) => h.step()) && !local.some((l) => l.step())) break;
  }
  await settle(500);
}
