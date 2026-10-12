import type { Action, ActionSpec, CardRef, GameModule, GameState, ZoneState } from './types';

/** A card the viewer may not see. Ids are positional so they never leak identity. */
export const HIDDEN = '?';
export const isHidden = (id: string) => id.startsWith(HIDDEN);

/**
 * Placeholder id for a card the viewer can't see.
 * - Face-down cards in public zones (the table, a face-down discard) get a stable key, which is
 *   renewed whenever the card moves, so they animate smoothly but can't be traced.
 * - Cards in hands and the deck are purely positional, so nothing leaks about how a hand is
 *   arranged (e.g. where a freshly drawn card was sorted to).
 */
function aliasOf(z: ZoneState, c: CardRef, index: number): string {
  return z.visibility === 'all' && c.k != null ? `${HIDDEN}${z.id}~${c.k}` : `${HIDDEN}${z.id}.${index}`;
}

export function canSee(z: ZoneState, c: CardRef, viewer: number): boolean {
  switch (z.visibility) {
    case 'none':
      return false;
    case 'owner':
      return (z.owner === viewer && !c.blind) || !!c.up;
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
        canSee(z, c, viewer) ? c : { id: aliasOf(z, c, i), up: false, by: c.by },
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


/**
 * Card ids inside action specs must be the ones the viewer sees: a face-down card on the table
 * is offered as its placeholder id, never its real identity.
 */
export function redactActions(s: GameState<any>, viewer: number, specs: ActionSpec[]): ActionSpec[] {
  const alias = new Map<string, string>();
  for (const z of Object.values(s.zones))
    z.cards.forEach((c, i) => {
      if (!canSee(z, c, viewer)) alias.set(c.id, aliasOf(z, c, i));
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
    const keyed = id.lastIndexOf('~');
    const dot = keyed >= 0 ? keyed : id.lastIndexOf('.');
    const z = s.zones[id.slice(1, dot)];
    const ref = Number(id.slice(dot + 1));
    const c = keyed >= 0 ? z?.cards.find((x) => x.k === ref) : z?.cards[ref];
    if (!z || !c || canSee(z, c, viewer)) return null;
    cards.push(c.id);
  }
  return { ...a, cards };
}
