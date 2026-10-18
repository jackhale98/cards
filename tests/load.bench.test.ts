import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { it, vi } from 'vitest';
import { createEvent, type EventConfig } from '../src/engine/events';
import { Director, ROUND_PAUSE_MS } from '../src/net/director';
import { Desk } from '../src/net/director/desk';
import { Registry } from '../src/net/director/registry';
import { RemoteTable } from '../src/net/director/remote';
import { directorSave, sealSave, type Escrow } from '../src/net/director/standby';
import { LocalTable } from '../src/net/director/tables';
import { newSecret, seatKeyFor } from '../src/net/eventCrypto';
import { MAX_COPY } from '../src/net/eventProtocol';
import { newBackupKey } from '../src/net/backup';
import { EventLink } from '../src/net/eventLink';
import { makeRoomCode, type Msg } from '../src/net/protocol';
import type { Transport } from '../src/net/transport';
import { CODE, Phone, type Net } from './eventHarness';
import { GAMES } from './games';

/**
 * How big a tournament one director can run: a director and its phones on an in-memory network,
 * every table making a move a second (bots play everyone's seats, as `Host.step` does), for a few
 * formats at 4 to 64 tables. Measured, as if each device were its own:
 *
 * - the director's main thread: its time in all (the tables it hosts, the desk, its screen's data,
 *   saving), the busiest second of it, and the longest it's blocked at once. Bots think in a
 *   worker in the app, so their thinking is counted apart;
 * - the save (localStorage holds about 5 MB) and the standby's sealed copy (at most MAX_COPY);
 * - the traffic, against the relay's limits (relay/src/index.ts): messages and bytes a second each
 *   connection sends (RATE, BYTE_RATE: a message to everyone counts once for each, as our relay
 *   transport sends it), bytes a second a room (ROOM_BYTE_RATE), peers in a room (MAX_PEERS), and
 *   connections opened a minute from the venue's one address (CONNECTS, in wrangler.jsonc).
 *
 *   pnpm load                              (every format at 4, 8, 16, 32 and 64 tables)
 *   FORMATS=mtt TABLES=8,16 pnpm load
 *
 * Results go to load/load.json and a table on the console; docs/SCALE.md reads them. With PROFILE=1,
 * each run's CPU profile too (load/<format>-<tables>.cpuprofile: open it in Chrome's DevTools).
 */

const OUT = process.env.OUT ?? 'load';
const TABLES = (process.env.TABLES ?? '4,8,16,32,64').split(',').map(Number);
const FORMATS = (process.env.FORMATS ?? 'swiss,swiss-here,pairs,mtt').split(',');
/** The relay's limits (relay/src/index.ts; connections a minute from one address, as relay/wrangler.jsonc sets it). */
const RELAY = {
  peers: 24,
  rate: 120,
  byteRate: 1024 * 1024,
  roomByteRate: 4 * 1024 * 1024,
  connects: Number(/"name": "CONNECTS".*?"limit": (\d+)/.exec(readFileSync('relay/wrangler.jsonc', 'utf8'))?.[1]),
};

const realTimeout = globalThis.setTimeout;
// (the real clock: the fake timers fake hrtime too)
const hrtime = process.hrtime.bigint;
const clock = () => Number(hrtime()) / 1e6;

/** Time spent by each device (an "actor"): its own, not what it set off on another device. */
class Meter {
  private stack: { who: string; start: number; inner: number }[] = [];
  spent = new Map<string, number>();
  /** Each actor's longest single task (a message handled, a timer, a move). */
  longest = new Map<string, number>();
  /** The director's time in each second of the game's clock. */
  seconds: number[] = [0];
  get current() {
    return this.stack.at(-1)?.who ?? 'driver';
  }
  run<T>(who: string, fn: () => T): T {
    const top = this.stack.at(-1);
    if (top?.who === who) return fn();
    const frame = { who, start: clock(), inner: 0 };
    this.stack.push(frame);
    try {
      return fn();
    } finally {
      this.stack.pop();
      const total = clock() - frame.start;
      const own = total - frame.inner;
      this.spent.set(who, (this.spent.get(who) ?? 0) + own);
      if (own > (this.longest.get(who) ?? 0)) this.longest.set(who, own);
      if (who === 'director') this.seconds[this.seconds.length - 1] += own;
      if (top) top.inner += total;
    }
  }
  tick() {
    this.seconds.push(0);
  }
}

/** Timers (and microtasks) run as whoever set them. */
function attribute(meter: Meter) {
  const g = globalThis as unknown as Record<string, (...a: never[]) => unknown>;
  const was = { setTimeout: g.setTimeout, setInterval: g.setInterval, queueMicrotask: g.queueMicrotask };
  const wrap =
    (set: (...a: never[]) => unknown) =>
    (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const who = meter.current;
      return (set as (f: () => void, ms?: number) => unknown)(() => meter.run(who, () => fn(...args)), ms);
    };
  g.setTimeout = wrap(was.setTimeout) as never;
  g.setInterval = wrap(was.setInterval) as never;
  g.queueMicrotask = ((fn: () => void) => {
    const who = meter.current;
    (was.queueMicrotask as (f: () => void) => void)(() => meter.run(who, fn));
  }) as never;
  return () => Object.assign(g, was);
}

/** One device's connection to a room. */
class LoadTransport implements Transport {
  readonly kind = 'memory';
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  left = false;
  joined = false;
  /** Sent before the relay let us in (as the relay transport keeps them). */
  queue: [Msg, string | undefined][] = [];
  /** Refused so far (the room full), and this second's sending (the relay's count). */
  tries = 0;
  window = 0;
  count = 0;
  bytes = 0;
  constructor(
    private net: LoadNet,
    readonly room: string,
    readonly selfId: string,
    readonly owner: string,
  ) {}
  send(msg: Msg, to?: string) {
    this.net.send(this, msg, to);
  }
  leave() {
    this.net.leave(this);
  }
  vouch(peer: string) {
    const host = this.net.hosts.get(this.room);
    return host ? host === peer : undefined;
  }
}

/**
 * Rooms by code, as our relay keeps them (relay/src/index.ts): a room seats MAX_PEERS, and a
 * connection refused tries again later, as the relay transport does; what a connection sends
 * beyond the relay's rates in a second is dropped. Each message arrives a moment after it's sent,
 * parsed by whoever gets it.
 */
class LoadNet {
  rooms = new Map<string, Set<LoadTransport>>();
  /** The director's rooms (it's their host: the relay vouches for it). */
  hosts = new Map<string, string>();
  private n = 0;
  /** When each connection was opened (the game's clock). */
  opens: number[] = [];
  /** Connections refused (a room full), and the longest anyone waited to get in. */
  refused = 0;
  longestWait = 0;
  /** This second's traffic: each connection's (room|peer), each room's. */
  /** Each connection's (room|peer) and each room's traffic in its current second (the relay's windows). */
  private sock = new Map<string, { window: number; n: number; bytes: number; types: Record<string, number> }>();
  private room = new Map<string, { window: number; bytes: number }>();
  peak = {
    sockN: 0,
    sockNAt: '',
    /** What the busiest connection sent in its busiest second (messages of each kind). */
    sockNWhat: {} as Record<string, number>,
    sockBytes: 0,
    sockBytesAt: '',
    roomBytes: 0,
    roomBytesAt: '',
    peers: 0,
    peersAt: '',
  };
  /** Everything the director sent, by kind (messages, bytes), and what the relay dropped of it. */
  directorSent: Record<string, { n: number; bytes: number; dropped?: number }> = {};
  total = { n: 0, bytes: 0, dropped: 0 };
  constructor(private meter: Meter) {}

  open = (code: string, director = false): Transport => {
    const t = new LoadTransport(this, code, `${director ? 'd' : 'p'}${++this.n}`, this.meter.current);
    if (director) this.hosts.set(code, t.selfId);
    const opened = Date.now();
    this.opens.push(opened);
    setTimeout(() => this.join(t, opened), 0);
    return t;
  };

  private join(t: LoadTransport, opened: number) {
    if (t.left) return;
    const members = this.rooms.get(t.room) ?? new Set<LoadTransport>();
    this.rooms.set(t.room, members);
    if (members.size >= RELAY.peers) {
      // ("Table is full": the relay transport tries again, a while later each time)
      this.refused++;
      const delay = Math.min(15_000, 500 * 2 ** t.tries++) * (0.75 + Math.random() * 0.5);
      this.opens.push(Date.now() + delay);
      setTimeout(() => this.join(t, opened), delay);
      return;
    }
    this.longestWait = Math.max(this.longestWait, Date.now() - opened);
    const others = [...members];
    members.add(t);
    t.joined = true;
    if (members.size > this.peak.peers) Object.assign(this.peak, { peers: members.size, peersAt: t.room });
    for (const o of others) {
      this.meter.run(o.owner, () => o.onPeerJoin(t.selfId));
      this.meter.run(t.owner, () => t.onPeerJoin(o.selfId));
    }
    for (const [msg, to] of t.queue.splice(0)) this.send(t, msg, to);
  }

  leave(t: LoadTransport) {
    t.left = true;
    const members = this.rooms.get(t.room);
    if (!members?.delete(t)) return;
    for (const o of members) this.meter.run(o.owner, () => o.onPeerLeave(t.selfId));
  }

  send(t: LoadTransport, msg: Msg, to?: string) {
    if (t.left) return;
    if (!t.joined) return void (t.queue.length < 256 && t.queue.push([msg, to]));
    const wire = JSON.stringify(msg);
    // (our relay transport sends a message for everyone to each of them)
    const members = [...(this.rooms.get(t.room) ?? [])].filter((m) => m !== t && (!to || m.selfId === to));
    const kind = (msg as { t?: string }).t ?? '?';
    const sec = Math.floor(Date.now() / 1000);
    if (t.window !== sec) Object.assign(t, { window: sec, count: 0, bytes: 0 });
    const room = this.roomNow(t.room, sec);
    const sock = this.sockNow(`${t.room}|${t.selfId}`, sec);
    const mine = t.owner === 'director' ? (this.directorSent[kind] ??= { n: 0, bytes: 0 }) : null;
    const to_: LoadTransport[] = [];
    for (const m of members) {
      t.count++;
      t.bytes += wire.length;
      room.bytes += wire.length;
      sock.n++;
      sock.bytes += wire.length;
      sock.types[kind] = (sock.types[kind] ?? 0) + 1;
      this.total.n++;
      this.total.bytes += wire.length;
      if (mine) {
        mine.n++;
        mine.bytes += wire.length;
      }
      // (beyond the relay's rates: dropped)
      if (t.count > RELAY.rate || t.bytes > RELAY.byteRate || room.bytes > RELAY.roomByteRate) {
        this.total.dropped++;
        if (mine) mine.dropped = (mine.dropped ?? 0) + 1;
      } else to_.push(m);
    }
    setTimeout(() => {
      for (const m of to_) if (!m.left) this.meter.run(m.owner, () => m.onMessage(JSON.parse(wire), t.selfId));
    }, 0);
  }

  /** A connection's traffic this second (its last second's, done, counted toward the busiest). */
  private sockNow(key: string, sec: number) {
    const s = this.sock.get(key);
    if (s?.window === sec) return s;
    if (s) this.sockDone(key, s);
    const fresh = { window: sec, n: 0, bytes: 0, types: {} as Record<string, number> };
    this.sock.set(key, fresh);
    return fresh;
  }
  private sockDone(key: string, s: { n: number; bytes: number; types: Record<string, number> }) {
    if (s.n > this.peak.sockN) Object.assign(this.peak, { sockN: s.n, sockNAt: key, sockNWhat: s.types });
    if (s.bytes > this.peak.sockBytes) Object.assign(this.peak, { sockBytes: s.bytes, sockBytesAt: key });
  }
  /** …and a room's. */
  private roomNow(code: string, sec: number) {
    const r = this.room.get(code);
    if (r?.window === sec) return r;
    if (r && r.bytes > this.peak.roomBytes) Object.assign(this.peak, { roomBytes: r.bytes, roomBytesAt: code });
    const fresh = { window: sec, bytes: 0 };
    this.room.set(code, fresh);
    return fresh;
  }
  /** The end: every second counted. */
  fold() {
    for (const [k, s] of this.sock) this.sockDone(k, s);
    for (const [k, r] of this.room) if (r.bytes > this.peak.roomBytes) Object.assign(this.peak, { roomBytes: r.bytes, roomBytesAt: k });
  }

  /** The most connections opened (or tried again) in any minute. */
  connectsPerMinute() {
    const at = [...this.opens].sort((a, b) => a - b);
    let most = 0;
    for (let i = 0, j = 0; i < at.length; i++) {
      while (at[i] - at[j] >= 60_000) j++;
      most = Math.max(most, i - j + 1);
    }
    return most;
  }
}

/** A tournament's setup, by name. */
const FORMAT: Record<string, (tables: number) => { config: Partial<EventConfig> & Pick<EventConfig, 'format'>; people: number; minutes: number }> = {
  // Hearts, each table on one of its players' phones (the default for Swiss)
  swiss: (n) => ({
    config: { format: 'swiss', game: { id: 'hearts', options: { target: 50 } }, seats: 4, sides: [[0], [1], [2], [3]], host: 'player', rounds: 2 },
    people: 4 * n,
    minutes: 40,
  }),
  // …every table on the director's device
  'swiss-here': (n) => ({
    config: { format: 'swiss', game: { id: 'hearts', options: { target: 50 } }, seats: 4, sides: [[0], [1], [2], [3]], host: 'director', rounds: 2 },
    people: 4 * n,
    minutes: 40,
  }),
  // duplicate pairs: bridge, three boards a round, on the director's device
  pairs: (n) => ({
    config: {
      format: 'pairs',
      game: { id: 'bridge', options: { ...GAMES.bridge.duplicate } },
      seats: 4,
      sides: GAMES.bridge.sides!(4)!,
      host: 'director',
      rounds: 2,
      boards: 3,
    },
    people: 4 * n,
    minutes: 40,
  }),
  // multi-table poker: nine a table, 30 big blinds each, the blinds up every 4 minutes; its first 40 minutes
  mtt: (n) => ({
    config: {
      format: 'mtt',
      game: { id: 'holdem', options: { stack: 600, bigBlind: 20 } },
      seats: 9,
      sides: Array.from({ length: 9 }, (_, i) => [i]),
      host: 'director',
      minutes: 4,
    },
    people: 9 * n,
    minutes: 40,
  }),
};

interface Result {
  format: string;
  tables: number;
  people: number;
  /** The event's length (the game's clock), and how far it got. */
  minutes: number;
  rounds: number;
  moves: number;
  /** Signing up (everyone arriving over five minutes): the longest anyone waited, and anyone not in after it all. */
  signUp: { longest: number; missing: number };
  /** Each round's moves: the longest anyone took to reach their table, and anyone two minutes on and still not there. */
  seating: { longest: number; late: number };
  /** The director's main thread: share of the time busy, its busiest second, its longest task, its time a move. */
  director: { busy: number; peakSecond: number; longest: number; perMove: number };
  /** The busiest phone (hosting a table, when they do). */
  phone: { busy: number; longest: number };
  save: { bytes: number; sealed: number; fits: boolean };
  traffic: LoadNet['peak'] & {
    perSecond: number;
    bytesPerSecond: number;
    dropped: number;
    refused: number;
    longestWait: number;
    connectsPerMinute: number;
    directorSent: LoadNet['directorSent'];
  };
}

async function run(format: string, tables: number): Promise<Result> {
  const meter = new Meter();
  const restore = attribute(meter);
  const net = new LoadNet(meter);
  const f = FORMAT[format](tables);
  // (bots think in a worker in the app: counted apart)
  const game = GAMES[f.config.game!.id];
  const bot = game.bot;
  game.bot = bot && ((view, seat) => meter.run('bots', () => bot(view, seat)));
  const escrow: Escrow = { deposit: () => {}, takeover: async () => ({ error: 'no-backup' }) };
  let saved = 0;
  const { d, desk, registry, save } = meter.run('director', () => {
    const registry = new Registry();
    const backup = { key: newBackupKey(), token: newBackupKey() };
    const event = createEvent({ name: 'Load', ...f.config } as EventConfig, 11);
    const ref: { desk?: Desk } = {};
    const d: Director = new Director({
      event,
      code: CODE,
      pause: ROUND_PAUSE_MS,
      keyFor: (m, round, table) => seatKeyFor(registry.secretOf(m)!, CODE, round, table),
      makeTable: (round, t, { restore, room } = {}) => {
        const people = t.seats.some((s) => s.member);
        if (people && !room && d.event.config.host !== 'director') return ref.desk!.remote(round, t);
        const at = room ?? (people ? makeRoomCode() : null);
        const local = new LocalTable(round, t.table, { code: at ?? makeRoomCode(), transport: at ? ref.desk!.tableRoom(at) : null, still: true, restore });
        local.onView = () => ref.desk?.viewed(t.table);
        return local;
      },
      onRound: (r) => ref.desk!.round(r),
      onOut: (m) => ref.desk!.out(m),
    });
    const save = () => directorSave({ code: CODE, hostKey: 'host-key', registry, director: d, desk: ref.desk!, backup });
    // as the app does (src/event.svelte.ts): its own screen's data at each change, and a save soon after
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const saveSoon = () => {
      saveTimer ??= setTimeout(() => {
        saveTimer = null;
        saved = Math.max(saved, JSON.stringify(save()).length);
      }, 800);
    };
    const refresh = () => [d.view, ref.desk!.tiles(), registry.people()];
    const desk = (ref.desk = new Desk({
      code: CODE,
      registry,
      director: () => d,
      open: (c) => net.open(c, true),
      onChange: () => {
        refresh();
        saveSoon();
      },
    }));
    d.onChange = () => {
      desk.changed();
      refresh();
      saveSoon();
    };
    d.resume();
    return { d, desk, registry, save };
  });
  // a screen showing the event (a TV), as at any club
  meter.run('tv', () => new EventLink(net.open, { code: CODE, cid: 'tv', name: 'TV', secret: newSecret() }, true));
  // everyone arrives over five minutes, and signs up
  const phones: Phone[] = [];
  const arrived = new Map<Phone, number>();
  const signUp = { longest: 0, missing: 0 };
  const signedUp = () => {
    for (const [p, at] of arrived)
      if (p.link?.you) {
        signUp.longest = Math.max(signUp.longest, Date.now() - at);
        arrived.delete(p);
      }
  };
  for (let sec = 0; sec < 5 * 60; sec++) {
    while (phones.length < (f.people * (sec + 1)) / 300) {
      const name = `P${phones.length + 1}`;
      const p = meter.run(`phone:${name}`, () => new Phone(net as unknown as Net, name, escrow));
      phones.push(p);
      arrived.set(p, Date.now());
    }
    await vi.advanceTimersByTimeAsync(1000);
    signedUp();
  }
  for (let sec = 0; sec < 15 * 60 && arrived.size; sec++) {
    await vi.advanceTimersByTimeAsync(1000);
    signedUp();
  }
  signUp.missing = arrived.size;
  const byCid = new Map(phones.map((p) => [p.id.cid, p]));
  const why = meter.run('director', () => desk.start());
  if (why) throw new Error(why);
  // (from here on: the event itself)
  meter.seconds = [0];
  meter.spent.clear();
  meter.longest.clear();
  const start = Date.now();
  let moves = 0;
  // who has a table to get to (each round's new seats), since when
  const want = new Map<string, { table: number; round: number; since: number; late?: boolean }>();
  const seating = { longest: 0, late: 0 };
  let round = 0;
  for (let sec = 0; sec < f.minutes * 60 && d.event.phase !== 'done'; sec++) {
    const r = d.event.rounds.at(-1);
    if (r && r.n !== round) {
      round = r.n;
      for (const t of r.tables)
        if (!t.carried)
          for (const s of t.seats) if (s.member) want.set(s.member, { table: t.table, round: r.n, since: want.get(s.member)?.since ?? Date.now() });
    }
    for (const t of r?.tables ?? []) {
      if (t.result) continue;
      const link = d.link(t.table);
      if (link instanceof LocalTable) {
        if (meter.run('director', () => link.step())) moves++;
      } else if (link instanceof RemoteTable) {
        const host = byCid.get(link.hostCid ?? '')?.host;
        if (host?.state && meter.run(`phone:${host.lobby.seats.find((x) => x.host)?.name}`, () => host.step())) moves++;
      }
    }
    await vi.advanceTimersByTimeAsync(1000);
    // (sealing a table's backup finishes in real time)
    await new Promise((resolve) => realTimeout(resolve, 0));
    meter.tick();
    for (const [cid, w] of want) {
      const p = byCid.get(cid)!;
      if (p.at?.table === w.table && p.at.round === w.round && (p.host || p.client?.view)) {
        seating.longest = Math.max(seating.longest, Date.now() - w.since);
        want.delete(cid);
      } else if (!w.late && Date.now() - w.since > 120_000) {
        w.late = true;
        seating.late++;
      }
    }
  }
  net.fold();
  const secs = (Date.now() - start) / 1000;
  const sealed = (await sealSave(save())).length;
  const directorMs = meter.spent.get('director') ?? 0;
  const ofPhones = (m: Map<string, number>) => Math.max(0, ...[...m].filter(([who]) => who.startsWith('phone:')).map(([, x]) => x));
  const result: Result = {
    format,
    tables,
    people: f.people,
    minutes: Math.round(secs / 6) / 10,
    rounds: d.event.rounds.length,
    moves,
    signUp,
    seating,
    director: {
      busy: directorMs / (secs * 1000),
      peakSecond: Math.max(...meter.seconds),
      longest: meter.longest.get('director') ?? 0,
      perMove: directorMs / Math.max(1, moves),
    },
    phone: { busy: ofPhones(meter.spent) / (secs * 1000), longest: ofPhones(meter.longest) },
    save: { bytes: saved, sealed, fits: sealed <= MAX_COPY },
    traffic: {
      ...net.peak,
      perSecond: net.total.n / secs,
      bytesPerSecond: net.total.bytes / secs,
      dropped: net.total.dropped,
      refused: net.refused,
      longestWait: net.longestWait,
      connectsPerMinute: net.connectsPerMinute(),
      directorSent: net.directorSent,
    },
  };
  meter.run('director', () => desk.close());
  d.close();
  for (const p of phones) p.leaveTable();
  game.bot = bot;
  restore();
  void registry;
  return result;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const kb = (x: number) => `${Math.round(x / 1024)} KB`;
const ms = (x: number) => `${x.toFixed(0)} ms`;
const secs = (x: number) => `${Math.round(x / 1000)} s`;

it.skipIf(!process.env.LOAD)(
  'how big a tournament one director can run',
  async () => {
    vi.useFakeTimers();
    const results: Result[] = [];
    try {
      for (const format of FORMATS)
        for (const tables of TABLES) {
          const session = process.env.PROFILE ? new Session() : null;
          if (session) {
            session.connect();
            await session.post('Profiler.enable');
            await session.post('Profiler.start');
          }
          const r = await run(format, tables);
          if (session) {
            const { profile } = await session.post('Profiler.stop');
            mkdirSync(OUT, { recursive: true });
            writeFileSync(`${OUT}/${format}-${tables}.cpuprofile`, JSON.stringify(profile));
            session.disconnect();
          }
          results.push(r);
          console.log(
            `${format} × ${tables} tables (${r.people} phones, ${r.minutes} min, ${r.rounds} rounds, ${r.moves} moves)\n` +
              `  signing up: longest ${secs(r.signUp.longest)}, ${r.signUp.missing} not in; to their tables: longest ${secs(r.seating.longest)}, ${r.seating.late} late\n` +
              `  director: ${pct(r.director.busy)} busy, busiest second ${ms(r.director.peakSecond)}, longest task ${ms(r.director.longest)}, ${r.director.perMove.toFixed(2)} ms a move; busiest phone ${pct(r.phone.busy)} (longest ${ms(r.phone.longest)})\n` +
              `  save ${kb(r.save.bytes)}, sealed ${kb(r.save.sealed)}${r.save.fits ? '' : ' (too big for the standby)'}\n` +
              `  ${Math.round(r.traffic.perSecond)} msgs/s, ${kb(r.traffic.bytesPerSecond)}/s; busiest connection ${r.traffic.sockN} msgs/s (${r.traffic.sockNAt}: ${JSON.stringify(r.traffic.sockNWhat)}), ` +
              `${kb(r.traffic.sockBytes)}/s; busiest room ${kb(r.traffic.roomBytes)}/s; ${r.traffic.dropped} dropped; ${r.traffic.peers} peers, ${r.traffic.refused} refused (longest wait ${secs(r.traffic.longestWait)}); ${r.traffic.connectsPerMinute} connections in a minute (the relay allows ${RELAY.connects})`,
          );
        }
    } finally {
      vi.useRealTimers();
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/load.json`, JSON.stringify(results, null, 2));
  },
  4 * 3600_000,
);
