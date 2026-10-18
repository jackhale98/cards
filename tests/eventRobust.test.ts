import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBackupKey } from '../src/net/backup';
import { Pacer, SENDS_PER_SECOND } from '../src/net/director/pacer';
import { RemoteTable } from '../src/net/director/remote';
import type { EventOutMsg } from '../src/net/eventProtocol';
import { LocalTable } from '../src/net/director/tables';
import { sealSave, takeOver, type DirectorSave } from '../src/net/director/standby';
import { CODE, director, FakeEscrow, Net, Phone, playOut, settle } from './eventHarness';
import { MemTransport } from './netHarness';
import './games';

/**
 * A tournament that keeps going when phones don't: a phone at a table keeps a quiet line to the
 * director, so its next move never depends on the table's host; and a table whose host's phone
 * goes quiet (asleep in a pocket, a flat battery) moves to the director, which hosts it from the
 * backup the host kept sending it, and the game goes on.
 */

describe('a tournament that keeps going when phones don’t', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a phone at a table keeps a quiet line to the director: its next move comes straight, though its table’s host has gone', async () => {
    const net = new Net();
    const { d, desk } = director(net, { rounds: 2 });
    const phones = ['Ann', 'Bo', 'Cy', 'Di'].map((n) => new Phone(net, n));
    await settle();
    expect(desk.start()).toBeNull();
    await settle();
    // at their tables, every phone is still linked to the director (quietly: no board while they play)
    expect(phones.every((p) => p.link && (p.host || p.client))).toBe(true);
    expect(phones.every((p) => desk.online(p.id.cid))).toBe(true);
    const boards = (cid: string) =>
      net.log.filter((x) => (x.msg.t === 'evBoard' || x.msg.t === 'evBoardPatch') && x.to === phones.find((p) => p.id.cid === cid)?.link?.selfId).length;
    const before = boards('bo');
    await playOut(phones);
    expect(boards('bo')).toBe(before);
    // the hosts' phones go quiet before the next round is drawn: nothing can pass the moves on
    const hosts = phones.filter((p) => p.host);
    for (const h of hosts) h.sleep();
    await settle(500);
    d.advance();
    await settle();
    for (const p of phones.filter((x) => !hosts.includes(x))) expect(p.at?.round).toBe(2);
    phones.forEach((p) => p.leaveTable());
    desk.close();
  });

  it('a phone waiting out a round hears only what it shows (the event, not the tables’ progress), and only when that changes', async () => {
    const net = new Net();
    const { d, desk } = director(net, { rounds: 1 });
    const phones = ['Ann', 'Bo', 'Cy'].map((n) => new Phone(net, n));
    await settle();
    expect(desk.start()).toBeNull();
    await settle();
    const bye = phones.find((p) => p.at?.table === 0)!;
    const host = phones.find((p) => p.host)!;
    // (a table shown live on the screens)
    desk.feature(1);
    const boards = () =>
      net.log.filter((x) => (x.msg.t === 'evBoard' || x.msg.t === 'evBoardPatch') && x.to === bye.link?.selfId).map((x) => x.msg as EventOutMsg);
    const before = boards().length;
    expect(before).toBeGreaterThan(0);
    // the table plays on (its tile changes, and the screens' live view): nothing the waiting phone shows
    for (let i = 0; i < 12; i++) {
      host.host!.step();
      await settle(600);
    }
    expect(d.link(1)!.progress()?.started).toBe(true);
    expect(boards()).toHaveLength(before);
    // its result: the standings change, and the phone hears it
    await playOut(phones);
    expect(boards().length).toBeGreaterThan(before);
    // (whole, or what's changed: never a table's progress or a table live)
    expect(
      boards().every((b) =>
        b.t === 'evBoard' ? !b.live && !b.tiles : b.t === 'evBoardPatch' && b.ops.every((op) => op[1][0] !== 'live' && op[1][0] !== 'tiles'),
      ),
    ).toBe(true);
    expect(bye.link!.board).toMatchObject({ live: null, tiles: [] });
    phones.forEach((p) => p.leaveTable());
    desk.close();
  });

  it('a waiting phone hears what’s changed on the board, not the whole of it each time, and the whole board again if it missed some', async () => {
    const net = new Net();
    const { desk, registry } = director(net);
    const phones = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal', 'Ivy'].map((n) => new Phone(net, n));
    await settle();
    const ann = phones[0];
    const toAnn = (t: string) => net.log.filter((x) => x.msg.t === t && x.to === ann.link?.selfId).map((x) => x.msg);
    const whole = toAnn('evBoard').length;
    // one more signs up: Ann hears who, as a change to the board she has
    phones.push(new Phone(net, 'Jo'));
    await settle();
    const patches = toAnn('evBoardPatch');
    expect(patches.length).toBeGreaterThan(0);
    expect(toAnn('evBoard')).toHaveLength(whole);
    expect(Math.max(...patches.map((m) => JSON.stringify(m).length))).toBeLessThan(JSON.stringify(ann.link!.board).length / 4);
    const people = () => JSON.parse(JSON.stringify(registry.people()));
    expect(ann.link!.board!.people).toEqual(people());
    // a board lost on the way: the next change doesn't fit what she has, so she asks for the whole board again
    (ann.link as unknown as { got: { v: number } }).got.v -= 1;
    registry.addBot();
    desk.changed();
    await settle();
    expect(net.log.filter((x) => x.msg.t === 'evResync')).toHaveLength(1);
    expect(toAnn('evBoard')).toHaveLength(whole + 1);
    expect(ann.link!.board!.people).toEqual(people());
    phones.forEach((p) => p.leaveTable());
    desk.close();
  });

  it('the director never sends more a second on a connection than the relay passes on: the rest wait their turn, in order', async () => {
    const sent: { at: number; n: number }[] = [];
    const t = { send: (msg: { n: number }) => sent.push({ at: Date.now(), n: msg.n }) } as unknown as MemTransport;
    const out = new Pacer(t);
    // (a round's moves and everyone's places, all at once, then a straggler a moment later)
    for (let n = 0; n < SENDS_PER_SECOND * 2 + 50; n++) out.send({ t: 'evAlive', n } as never, 'p');
    await vi.advanceTimersByTimeAsync(300);
    out.send({ t: 'evAlive', n: 999 } as never, 'p');
    expect(sent).toHaveLength(SENDS_PER_SECOND);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent.map((x) => x.n)).toEqual([...Array.from({ length: SENDS_PER_SECOND * 2 + 50 }, (_, i) => i), 999]);
    // (in any second, never more than the rate)
    for (const x of sent) expect(sent.filter((y) => y.at >= x.at && y.at < x.at + 1000).length).toBeLessThanOrEqual(SENDS_PER_SECOND);
    out.close();
  });

  /** One table, its game a few moves in, hosted on a phone whose table backups go to "the relay" (and the director). */
  async function oneTable() {
    const net = new Net();
    const escrow = new FakeEscrow(net);
    const backup = { key: newBackupKey(), token: newBackupKey() };
    const first = director(net, { rounds: 1 }, { backup: { ...backup, escrow } });
    const phones = ['Ann', 'Bo'].map((n) => new Phone(net, n, escrow));
    await settle();
    expect(first.desk.start()).toBeNull();
    await settle();
    const host = phones.find((p) => p.host)!;
    const other = phones.find((p) => p !== host)!;
    for (let i = 0; i < 6; i++) host.host!.step();
    await settle(3000);
    return { net, escrow, backup, ...first, first, phones, host, other };
  }

  it('a table whose host goes quiet moves to the director, which hosts it from the host’s backup; the game goes on, and the host is back as a player', async () => {
    const { d, desk, host, other, phones } = await oneTable();
    // (the director holds the table's latest backup, sealed)
    const held = (d.link(1) as RemoteTable).backup!;
    expect(held.blob).toMatch(/^z\./);
    expect(held.v).toBeGreaterThan(0);
    expect(desk.tiles().get(1)?.off).toEqual([]);
    // the host's phone goes to sleep: the director's screen says so
    host.sleep();
    await settle(5000);
    expect(desk.tiles().get(1)?.off).toEqual([host.id.name]);
    await settle(55_000);
    // the director hosts it now, from where the host left off
    const link = d.link(1);
    expect(link).toBeInstanceOf(LocalTable);
    const adopted = (link as LocalTable).host;
    expect(adopted.state!.v).toBeGreaterThan(held.v);
    expect(adopted.lobby.seats.find((s) => s.id === host.id.cid)?.host).toBeFalsy();
    // the other player is with the new host, and the host's phone wakes up to sit at its table again
    expect(other.client?.connected).toBe(true);
    host.wake();
    await settle(15_000);
    expect(host.client?.connected).toBe(true);
    // and the game is played out, its result counted
    expect(desk.tiles().get(1)?.off).toEqual([]);
    for (let i = 0; i < 3000 && adopted.step(); i++);
    await settle(1000);
    expect(d.event.rounds[0].tables[0].result).toBeTruthy();
    phones.forEach((p) => p.leaveTable());
    desk.close();
  });

  it('a table whose host is still hosting stays with them (in its room), though their link to the director has dropped', async () => {
    const { d, desk, host, other, phones } = await oneTable();
    host.uplink!.close();
    await settle(90_000);
    expect(d.link(1)).toBeInstanceOf(RemoteTable);
    expect(other.moves).toHaveLength(1);
    expect(other.client?.connected).toBe(true);
    phones.forEach((p) => p.leaveTable());
    desk.close();
  });

  it('the director can host every table itself: everyone is sent to its tables’ rooms, plays there, and the round is done', async () => {
    const net = new Net();
    const { d, desk } = director(net, { rounds: 1, host: 'director' });
    const phones = ['Ann', 'Bo', 'Cy', 'Di'].map((n) => new Phone(net, n));
    await settle();
    expect(desk.start()).toBeNull();
    await settle();
    const tables = d.event.rounds[0].tables.map((t) => d.link(t.table)!);
    expect(tables.every((t) => t instanceof LocalTable && t.room)).toBe(true);
    // nobody hosts: each phone sits at its table, in the room hosted here
    for (const p of phones) {
      const at = d.event.rounds[0].tables.find((t) => t.seats.some((s) => s.member === p.id.cid))!;
      expect(p.at).toMatchObject({ table: at.table, room: d.link(at.table)!.room, host: false });
      expect(p.host).toBeNull();
      expect(p.client?.connected).toBe(true);
    }
    for (const t of tables) for (let i = 0; i < 3000 && (t as LocalTable).host.step(); i++);
    await settle(1000);
    expect(d.event.phase).toBe('between');
    phones.forEach((p) => p.leaveTable());
    desk.close();
  });

  it('a standby taking over carries on hosting the tables the director took over', async () => {
    const { net, escrow, backup, first, host, other, phones } = await oneTable();
    host.sleep();
    await settle(60_000);
    expect(first.d.link(1)).toBeInstanceOf(LocalTable);
    const room = first.d.link(1)!.room!;
    const copy = await sealSave(first.save());
    expect(first.save().director.rooms).toEqual({ 1: room });
    // the director's device stops; a standby takes over, the table's room too
    first.desk.close();
    first.d.close();
    await settle(500);
    const save = await takeOver({ code: CODE, blob: copy, token: backup.token, escrow, hostKey: 'new-host' });
    const second = director(net, { rounds: 1 }, { restore: save as DirectorSave });
    await settle(6000);
    const link = second.d.link(1);
    expect(link).toBeInstanceOf(LocalTable);
    expect(link!.room).toBe(room);
    expect(other.client?.connected).toBe(true);
    for (let i = 0; i < 3000 && (link as LocalTable).host.step(); i++);
    await settle(1000);
    expect(second.d.event.phase).toBe('between');
    phones.forEach((p) => p.leaveTable());
    second.desk.close();
  });
});
