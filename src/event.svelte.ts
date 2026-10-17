import { createEvent, formatsFor, type EventConfig, type EventPersonal, type EventPublic, type FormatId } from './engine/events';
import { getGame, loadRules, rulesFor } from './games';
import { randomSeed } from './engine/rng';
import { shareBrain, type Brain } from './net/brain';
// (the director's code, and the host's it brings with it, load only on a device that directs: see openDirector)
import type { Director } from './net/director';
import type { Desk } from './net/director/desk';
import type { Registry } from './net/director/registry';
import { BACKUP_EVERY_MS, DIRECTOR_QUIET_MS, directorSave, roomEscrow, sealSave, takeOver, type DirectorSave } from './net/director/standby';
import { newBackupKey } from './net/backup';
import { newSecret, seatKeyFor, type SignedMove } from './net/eventCrypto';
import type { BoardShow, EventPerson, TableTile } from './net/eventProtocol';
import { EventLink, isOurMove, type EventIdentity } from './net/eventLink';
import type { Host } from './net/host';
import { Uplink } from './net/host/uplink';
import { makeEventCode, makeRoomCode, type Avatar, type LobbyEvent, type View } from './net/protocol';
import { eventRooms, type TransportKind } from './net/transport';

/**
 * Tournaments on this device: a phone's place in one (its identity, kept so a reload or a new tab
 * finds its way back; its link to the director while it signs up or waits), a table's link to the
 * director while this device hosts it, a screen showing one, and the director's own desk when
 * this device runs one. Everything lives beside the table this device is at (src/app.svelte.ts),
 * which comes and goes with each round.
 */

/** What the events need from the app. */
export interface EventHooks {
  readonly cid: string;
  readonly name: string;
  readonly avatar: Avatar;
  readonly net: TransportKind;
  go(hash: string): void;
  say(text: string): void;
  /** This tab takes on the identity it had in a tournament (a new tab, or the browser reopened). */
  becomeId(cid: string): void;
  inUse(cid: string): Promise<boolean>;
  /** Go to a table: host it (`host`), or join it holding this seat key. */
  sit(move: SignedMove, key: string): void;
  brain(): Brain;
  /** Development builds: tables held still, stepped by hand (`?still`). */
  readonly still: boolean;
  /** Development builds: a tournament drawn and dealt from this seed (`?seed=7`), the same every time. */
  readonly seed?: number;
}

/** This phone in a tournament, kept on the device. */
interface Entry extends EventIdentity {
  at: number;
  /** Its latest move (to find its way back after a reload). */
  move?: SignedMove;
}
const ENTRIES = 'cards.events';
const ENTRY_FOR_MS = 2 * 24 * 3600_000;
const read = <T>(k: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};
function entries(): Entry[] {
  const all = read<Entry[]>(ENTRIES, []);
  return Array.isArray(all) ? all.filter((e) => e && typeof e.code === 'string' && typeof e.secret === 'string' && Date.now() - e.at < ENTRY_FOR_MS) : [];
}
function saveEntry(e: Entry) {
  const rest = entries().filter((x) => !(x.code === e.code && x.cid === e.cid));
  write(ENTRIES, [{ ...e, at: Date.now() }, ...rest].slice(0, 12));
}

const directorKey = (code: string) => `cards.director.${code}`;
/** A standby's latest copy of a tournament (sealed), and its link's token. */
const standbyKey = (code: string) => `cards.standby.${code}`;
interface StandbyCopy {
  token: string;
  blob: string;
  at: number;
}
/** Why a takeover didn't happen, as the standby is told. */
const TAKEOVER_WHY: Record<string, string> = {
  'host-here': 'The director’s device is still there — it may be back in a moment',
  'too-soon': 'The director only just went quiet — try again in a few seconds',
  'no-backup': 'Someone else has taken over already',
  'not-a-player': 'That standby link isn’t this tournament’s',
  offline: 'Couldn’t reach the Lamplight relay — check your connection',
  'bad-copy': 'The copy of the tournament couldn’t be opened',
};
/** A table's host follows its own move after this long (its players' moves, passed on, go first). */
const HOST_LEAVES_AFTER_MS = 1500;

/** The director's tournament, as its screens show it. */
export interface Directing {
  code: string;
  board: EventPublic;
  people: EventPerson[];
  /** Each table this round: its progress, whether its host has linked up, where it is, who hosts it. */
  tiles: { table: number; tile: TableTile | null; linked: boolean; host: string | null; local: boolean }[];
  holding: boolean;
  /** What can be played, for the setup. */
  formats: FormatId[];
  config: EventConfig;
  /** The table the director asked the screens to show; the one they're showing live now. */
  pinned: number | null;
  featured: number | null;
  live: View | null;
  show: BoardShow;
  /** A standby director: the link to send its device, how many are standing by, and when the last copy went. */
  standby: { link: string; linked: number; copiedAt: number | null; tooBig: boolean };
}

/** A standby director's view: the board, how old its copy is, whether the director has gone quiet. */
export interface Standing {
  code: string;
  board: EventPublic | null;
  people: EventPerson[];
  tiles: { table: number; tile: TableTile | null }[];
  live: { table: number; view: View } | null;
  show: BoardShow;
  /** How old its copy of the tournament is (null: none yet). */
  copyAge: number | null;
  quiet: boolean;
  taking: boolean;
  error: string | null;
}

export class Events {
  /** This phone's tournament (signing up, or waiting between tables). */
  phone = $state.raw<{ code: string; you: EventPersonal | null; board: EventPublic | null; people: EventPerson[]; refused: string | null } | null>(null);
  /** A screen showing a tournament. */
  screen = $state.raw<{
    code: string;
    board: EventPublic | null;
    people: EventPerson[];
    tiles: { table: number; tile: TableTile | null }[];
    live: { table: number; view: View } | null;
    show: BoardShow;
  } | null>(null);
  /** The tournament this device directs. */
  directing = $state.raw<Directing | null>(null);
  /** The tournament this device stands by to direct. */
  standby = $state.raw<Standing | null>(null);

  private link: EventLink | null = null;
  private screenLink: EventLink | null = null;
  private uplink: Uplink | null = null;
  private dir: {
    code: string;
    hostKey: string;
    backup: DirectorSave['backup'];
    director: Director;
    desk: Desk;
    registry: Registry;
    tables: ReturnType<typeof shareBrain>;
  } | null = null;

  constructor(private readonly app: EventHooks) {}

  // ---- a phone in a tournament ---------------------------------------------------------------

  /** This tab's identity in a tournament: its own, or one an earlier tab left (not in use now). */
  private async identity(code: string): Promise<Entry> {
    const mine = entries().filter((e) => e.code === code);
    const here = mine.find((e) => e.cid === this.app.cid);
    if (here) return here;
    for (const e of mine)
      if (!(await this.app.inUse(e.cid))) {
        this.app.becomeId(e.cid);
        return e;
      }
    const e: Entry = { code, cid: this.app.cid, name: this.app.name || 'Player', avatar: this.app.avatar, secret: newSecret(), at: Date.now() };
    saveEntry(e);
    return e;
  }

  /** Sign up (or come back): a link to the director, until this phone goes to a table. */
  async openPhone(code: string) {
    // (claimed before anything is awaited: the app may ask twice as the route changes)
    if (this.phoneFor === code) return;
    this.closePhone();
    this.phoneFor = code;
    const id = await this.identity(code);
    const open = await eventRooms(this.app.net);
    if (this.phoneFor !== code) return;
    const link = new EventLink((c) => open(c), id);
    this.link = link;
    const show = () => {
      if (this.link !== link) return;
      if (link.you) saveEntry({ ...id, joined: true, at: Date.now() });
      this.phone = { code, you: link.you, board: link.board?.board ?? null, people: link.board?.people ?? [], refused: link.refused?.why ?? null };
    };
    link.onChange = show;
    link.onMove = (m) => this.follow(m);
    show();
  }
  closePhone() {
    this.link?.close();
    this.link = null;
    this.phone = null;
    this.phoneFor = null;
  }
  private phoneFor: string | null = null;

  /** Partnership games: who this phone would like to partner. */
  partner(cid: string | null) {
    this.link?.partner(cid);
  }

  /** The identity this tab has in tournament `code` (null: none). */
  entry(code: string): Entry | null {
    return entries().find((e) => e.code === code && e.cid === this.app.cid) ?? null;
  }

  /**
   * A move, from the director or passed on by a table's host: checked with this phone's secret,
   * then followed: to a table (to host it, or sit at it), or back to the event to wait.
   */
  follow(m: SignedMove) {
    const e = this.entry(m.event);
    if (!e || !isOurMove(e, m)) return;
    if (e.move && (m.round < e.move.round || (m.round === e.move.round && m.room === e.move.room && m.table === e.move.table))) return;
    saveEntry({ ...e, move: m, joined: true });
    this.stopFinding();
    const go = () => {
      if (m.table === 0) return this.app.go(`/event/${m.event}`);
      this.closePhone();
      this.app.sit(m, seatKeyFor(e.secret, m.event, m.round, m.table));
    };
    // (this phone hosts a table: the moves it's passing on to its players get away before it closes)
    if (this.uplink) setTimeout(go, HOST_LEAVES_AFTER_MS);
    else go();
  }

  /**
   * At a tournament's table whose host has gone quiet: ask the director where to go (the move the
   * host was to pass on may have gone with it). Quietly: the table stays on screen, and the phone
   * moves only if there's somewhere new to go.
   */
  async findTable(code: string) {
    if (this.finding === code) return;
    const e = this.entry(code);
    if (!e) return;
    this.stopFinding();
    this.finding = code;
    const open = await eventRooms(this.app.net);
    if (this.finding !== code) return;
    const link = new EventLink((c) => open(c), { ...e, joined: true });
    link.onMove = (m) => this.follow(m);
    this.finder = link;
  }
  /** The table's host is back (or the phone has moved on). */
  stopFinding() {
    this.finder?.close();
    this.finder = null;
    this.finding = null;
  }
  private finder: EventLink | null = null;
  private finding: string | null = null;

  /** This device hosts a tournament's table: its link to the director (null: not this tab's tournament). */
  async linkTable(host: Host, info: LobbyEvent): Promise<Uplink | null> {
    this.closeUplink();
    const e = this.entry(info.code);
    if (!e) return null;
    const open = await eventRooms(this.app.net);
    const up = new Uplink((c) => open(c), info.code, host, { cid: e.cid, secret: e.secret, round: info.round, table: info.table });
    up.onMove = (m) => this.follow(m);
    up.onRefused = (why) => why && this.app.say(why);
    this.uplink = up;
    return up;
  }
  closeUplink() {
    this.uplink?.close();
    this.uplink = null;
  }

  // ---- a screen showing a tournament -------------------------------------------------------

  async openScreen(code: string) {
    if (this.screenFor === code) return;
    this.closeScreen();
    this.screenFor = code;
    const open = await eventRooms(this.app.net);
    if (this.screenFor !== code) return;
    const link = new EventLink((c) => open(c), { code, cid: `screen:${this.app.cid}`, name: 'Screen', secret: newSecret() }, true);
    this.screenLink = link;
    link.onChange = () => {
      if (this.screenLink === link)
        this.screen = {
          code,
          board: link.board?.board ?? null,
          people: link.board?.people ?? [],
          tiles: link.board?.tiles ?? [],
          live: link.board?.live ?? null,
          show: link.board?.show ?? 'turn',
        };
    };
    this.screen = { code, board: null, people: [], tiles: [], live: null, show: 'turn' };
  }
  closeScreen() {
    this.screenLink?.close();
    this.screenLink = null;
    this.screen = null;
    this.screenFor = null;
  }
  private screenFor: string | null = null;

  // ---- directing a tournament -----------------------------------------------------------------

  /** A new tournament, directed from this device: its code. */
  create(game = 'hearts'): string {
    const code = makeEventCode();
    this.pendingCreate = { code, game };
    return code;
  }
  private pendingCreate: { code: string; game: string } | null = null;

  /** This device directs tournament `code`: carried on from its save, or new (just created). False: neither. */
  async openDirector(code: string): Promise<boolean> {
    if (this.dir?.code === code) return true;
    // (claimed before anything is awaited: the app may ask twice as the route changes)
    if (this.directorFor === code) return this.directorOpening ?? true;
    this.directorFor = code;
    this.directorOpening = this.startDirector(code);
    const ok = await this.directorOpening;
    if (!ok) this.directorFor = null;
    return ok;
  }
  private directorFor: string | null = null;
  private directorOpening: Promise<boolean> | null = null;

  private async startDirector(code: string): Promise<boolean> {
    const save = read<DirectorSave | null>(directorKey(code), null);
    const fresh = this.pendingCreate?.code === code ? this.pendingCreate : null;
    this.pendingCreate = null;
    if (!save && !fresh) return false;
    const [open, { Director, ROUND_PAUSE_MS }, { Desk }, { Registry }, { LocalTable }] = await Promise.all([
      eventRooms(this.app.net),
      import('./net/director'),
      import('./net/director/desk'),
      import('./net/director/registry'),
      import('./net/director/tables'),
    ]);
    if (this.dir?.code === code) return true;
    const hostKey = save?.hostKey ?? crypto.randomUUID();
    // (a standby's copies are sealed with `key`, left with the relay; its link carries `token`)
    const backup = save?.backup ?? { key: newBackupKey(), token: newBackupKey() };
    let config: EventConfig | null = null;
    if (!save) {
      config = await this.configFor(fresh!.game, { name: `${this.app.name || 'Friday'}’s tournament`, format: 'swiss' });
      if (!config) return false;
    } else await loadRules(save.director.event.config.game.id).catch(() => {});
    const registry = new Registry(save?.registry);
    const tables = shareBrain(this.app.brain());
    const ref: { desk?: Desk } = {};
    const director = new Director({
      event: save?.director.event ?? createEvent(config!, this.app.seed ?? randomSeed()),
      code,
      pause: this.app.still ? null : ROUND_PAUSE_MS,
      keyFor: (m, round, table) => seatKeyFor(registry.secretOf(m) ?? '', code, round, table),
      makeTable: (round, t, restore) => {
        if (t.seats.some((s) => s.member)) return ref.desk!.remote(round, t);
        // (bots play every seat: the table is hosted here, with no network)
        const local = new LocalTable(round, t.table, { code: makeRoomCode(), brain: tables.table(`${round}:${t.table}`), restore, still: this.app.still });
        local.onView = () => ref.desk?.viewed(t.table);
        return local;
      },
      onRound: (r) => ref.desk?.round(r),
      restore: save?.director,
    });
    const desk = (ref.desk = new Desk({
      code,
      registry,
      director: () => director,
      open: (c) => open(c, hostKey),
      saved: save?.desk,
      // (signing up, partners: the desk's own changes, for this screen and the save)
      onChange: () => {
        this.refresh();
        this.saveSoon();
      },
      backup: { ...backup, escrow: roomEscrow((c) => open(c)) },
      onStandby: () => this.backupSoon(true),
    }));
    this.dir = { code, hostKey, backup, director, desk, registry, tables };
    director.onChange = () => {
      desk.changed();
      this.refresh();
      this.saveSoon();
    };
    director.resume();
    this.refresh();
    this.saveNow();
    return true;
  }

  /** The event's settings for a game: its seats (as recommended) and who partners whom. */
  private async configFor(game: string, base: { name: string; format: FormatId }): Promise<EventConfig | null> {
    try {
      await loadRules(game);
    } catch {
      this.app.say('Couldn’t load that game — check your connection');
      return null;
    }
    const g = getGame(game);
    const n = g.config.players.recommended ?? g.config.players.min;
    const seats = g.config.players.counts && !g.config.players.counts.includes(n) ? g.config.players.counts.at(-1)! : n;
    const sides = rulesFor(game)?.sides?.(seats) ?? Array.from({ length: seats }, (_, i) => [i]);
    const formats = formatsFor(g.config, sides);
    return {
      name: base.name,
      format: formats.includes(base.format) ? base.format : formats[0],
      game: { id: game, options: Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])) },
      seats,
      sides,
      host: 'player',
    };
  }

  /** Before the start: a different game (its seats and partnerships come with it). */
  async setGame(game: string) {
    const d = this.dir;
    if (!d || d.director.event.phase !== 'registering') return;
    const c = await this.configFor(game, d.director.event.config);
    if (!c || !this.dir) return;
    Object.assign(d.director.event.config, { ...c, rounds: d.director.event.config.rounds });
    d.director.onChange();
  }
  /** Before the start: the format, a setting of the game, the event's name, Swiss's rounds, a knockout's advancing. */
  setConfig(change: Partial<Pick<EventConfig, 'format' | 'name' | 'rounds' | 'advance'>> & { option?: { id: string; value: number | boolean } }) {
    const d = this.dir;
    if (!d || d.director.event.phase !== 'registering') return;
    const c = d.director.event.config;
    if (change.format && formatsFor(getGame(c.game.id).config, c.sides).includes(change.format)) c.format = change.format;
    if (typeof change.name === 'string') c.name = change.name.trim().slice(0, 40) || c.name;
    if (change.rounds !== undefined) c.rounds = change.rounds > 0 ? Math.min(20, Math.round(change.rounds)) : undefined;
    if (change.advance !== undefined) c.advance = Math.max(1, Math.min(2, Math.round(change.advance)));
    if (change.option) c.game.options = { ...c.game.options, [change.option.id]: change.option.value };
    d.director.onChange();
  }

  /** Start: everyone signed up is drawn into the first round. Null: started; else why not. */
  start(): string | null {
    return this.dir?.desk.start() ?? 'No tournament';
  }
  advance() {
    this.dir?.director.advance();
  }
  hold(on: boolean) {
    this.dir?.director.hold(on);
  }
  /** Show a table live on the screens (null: none). */
  feature(table: number | null) {
    this.dir?.desk.feature(table);
    this.refresh();
    this.saveSoon();
  }
  /** What the screens show. */
  show(show: BoardShow) {
    this.dir?.desk.setShow(show);
    this.refresh();
    this.saveSoon();
  }
  /** A bot signs up (before the start): to make the numbers up, or a field to play against. */
  addBot() {
    const d = this.dir;
    if (!d || d.director.event.phase !== 'registering') return;
    d.registry.addBot();
    d.director.onChange();
  }
  /** Partners, set by the director (before the start). */
  pair(a: string, b: string | null) {
    const d = this.dir;
    if (!d || d.director.event.phase !== 'registering') return;
    const was = d.registry.members.get(a)?.partner;
    if (was) d.registry.setPartner(was, null);
    d.registry.setPartner(a, b);
    if (b) d.registry.setPartner(b, a);
    d.director.onChange();
  }
  /** Someone off the list (before the start), or withdrawn (after). */
  remove(cid: string) {
    const d = this.dir;
    if (!d) return;
    if (d.director.event.phase === 'registering') d.registry.remove(cid);
    else {
      const x = d.director.event.entrants.find((y) => y.members.includes(cid));
      if (x) x.out = true;
    }
    d.director.onChange();
  }

  /** Development builds: steps of the event (its tables hosted here, then on to the next round). */
  stepEvent(n: number): number {
    let i = 0;
    while (i < n && this.dir?.director.step()) i++;
    return i;
  }

  /** Close the tournament on this device (it's over, or set aside). */
  endDirecting(forget = false) {
    const d = this.dir;
    if (!d) return;
    if (forget) write(directorKey(d.code), null);
    else this.saveNow();
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = null;
    d.desk.close();
    d.director.close();
    d.tables.close();
    this.dir = null;
    this.directing = null;
    this.directorFor = null;
  }

  private refresh() {
    const d = this.dir;
    if (!d) return;
    const e = d.director.event;
    const tiles = d.desk.tiles();
    const round = e.rounds.at(-1);
    this.directing = {
      code: d.code,
      board: d.director.view,
      people: d.registry.people(),
      tiles: (round?.tables ?? []).map((t) => {
        const x = tiles.get(t.table);
        return { table: t.table, tile: x?.tile ?? null, linked: !!x?.linked, host: x?.host ?? null, local: x?.local ?? false };
      }),
      holding: d.director.holding,
      formats: formatsFor(getGame(e.config.game.id).config, e.config.sides),
      config: structuredClone(e.config),
      pinned: d.desk.pinned,
      featured: d.desk.featured,
      live: d.desk.featured != null ? (d.director.link(d.desk.featured)?.view() ?? null) : null,
      show: d.desk.show,
      standby: {
        link: `${location.origin}${location.pathname}${location.search}#/standby/${d.code}/${d.backup.token}`,
        linked: d.desk.standbys(),
        copiedAt: d.desk.copiedAt,
        tooBig: this.tooBig,
      },
    };
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveSoon() {
    this.saveTimer ??= setTimeout(() => this.saveNow(), 800);
  }
  saveNow() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const d = this.dir;
    if (!d) return;
    write(directorKey(d.code), this.saveOf(d));
    this.backupSoon();
  }
  private saveOf(d: NonNullable<typeof this.dir>): DirectorSave {
    return directorSave({ code: d.code, hostKey: d.hostKey, registry: d.registry, director: d.director, desk: d.desk, backup: d.backup });
  }

  // ---- a standby director ---------------------------------------------------------------------

  /** A fresh copy for the standbys (if any), at most every so often (`now`: one has just linked up). */
  private backupSoon(now = false) {
    const d = this.dir;
    if (!d || !d.desk.standbys() || (this.backupTimer && !now)) return;
    if (this.backupTimer) clearTimeout(this.backupTimer);
    const wait = now ? 0 : Math.max(0, (d.desk.copiedAt ?? 0) + BACKUP_EVERY_MS - Date.now());
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      if (this.dir !== d) return;
      void sealSave(this.saveOf(d))
        .then((blob) => {
          if (this.dir !== d) return;
          this.tooBig = !d.desk.sendBackup(blob);
          this.refresh();
        })
        .catch((e) => console.warn('Couldn’t seal a copy for the standby', e));
    }, wait);
  }
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private tooBig = false;

  /** Stand by to direct tournament `code` (`token`: from the director's standby link). */
  async openStandby(code: string, token: string) {
    if (this.standingFor === code) return;
    this.closeStandby();
    this.standingFor = code;
    const open = await eventRooms(this.app.net);
    if (this.standingFor !== code) return;
    const link = new EventLink((c) => open(c), { code, cid: `standby:${this.app.cid}`, name: 'Standby', secret: newSecret() }, { standby: token });
    this.standbyLink = { link, token };
    const kept = read<StandbyCopy | null>(standbyKey(code), null);
    let copy = kept?.token === token ? kept : null;
    const show = () => {
      if (this.standbyLink?.link !== link) return;
      if (link.backup && link.backup.at !== copy?.at) {
        copy = { token, ...link.backup };
        write(standbyKey(code), copy);
      }
      const was = this.standby;
      this.standby = {
        code,
        board: link.board?.board ?? null,
        people: link.board?.people ?? [],
        tiles: link.board?.tiles ?? [],
        live: link.board?.live ?? null,
        show: link.board?.show ?? 'turn',
        copyAge: copy ? Date.now() - copy.at : null,
        quiet: Date.now() - link.heard > DIRECTOR_QUIET_MS || !!link.refused,
        taking: was?.taking ?? false,
        error: link.refused?.why ?? was?.error ?? null,
      };
    };
    link.onChange = show;
    show();
    // (how old the copy is, and whether the director has gone quiet: looked at every so often, only while standing by)
    this.standbyTimer = setInterval(show, 5000);
  }
  closeStandby() {
    this.standbyLink?.link.close();
    this.standbyLink = null;
    if (this.standbyTimer) clearInterval(this.standbyTimer);
    this.standbyTimer = null;
    this.standby = null;
    this.standingFor = null;
  }
  private standbyLink: { link: EventLink; token: string } | null = null;
  private standbyTimer: ReturnType<typeof setInterval> | null = null;
  private standingFor: string | null = null;

  /**
   * The director has gone quiet: take over. The relay hands over the key to the copy (and the
   * director's rooms) only once the director's device has really gone; then this device directs,
   * from the copy, and the tables on phones link up to it.
   */
  async takeOverDirecting() {
    const s = this.standby;
    const sb = this.standbyLink;
    const copy = s ? read<StandbyCopy | null>(standbyKey(s.code), null) : null;
    if (!s || !sb || s.taking || !copy || copy.token !== sb.token) return;
    this.standby = { ...s, taking: true, error: null };
    const open = await eventRooms(this.app.net);
    const got = await takeOver({ code: s.code, blob: copy.blob, token: copy.token, escrow: roomEscrow((c) => open(c)), hostKey: crypto.randomUUID() });
    if ('error' in got) {
      if (this.standby) this.standby = { ...this.standby, taking: false, error: TAKEOVER_WHY[got.error] ?? 'Couldn’t take over the tournament' };
      return;
    }
    write(directorKey(s.code), got);
    write(standbyKey(s.code), null);
    this.closeStandby();
    this.app.go(`/direct/${s.code}`);
    this.app.say('You’re directing the tournament now');
  }
}
