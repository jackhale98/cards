import { shuffle, type RngState } from '../../engine/rng';
import type { Entrant } from '../../engine/events';
import type { EventPerson } from '../eventProtocol';
import type { Avatar } from '../protocol';

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

  remove(id: string) {
    for (const m of this.members.values()) if (m.partner === id) delete m.partner;
    this.members.delete(id);
  }

  secretOf(id: string): string | undefined {
    return this.members.get(id)?.secret;
  }

  /** Partnership games: `id` would like to partner `other` (null: nobody). The director may set it either way. */
  setPartner(id: string, other: string | null) {
    const m = this.members.get(id);
    if (!m || other === id || (other && !this.members.has(other))) return;
    if (other) m.partner = other;
    else delete m.partner;
  }

  /** Everyone, as everyone may see them. */
  people(): EventPerson[] {
    return [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.avatar ? { avatar: m.avatar } : {}),
      ...(m.partner ? { partner: m.partner } : {}),
    }));
  }

  /**
   * The tournament's entrants: one each, or, two to a side, partnerships: those who asked for each
   * other first, then the rest paired at random, and anyone left over with a bot for a partner.
   */
  entrants(perSide: number, dice: { rng: RngState }): Entrant[] {
    const all = [...this.members.values()];
    if (perSide === 1) return all.map((m) => ({ id: m.id, name: m.name, members: [m.id], names: [m.name] }));
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
    return out;
  }

  snapshot(): Member[] {
    return [...this.members.values()].map((m) => ({ ...m }));
  }
}
