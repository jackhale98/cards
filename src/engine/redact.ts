import type { Action, ActionSpec, CardRef, GameModule, GameState, ZoneState } from './types';

/** A card the viewer may not see. Ids are positional so they never leak identity. */
export const HIDDEN = '?';
export const isHidden = (id: string) => id.startsWith(HIDDEN);

export function canSee(z: ZoneState, c: CardRef, viewer: number): boolean {
  switch (z.visibility) {
    case 'none':
      return false;
    case 'owner':
      return z.owner === viewer || !!c.up;
    case 'all':
      return c.up !== false;
  }
}

/**
 * Produce the copy of the state that `viewer` is allowed to see. This is what goes over the
 * wire, so nobody's device ever receives cards they shouldn't know.
 */
export function redact<D>(module: GameModule<D>, s: GameState<D>, viewer: number): GameState<D> {
  const zones: Record<string, ZoneState> = {};
  for (const [id, z] of Object.entries(s.zones)) {
    zones[id] = {
      ...z,
      cards: z.cards.map((c, i) =>
        canSee(z, c, viewer) ? c : { id: `${HIDDEN}${id}.${i}`, up: false, by: c.by },
      ),
    };
  }
  return {
    ...s,
    rng: 0,
    zones,
    data: module.redactData ? module.redactData(s, viewer) : s.data,
  };
}

const aliasOf = (zoneId: string, index: number) => `${HIDDEN}${zoneId}.${index}`;

/**
 * Card ids inside action specs must be the ones the viewer sees: a face-down card on the table
 * is offered as its placeholder id, never its real identity.
 */
export function redactActions(s: GameState<any>, viewer: number, specs: ActionSpec[]): ActionSpec[] {
  const alias = new Map<string, string>();
  for (const [id, z] of Object.entries(s.zones))
    z.cards.forEach((c, i) => {
      if (!canSee(z, c, viewer)) alias.set(c.id, aliasOf(id, i));
    });
  if (!alias.size) return specs;
  return specs.map((spec) =>
    spec.select ? { ...spec, select: { ...spec.select, cards: spec.select.cards.map((c) => alias.get(c) ?? c) } } : spec,
  );
}

/**
 * Turn placeholder ids in an incoming action back into real cards. Returns null if a
 * placeholder doesn't point at a card hidden from this player (e.g. the table changed).
 */
export function resolveAction(s: GameState<any>, viewer: number, a: Action): Action | null {
  if (!a.cards?.some(isHidden)) return a;
  const cards: string[] = [];
  for (const id of a.cards) {
    if (!isHidden(id)) {
      cards.push(id);
      continue;
    }
    const dot = id.lastIndexOf('.');
    const z = s.zones[id.slice(1, dot)];
    const c = z?.cards[Number(id.slice(dot + 1))];
    if (!z || !c || canSee(z, c, viewer)) return null;
    cards.push(c.id);
  }
  return { ...a, cards };
}
