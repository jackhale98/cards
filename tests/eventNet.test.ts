import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, standings, type EventConfig } from '../src/engine/events';
import { Client } from '../src/net/client';
import { Director } from '../src/net/director';
import { Desk, ROOM_PEERS } from '../src/net/director/desk';
import { Registry } from '../src/net/director/registry';
import { LocalTable } from '../src/net/director/tables';
import { newSecret, prove, seatKeyFor, signMove, type SignedMove } from '../src/net/eventCrypto';
import { EVENT_PROTOCOL } from '../src/net/eventProtocol';
import { EventLink, isOurMove, type EventIdentity } from '../src/net/eventLink';
import { Host, type HostSnapshot } from '../src/net/host';
import { Uplink } from '../src/net/host/uplink';
import type { Msg } from '../src/net/protocol';
import { Bus, MemTransport } from './netHarness';
import './games';

/**
 * A tournament over the network (in memory: one room per code): phones sign up with the director,
 * follow their moves to tables hosted by one of their players, and on to the next round; the
 * tables link back, report, and pass moves on. Every move is checked with its player's secret.
 */

const CODE = 'BCDFGH';

/** Rooms by code. A connection joins its room a moment after it's made (as a real one would). */
class Net {
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

/** A phone, doing what the app does: sign up, then follow each move (checked) to host a table or sit at one. */
class Phone {
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
  ) {
    this.id = { code: CODE, cid: name.toLowerCase(), name, secret: newSecret() };
    this.link = new EventLink(net.open, this.id);
    this.link.onMove = (m) => this.go(m);
  }
  go(m: SignedMove) {
    if (!isOurMove(this.id, m) || (this.at && m.round < this.at.round) || (this.at && m.room === this.at.room)) return;
    this.moves.push(m);
    this.leaveTable();
    // (at a table, a phone is only a player there: its next move comes through the table's host)
    this.link?.close();
    this.link = null;
    this.at = m;
    const { cid, name, secret } = this.id;
    if (m.host) {
      this.host = new Host(this.net.open(m.room), m.room, { cid, name });
      this.host.expectTable({ code: CODE, name: 'Swiss', round: m.round, table: m.table });
      this.uplink = new Uplink(this.net.open, CODE, this.host, { cid, secret, round: m.round, table: m.table });
      this.uplink.onMove = (mv) => this.go(mv);
    } else {
      this.client = new Client(this.net.open(m.room), cid, name, undefined, false, seatKeyFor(secret, CODE, m.round, m.table));
      this.client.onMove = (mm) => mm.ev && this.go(mm.ev);
    }
  }
  /** "Find my table": back to the director, which says where. */
  findTable() {
    this.link?.close();
    this.link = new EventLink(this.net.open, this.id);
    this.link.onMove = (m) => this.go(m);
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

function director(net: Net, cfg: Partial<EventConfig> = {}) {
  const registry = new Registry();
  const event = createEvent(
    { name: 'Swiss', format: 'swiss', game: { id: 'gin-rummy', options: { target: 25 } }, seats: 2, sides: [[0], [1]], host: 'player', rounds: 2, ...cfg },
    11,
  );
  // (the director's tables are the desk's, and the desk works for the director: each made knowing the other)
  const ref: { desk?: Desk } = {};
  const d = new Director({
    event,
    code: CODE,
    pause: null,
    keyFor: (m, round, table) => seatKeyFor(registry.secretOf(m)!, CODE, round, table),
    makeTable: (round, t) => (t.seats.some((s) => s.member) ? ref.desk!.remote(round, t) : new LocalTable(round, t.table, { code: `B${round}${t.table}` })),
  });
  const desk = (ref.desk = new Desk({ code: CODE, registry, director: () => d, open: (code) => net.open(code, true) }));
  d.onChange = () => desk.changed();
  return { d, desk, registry };
}

/** Let the network settle: connections join, hellos are answered (paced), moves followed. */
const settle = async (ms = 3000) => {
  for (let i = 0; i < ms / 100; i++) await vi.advanceTimersByTimeAsync(100);
};

/** Play every table's game to its end, a step at a time (Host.step plays every seat, people's too). */
async function playOut(phones: Phone[]) {
  for (let i = 0; i < 5000; i++) {
    const hosts = phones.map((p) => p.host).filter((h): h is Host => !!h && !!h.state);
    if (!hosts.some((h) => h.step())) break;
  }
  await settle(500);
}

describe('a tournament over the network', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('phones sign up, follow their moves to tables a player hosts, play, and move on to the next round', async () => {
    const net = new Net();
    const { d, desk, registry } = director(net);
    const phones = ['Ann', 'Bo', 'Cy', 'Di'].map((n) => new Phone(net, n));
    await settle();
    expect(
      registry
        .people()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Ann', 'Bo', 'Cy', 'Di']);
    expect(phones.every((p) => p.link!.you)).toBe(true);
    expect(desk.start()).toBeNull();
    await settle();
    // round 1: two tables, each hosted by one of its players, everyone seated
    const hosting = phones.filter((p) => p.host);
    expect(hosting).toHaveLength(2);
    for (const h of hosting) {
      expect(h.host!.lobby.event?.round).toBe(1);
      expect(h.host!.state).not.toBeNull();
      expect(h.host!.lobby.seats.filter((s) => !s.out).every((s) => s.connected)).toBe(true);
    }
    await playOut(phones);
    expect(d.event.phase).toBe('between');
    expect(d.event.rounds[0].tables.every((t) => t.result)).toBe(true);
    // round 2: everyone hears where to go through the host of the table they're at
    expect(phones.every((p) => !p.link)).toBe(true);
    d.advance();
    await settle();
    expect(phones.every((p) => p.at?.round === 2)).toBe(true);
    expect(phones.filter((p) => p.host)).toHaveLength(2);
    await playOut(phones);
    expect(d.event.phase).toBe('between');
    d.advance();
    expect(d.event.phase).toBe('done');
    expect(standings(d.event)).toHaveLength(4);
    desk.close();
    phones.forEach((p) => p.leaveTable());
  });

  it('on a network that can’t vouch for the director, a phone’s secret goes to the director alone', async () => {
    const net = new Net();
    const { desk, registry } = director(net);
    const phones = ['Ann', 'Bo', 'Cy'].map((n) => new Phone(net, n));
    await settle();
    expect(registry.people()).toHaveLength(3);
    const secrets = phones.map((p) => p.id.secret);
    for (const { to, msg } of net.log) {
      const text = JSON.stringify(msg);
      if (secrets.some((s) => text.includes(s))) expect(to && net.directors.has(to)).toBe(true);
    }
    desk.close();
    phones.forEach((p) => p.link?.close());
  });

  it('a move is checked: one forged, redirected or meant for someone else is ignored', async () => {
    const net = new Net();
    const p = new Phone(net, 'Ann');
    const real = signMove(p.id.secret, { event: CODE, round: 1, table: 1, room: 'KLMNP', host: false });
    p.go({ ...real, room: 'QRSTV' });
    p.go(signMove(newSecret(), { event: CODE, round: 1, table: 1, room: 'KLMNP', host: true }));
    p.go({ ...real, event: 'BCDFGJ' });
    expect(p.moves).toEqual([]);
    p.go(real);
    expect(p.moves).toEqual([real]);
    p.leaveTable();
    p.link?.close();
  });

  it('only the phone that signed up gets back in; a table links up only for one of its own players', async () => {
    const net = new Net();
    const { desk, registry } = director(net);
    new Phone(net, 'Ann');
    new Phone(net, 'Bo');
    await settle();
    // someone else, with Ann's (public) id but not her secret
    const t = net.open(CODE);
    const got: Msg[] = [];
    t.onMessage = (m) => {
      got.push(m);
      if ((m as { t: string }).t === 'evChallenge') t.send({ t: 'evProve', mac: prove(newSecret(), (m as { n: string }).n, 'me') });
    };
    await settle(100);
    t.send({ t: 'evBack', v: EVENT_PROTOCOL, cid: 'ann' });
    await settle(100);
    expect(got.map((m) => (m as { t: string }).t)).toContain('evRefused');
    expect(got.map((m) => (m as { t: string }).t)).not.toContain('evWelcome');
    // signing up again with another secret: refused too
    t.send({ t: 'evJoin', v: EVENT_PROTOCOL, cid: 'ann', name: 'Ann', secret: newSecret() });
    await settle(100);
    expect(got.filter((m) => (m as { t: string }).t === 'evRefused')).toHaveLength(2);
    // an older app: asked to reload
    t.send({ t: 'evScreen', v: EVENT_PROTOCOL + 1 });
    await settle(100);
    expect(got.at(-1)).toMatchObject({ t: 'evRefused', reload: true });
    // Bo can't link up as the host of a table he isn't at
    desk.start();
    await settle();
    const bo = registry.secretOf('bo')!;
    const tables = (desk as unknown as { remotes: Map<number, { members: string[] }> }).remotes;
    const other = [...tables].find(([, x]) => !x.members.includes('bo'));
    if (other) {
      const u = net.open(CODE);
      const said: Msg[] = [];
      u.onMessage = (m) => {
        said.push(m);
        if ((m as { t: string }).t === 'evChallenge') u.send({ t: 'evProve', mac: prove(bo, (m as { n: string }).n, 'table', 1, other[0]) });
      };
      await settle(100);
      u.send({ t: 'evLink', v: EVENT_PROTOCOL, cid: 'bo', round: 1, table: other[0] });
      await settle(100);
      expect(said.at(-1)).toMatchObject({ t: 'evRefused' });
    }
    desk.close();
  });

  it('a result is sent again until the director has it, and counted once', async () => {
    const net = new Net();
    const { d, desk } = director(net, { rounds: 1 });
    const phones = ['Ann', 'Bo'].map((n) => new Phone(net, n));
    await settle();
    desk.start();
    await settle();
    const h = phones.find((p) => p.host)!;
    // the link to the director drops, and the game ends meanwhile
    const uplink = h.uplink as unknown as { transport: MemTransport };
    uplink.transport.leave();
    for (let i = 0; i < 5000 && h.host!.state!.phase !== 'gameOver'; i++) h.host!.step();
    await settle(5000);
    expect(h.host!.state!.phase).toBe('gameOver');
    expect(d.event.phase).toBe('playing');
    // …and comes back (a new connection to the director's room)
    (h.uplink as unknown as { join: (code: string) => void }).join(CODE);
    await settle(10_000);
    expect(d.event.phase).toBe('between');
    expect(d.event.rounds[0].tables[0].result).toBeDefined();
    // (a repeat changes nothing)
    h.host!.resendResult();
    await settle(5000);
    expect(d.event.rounds).toHaveLength(1);
    desk.close();
    phones.forEach((p) => p.leaveTable());
  });

  it('a table taken over by one of its players links up again, plays on, and its result counts', async () => {
    const net = new Net();
    const { d, desk } = director(net, { rounds: 1 });
    const phones = ['Ann', 'Bo'].map((n) => new Phone(net, n));
    await settle();
    desk.start();
    await settle();
    const host = phones.find((p) => p.host)!;
    const other = phones.find((p) => !p.host)!;
    let snap: HostSnapshot | null = null;
    host.host!.onPersist = (s) => (snap = structuredClone(s));
    for (let i = 0; i < 6; i++) host.host!.step();
    // the host's phone dies; the other player takes the table over from its backup
    host.leaveTable();
    other.leaveTable();
    const room = other.at!.room;
    const taken = new Host(net.open(room), room, { cid: other.id.cid, name: other.id.name }, snap!, { takeover: true });
    const link = new Uplink(net.open, CODE, taken, { cid: other.id.cid, secret: other.id.secret, round: 1, table: other.at!.table });
    await settle();
    // (linked up again: the director's seating doesn't start the table over)
    expect(JSON.stringify(taken.state!.zones)).toBe(JSON.stringify(snap!.state!.zones));
    for (let i = 0; i < 5000 && taken.state!.phase !== 'gameOver'; i++) taken.step();
    await settle();
    expect(d.event.phase).toBe('between');
    link.close();
    taken.close();
    desk.close();
  });

  it('“Find my table”: a phone that missed its move asks the director again', async () => {
    const net = new Net();
    const { desk } = director(net);
    const phones = ['Ann', 'Bo', 'Cy', 'Di'].map((n) => new Phone(net, n));
    await settle();
    // Di's phone goes to sleep before the start
    phones[3].link!.close();
    phones[3].link = null;
    desk.start();
    await settle();
    expect(phones[3].at).toBeNull();
    phones[3].findTable();
    await settle();
    expect(phones[3].at?.round).toBe(1);
    desk.close();
    phones.forEach((p) => p.leaveTable());
  });

  it('when the first room fills, newcomers are sent on to another', async () => {
    const net = new Net();
    const { desk, registry } = director(net);
    const phones = Array.from({ length: ROOM_PEERS + 4 }, (_, i) => new Phone(net, `P${i}`));
    await settle(6000);
    expect(registry.people()).toHaveLength(phones.length);
    expect(net.buses.size).toBe(2);
    desk.close();
    phones.forEach((p) => p.link?.close());
  });
});
