import { describe, expect, it, vi } from 'vitest';
import { newBackupKey, open, seal } from '../src/net/backup';
import { Client } from '../src/net/client';
import { Host } from '../src/net/host';
import type { Msg } from '../src/net/protocol';
import type { Transport } from '../src/net/transport';

/** In-memory room (as in net.test.ts): delivers messages between transports, JSON-cloned like the wire. */
class Bus {
  members = new Map<string, MemTransport>();
  join(t: MemTransport) {
    const others = [...this.members.values()];
    this.members.set(t.selfId, t);
    for (const other of others) {
      other.onPeerJoin(t.selfId);
      t.onPeerJoin(other.selfId);
    }
  }
  leave(t: MemTransport) {
    this.members.delete(t.selfId);
    for (const other of this.members.values()) other.onPeerLeave(t.selfId);
  }
}

class MemTransport implements Transport {
  kind = 'memory';
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  constructor(
    private bus: Bus,
    readonly selfId: string,
  ) {}
  send(msg: Msg, to?: string) {
    const wire = JSON.parse(JSON.stringify(msg));
    for (const m of this.bus.members.values()) if (m !== this && (!to || to === m.selfId)) m.onMessage(wire, this.selfId);
  }
  leave() {
    this.bus.leave(this);
  }
}

const look = { emoji: '🦊', color: '#e9c46a' };

describe('backups', () => {
  it('seal and open a snapshot; the wrong key opens nothing', async () => {
    const key = newBackupKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const snap = { lobby: { code: 'ABCDE', seats: [], gameId: 'hearts', options: {}, spectators: 0, started: false }, state: null };
    const blob = await seal(snap as never, key);
    expect(blob).not.toContain('hearts');
    expect(await open(blob, key)).toEqual(snap);
    await expect(open(blob, newBackupKey())).rejects.toThrow();
  });
});

describe('host handoff', () => {
  it('a player takes over a game in progress: same cards, same seats, and the old host can come back', async () => {
    const bus = new Bus();
    const key = newBackupKey();
    const ht = new MemTransport(bus, 'host-peer');
    const host = new Host(ht, 'HNDFF', { cid: 'h', name: 'Hana', avatar: look }, undefined, { backupKey: key });
    bus.join(ht);
    const join = (cid: string, name: string) => {
      const t = new MemTransport(bus, `${cid}-peer-${Math.random()}`);
      const c = new Client(t, cid, name, look);
      bus.join(t);
      return { c, t };
    };
    const ann = join('a', 'Ann');
    const ben = join('b', 'Ben');
    host.setGame('hearts');
    host.addBot();
    host.start();
    expect(host.lobby.seats.map((s) => s.name)).toEqual(['Hana', 'Ann', 'Ben', expect.any(String)]);
    const before = structuredClone(host.state!);

    // players are sent a sealed backup (not the table screen, not bots); it reveals nothing
    await vi.waitFor(() => expect(ann.c.backup).not.toBeNull(), { timeout: 5000 });
    const blob = ann.c.backup!.blob;
    for (const z of Object.values(before.zones)) for (const c of z.cards) expect(blob).not.toContain(`"${c.id}"`);

    // the host's phone dies
    host.close();
    await vi.waitFor(() => expect(ben.c.connected).toBe(false), { timeout: 15_000 });

    // Ann takes over with the key the relay releases
    const snap = await open(blob, key);
    ann.c.close();
    const at = new MemTransport(bus, 'ann-host-peer');
    const next = new Host(at, 'HNDFF', { cid: 'a', name: 'Ann', avatar: look }, snap, { backupKey: newBackupKey(), takeover: true });
    bus.join(at);
    next.resume();
    expect(next.lobby.seats.map((s) => [s.name, !!s.host])).toEqual([
      ['Hana', false],
      ['Ann', true],
      ['Ben', false],
      [expect.any(String), false],
    ]);
    expect(next.lobby.seats[0].connected).toBe(false);
    // the game carries on exactly where it was
    expect(next.state!.zones).toEqual(before.zones);

    // Ben finds the new host and plays on from his own seat
    await vi.waitFor(() => expect(ben.c.connected).toBe(true), { timeout: 5000 });
    expect(ben.c.view!.you).toBe(2);
    const cards = before.zones['hand:2'].cards.slice(0, 3).map((c) => c.id);
    ben.c.act({ type: 'pass', cards });
    expect((next.state!.data as { passes: string[][] }).passes[2]).toEqual(cards);

    // Hana comes back as a player, into her own seat
    const hana = join('h', 'Hana');
    await vi.waitFor(() => expect(hana.c.view?.you).toBe(0), { timeout: 5000 });
    expect(next.lobby.seats[0].connected).toBe(true);
    next.close();
    ben.c.close();
    hana.c.close();
  }, 30_000);
});
