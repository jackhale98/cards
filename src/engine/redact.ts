import type { CardRef, GameModule, GameState, ZoneState } from './types';

/** A card the viewer may not see. Ids are positional so they never leak identity. */
export const HIDDEN = '?';
export const isHidden = (id: string) => id.startsWith(HIDDEN);

function canSee(z: ZoneState, c: CardRef, viewer: number): boolean {
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
