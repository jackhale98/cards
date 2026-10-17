import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBackupKey } from '../src/net/backup';
import { RemoteTable } from '../src/net/director/remote';
import { LocalTable } from '../src/net/director/tables';
import { sealSave, takeOver, type DirectorSave } from '../src/net/director/standby';
import { CODE, director, FakeEscrow, Net, Phone, playOut, settle } from './eventHarness';
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
    const boards = (cid: string) => net.log.filter((x) => x.msg.t === 'evBoard' && x.to === phones.find((p) => p.id.cid === cid)?.link?.selfId).length;
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
