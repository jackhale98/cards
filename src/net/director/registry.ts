import { shuffle, type RngState } from '../../engine/rng';
import type { Entrant } from '../../engine/events';
import type { EventPerson } from '../eventProtocol';
import { BOT_NAMES } from '../host/limits';
import { AVATAR_COLORS, AVATAR_EMOJI, type Avatar } from '../protocol';

/**
 * Who has signed up for a tournament: each person's name and look, their secret (from their
 * phone, given once: see eventCrypto), and, in a partnership game, who they asked to partner.
 * Kept by the director only (the people list everyone sees leaves the secrets out).
 */
export interface Member {
  id: string;
  name: string;
  avatar?: Avatar;
  secret: string;
  partner?: string;
  /** Duplicate teams: someone whose pair they'd like on their team. */
  team?: string;
  /** A bot the director put in (a whole side: in a partnership game, a pair of bots). No secret, no phone. */
  bot?: boolean;
}

/** A bot partners anyone left without one (their side's other seat: see engine/events seatTable). */
export const BOT_MEMBER = '';

export class Registry {
  members = new Map<string, Member>();

  constructor(saved?: Member[]) {
    for (const m of saved ?? []) this.members.set(m.id, { ...m });
  }

  /** Someone signs up (`new`), signs up again from the same phone (`same`), or someone else has their id (`taken`). */
  add(m: Member): 'new' | 'same' | 'taken' {
    const had = this.members.get(m.id);
    if (had) {
      if (had.secret !== m.secret) return 'taken';
      had.name = m.name;
      had.avatar = m.avatar;
      return 'same';
    }
    this.members.set(m.id, { ...m });
    return 'new';
  }

  /** The director puts a bot in (to make the numbers up, or a field to play against). */
  addBot(): Member {
    const used = new Set([...this.members.values()].map((m) => m.name));
    let n = this.members.size + 1;
    while (this.members.has(`bot:${n}`)) n++;
    const name = BOT_NAMES.find((x) => !used.has(x)) ?? `Bot ${n}`;
    const avatar = { emoji: AVATAR_EMOJI[(n * 7 + 3) % AVATAR_EMOJI.length], color: AVATAR_COLORS[(n * 3 + 1) % AVATAR_COLORS.length] };
    const m: Member = { id: `bot:${n}`, name, avatar, secret: '', bot: true };
    this.members.set(m.id, m);
    return m;
  }

  remove(id: string) {
    for (const m of this.members.values()) {
      if (m.partner === id) delete m.partner;
      if (m.team === id) delete m.team;
    }
    this.members.delete(id);
  }

  secretOf(id: string): string | undefined {
    return this.members.get(id)?.secret;
  }

  /** Partnership games: `id` would like to partner `other` (null: nobody). The director may set it either way. */
  setPartner(id: string, other: string | null) {
    const m = this.members.get(id);
    if (!m || m.bot || other === id || (other && !this.person(other))) return;
    if (other) m.partner = other;
    else delete m.partner;
  }

  /** Duplicate teams: `id`'s pair would like `other`'s on their team (null: nobody in particular). The director sets it. */
  setTeam(id: string, other: string | null) {
    const m = this.members.get(id);
    if (!m || m.bot || other === id || (other && !this.person(other))) return;
    if (other) m.team = other;
    else delete m.team;
  }

  /** Someone signed up who isn't a bot. */
  private person(id: string): boolean {
    const m = this.members.get(id);
    return !!m && !m.bot;
  }

  /** Everyone, as everyone may see them. */
  people(): EventPerson[] {
    return [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.avatar ? { avatar: m.avatar } : {}),
      ...(m.partner ? { partner: m.partner } : {}),
      ...(m.team ? { team: m.team } : {}),
      ...(m.bot ? { bot: true } : {}),
    }));
  }

  /**
   * The tournament's entrants: one each, or, two to a side, partnerships: those who asked for each
   * other first, then the rest paired at random, and anyone left over with a bot for a partner.
   * Each bot the director put in is a side of its own. Duplicate teams (`teams`): the partnerships
   * two by two (see teamsOf), and each bot a whole team.
   */
  entrants(perSide: number, dice: { rng: RngState }, teams = false): Entrant[] {
    if (teams)
      return [
        ...this.teamsOf(
          this.entrants(perSide, dice).filter((x) => !x.bot),
          dice,
        ),
        ...this.botSides(perSide * 2),
      ];
    const all = [...this.members.values()].filter((m) => !m.bot);
    const bots = this.botSides(perSide);
    if (perSide === 1) return [...all.map((m) => ({ id: m.id, name: m.name, members: [m.id], names: [m.name] })), ...bots];
    const paired = new Set<string>();
    const out: Entrant[] = [];
    const pair = (a: Member, b: Member | null) => {
      paired.add(a.id);
      if (b) paired.add(b.id);
      out.push({
        id: b ? `${a.id}+${b.id}` : a.id,
        name: b ? `${a.name} & ${b.name}` : a.name,
        members: [a.id, b?.id ?? BOT_MEMBER],
        names: [a.name, b?.name ?? 'Bot'],
      });
    };
    for (const a of all) {
      const b = a.partner ? this.members.get(a.partner) : undefined;
      if (!paired.has(a.id) && b && !paired.has(b.id) && b.partner === a.id) pair(a, b);
    }
    const rest = shuffle(
      all.filter((m) => !paired.has(m.id)),
      dice,
    );
    for (let i = 0; i < rest.length; i += 2) pair(rest[i], rest[i + 1] ?? null);
    return [...out, ...bots];
  }

  /**
   * Duplicate teams of four: two partnerships each, those asked for (a member of one pair asked for
   * someone in the other) first, then the rest at random, and a pair left over with a pair of bots.
   */
  private teamsOf(pairs: Entrant[], dice: { rng: RngState }): Entrant[] {
    const out: Entrant[] = [];
    const used = new Set<Entrant>();
    const team = (a: Entrant, b: Entrant | null) => {
      used.add(a);
      if (b) used.add(b);
      const names = [...(a.names ?? []), ...(b?.names ?? ['Bot', 'Bot'])];
      out.push({
        id: b ? `${a.id}+${b.id}` : a.id,
        name: b ? `${names.slice(0, 3).join(', ')} & ${names[3]}` : `${a.name} and two bots`,
        members: [...a.members, ...(b?.members ?? [BOT_MEMBER, BOT_MEMBER])],
        names,
      });
    };
    const wants = (a: Entrant, b: Entrant) => a.members.some((m) => !!m && b.members.includes(this.members.get(m)?.team ?? '\0'));
    for (const a of pairs) {
      const b = pairs.find((x) => x !== a && !used.has(x) && (wants(a, x) || wants(x, a)));
      if (!used.has(a) && b) team(a, b);
    }
    const rest = shuffle(
      pairs.filter((x) => !used.has(x)),
      dice,
    );
    for (let i = 0; i < rest.length; i += 2) team(rest[i], rest[i + 1] ?? null);
    return out;
  }

  /** The bots' sides: in a partnership game, each bot's partner is another bot, with a name of its own. */
  private botSides(perSide: number): Entrant[] {
    const bots = [...this.members.values()].filter((m) => m.bot);
    const used = new Set([...this.members.values()].map((m) => m.name));
    const spare = BOT_NAMES.filter((x) => !used.has(x));
    let k = 0;
    return bots.map((m) => {
      const names = [m.name, ...Array.from({ length: perSide - 1 }, () => spare.shift() ?? `${m.name} ${++k + 1}`)];
      return { id: m.id, name: names.join(' & '), members: [], names, bot: true };
    });
  }

  snapshot(): Member[] {
    return [...this.members.values()].map((m) => ({ ...m }));
  }
}
