import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { standings } from '../src/engine/events';
import { ROOM_PEERS } from '../src/net/director/desk';
import { Registry } from '../src/net/director/registry';
import { LocalTable } from '../src/net/director/tables';
import { newSecret, prove, signMove } from '../src/net/eventCrypto';
import { EVENT_PROTOCOL } from '../src/net/eventProtocol';
import { EventLink } from '../src/net/eventLink';
import { Host, type HostSnapshot } from '../src/net/host';
import { seedState } from '../src/engine/rng';
import { Uplink } from '../src/net/host/uplink';
import type { Msg } from '../src/net/protocol';
import { MemTransport } from './netHarness';
import { CODE, director, Net, Phone, playOut, settle } from './eventHarness';
import './games';

/**
 * A tournament over the network (in memory: one room per code): phones sign up with the director,
 * follow their moves to tables hosted by one of their players, and on to the next round; the
 * tables link back, report, and pass moves on. Every move is checked with its player's secret.
 */

describe('the sign-up list', () => {
  const dice = { rng: seedState(5) };
  it('bots the director puts in are sides of their own, named, and nobody’s partner', () => {
    const r = new Registry();
    r.add({ id: 'ann', name: 'Ann', secret: newSecret() });
    r.add({ id: 'bo', name: 'Bo', secret: newSecret() });
    const a = r.addBot();
    const b = r.addBot();
    expect(a.id).not.toBe(b.id);
    expect(a.name).not.toBe(b.name);
    expect(r.people().filter((p) => p.bot)).toHaveLength(2);
    // one to a side
    const singles = r.entrants(1, structuredClone(dice));
    expect(singles).toHaveLength(4);
    expect(singles.filter((x) => x.bot).map((x) => x.members)).toEqual([[], []]);
    // two to a side: the people pair up, and each bot is a pair of bots, with names of their own
    r.setPartner('ann', a.id);
    expect(r.members.get('ann')!.partner).toBeUndefined();
    r.setPartner(a.id, 'ann');
    expect(r.members.get(a.id)!.partner).toBeUndefined();
    const pairs = r.entrants(2, structuredClone(dice));
    expect(pairs).toHaveLength(3);
    const botPairs = pairs.filter((x) => x.bot);
    expect(botPairs).toHaveLength(2);
    const names = botPairs.flatMap((x) => x.names!);
    expect(new Set(names).size).toBe(4);
    expect(names).not.toContain('Ann');
    expect(r.secretOf(a.id)).toBe('');
  });
});

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
    // round 2: everyone hears where to go, on their own (quiet) link to the director and through the host of the table they're at
    expect(phones.every((p) => p.link)).toBe(true);
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

  it('a bye, and the end: those without a table wait at the event, and come back for the next round', async () => {
    const net = new Net();
    const { d, desk } = director(net);
    const phones = ['Ann', 'Bo', 'Cy'].map((n) => new Phone(net, n));
    await settle();
    desk.start();
    await settle();
    const bye = phones.find((p) => p.at?.table === 0)!;
    expect(bye).toBeDefined();
    expect(bye.link).not.toBeNull();
    expect(bye.link!.you?.bye).toBe(true);
    await playOut(phones);
    d.advance();
    await settle();
    expect(bye.at?.round).toBe(2);
    expect(bye.at?.table).toBeGreaterThan(0);
    expect(phones.filter((p) => p.at?.round === 2 && p.at.table === 0)).toHaveLength(1);
    await playOut(phones);
    d.advance();
    await settle();
    expect(d.event.phase).toBe('done');
    // everyone back at the event, for the final standings
    expect(phones.every((p) => p.at?.table === 0 && p.link?.board?.board.phase === 'done')).toBe(true);
    desk.close();
    phones.forEach((p) => {
      p.leaveTable();
      p.link?.close();
    });
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

  it('bots the director puts in are entrants: at a table with a person, its host names them; on their own, the director hosts them', async () => {
    const net = new Net();
    const { d, desk, registry } = director(net, { rounds: 1 });
    const ann = new Phone(net, 'Ann');
    await settle();
    for (let i = 0; i < 3; i++) registry.addBot();
    expect(desk.start()).toBeNull();
    await settle();
    const r = d.event.rounds[0];
    expect(r.tables).toHaveLength(2);
    const mine = r.tables.find((t) => t.seats.some((s) => s.member === 'ann'))!;
    const bots = r.tables.find((t) => t !== mine)!;
    expect(d.link(bots.table)).toBeInstanceOf(LocalTable);
    // Ann hosts hers, with a bot entrant across from her, under its own name
    expect(ann.host).not.toBeNull();
    const botSeat = ann.host!.lobby.seats.find((s) => s.bot)!;
    expect(registry.people().map((p) => p.name)).toContain(botSeat.name);
    await playOut([ann], d);
    expect(d.event.phase).toBe('between');
    expect(d.event.rounds[0].tables.every((t) => t.result)).toBe(true);
    // (moves went to people only)
    const moved = net.log.filter((x) => x.msg.t === 'evMove' || x.msg.t === 'evForward');
    expect(JSON.stringify(moved)).not.toContain('bot:');
    desk.close();
    ann.leaveTable();
  });

  it('in a partnership game, a person without a partner plays with a bot of their own name, not theirs', async () => {
    const net = new Net();
    const { desk, registry } = director(net, {
      game: { id: 'euchre', options: {} },
      seats: 4,
      sides: [
        [0, 2],
        [1, 3],
      ],
      rounds: 1,
    });
    const ann = new Phone(net, 'Ann');
    await settle();
    registry.addBot();
    expect(desk.start()).toBeNull();
    await settle();
    const names = ann.host!.lobby.seats.map((s) => s.name);
    expect(names.filter((n) => n === 'Ann')).toHaveLength(1);
    expect(new Set(names).size).toBe(4);
    desk.close();
    ann.leaveTable();
  });

  it('the screens show what the director chooses: the tables live in turn, or the table it picks', async () => {
    const net = new Net();
    const { d, desk, registry } = director(net, { rounds: 2 }, { still: true });
    for (let i = 0; i < 6; i++) registry.addBot();
    const screen = new EventLink(net.open, { code: CODE, cid: 'screen:tv', name: 'Screen', secret: newSecret() }, true);
    await settle();
    expect(desk.start()).toBeNull();
    await settle();
    expect(screen.board?.show).toBe('turn');
    expect(screen.board?.live).toBeNull();
    // the tables live: each in turn
    desk.setShow('live');
    await settle(1000);
    expect(screen.board?.show).toBe('live');
    expect(screen.board?.live?.table).toBe(1);
    expect(screen.board?.live?.view).toBeTruthy();
    await settle(15_000);
    expect(screen.board?.live?.table).toBe(2);
    await settle(30_000);
    expect(screen.board?.live?.table).toBe(1);
    // the director picks one: it stays
    desk.feature(3);
    await settle(31_000);
    expect(screen.board?.live?.table).toBe(3);
    // a finished table makes way for those still playing
    desk.feature(null);
    const one = d.link(1) as LocalTable;
    for (let i = 0; i < 3000 && one.step(); i++);
    await settle(1000);
    expect(d.event.rounds[0].tables[0].result).toBeTruthy();
    expect(desk.featured).not.toBe(1);
    // anything but the tables live: no table on the screens, and no timer
    desk.setShow('standings');
    await settle(1000);
    expect(screen.board?.show).toBe('standings');
    expect(screen.board?.live).toBeNull();
    expect(vi.getTimerCount()).toBeLessThan(20);
    desk.close();
    screen.close();
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
