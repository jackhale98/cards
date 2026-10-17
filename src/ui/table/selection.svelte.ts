import type { ActionSpec } from '../../engine/types';

/**
 * Picking cards: which you may pick now (from the actions on offer), what a tap or a swipe does,
 * and what tapping a pile does with them. The rules are pure functions; `Selection` keeps the
 * picked cards between updates.
 */

/** What may be picked now, from the actions on offer. */
export interface Picking {
  /** The cards you may pick (null: no action wants cards). */
  selectable: Set<string> | null;
  /** The action a swipe (or a second tap) does with a card. */
  quick?: ActionSpec;
  /** The most cards any action takes. */
  maxSelect: number;
}

export function picking(actions: ActionSpec[]): Picking {
  const selecting = actions.filter((a) => a.select);
  return {
    selectable: selecting.length ? new Set(selecting.flatMap((a) => a.select!.cards)) : null,
    quick: actions.find((a) => a.quick && a.select),
    maxSelect: Math.max(0, ...selecting.map((a) => a.select!.max)),
  };
}

/**
 * A tap on a card: picked or put back (one at a time when an action takes just one, up to the
 * most any takes), or, tapping a lone picked card again, its quick action (unless that's swipe
 * only). `null`: a card you can't pick now.
 */
export function afterTap(selected: string[], id: string, p: Picking): { selected: string[] } | { play: ActionSpec } | null {
  if (!p.selectable?.has(id)) return null;
  if (selected.includes(id)) {
    if (p.quick?.quick === true && selected.length === 1 && p.quick.select!.cards.includes(id)) return { play: p.quick };
    return { selected: selected.filter((x) => x !== id) };
  }
  if (p.maxSelect === 1) return { selected: [id] };
  if (selected.length < p.maxSelect) return { selected: [...selected, id] };
  return { selected };
}

/**
 * A swipe up on a card: its quick action, with the cards picked along with it (or just it), or
 * a tap if there's no quick action for it. `cards`: what the action is done with.
 */
export function afterSwipe(selected: string[], id: string, p: Picking): { play: ActionSpec; cards: string[] } | 'tap' {
  if (!p.quick || !p.quick.select!.cards.includes(id)) return 'tap';
  return { play: p.quick, cards: selected.includes(id) && selected.length <= p.quick.select!.max ? selected : [id] };
}

/** The action tapping a pile does: drawing from it, say, or with cards picked, putting them there (Kings Corners). */
export function zoneActionOf(actions: ActionSpec[], zoneId: string, selected: string[]): ActionSpec | undefined {
  return actions.find(
    (a) =>
      a.zone === zoneId &&
      (!a.select || (selected.length >= a.select.min && selected.length <= a.select.max && selected.every((c) => a.select!.cards.includes(c)))),
  );
}

/** The cards you've picked, against the actions on offer (`actions`: read each time, as they change). */
export class Selection {
  selected = $state<string[]>([]);
  readonly #actions: () => ActionSpec[];
  constructor(actions: () => ActionSpec[]) {
    this.#actions = actions;
  }
  readonly picking = $derived.by(() => picking(this.#actions()));
  get selectable() {
    return this.picking.selectable;
  }
  /** Drop picked cards that can't be picked any more (after each update). */
  prune() {
    const valid = this.picking.selectable;
    const keep = this.selected.filter((id) => valid?.has(id));
    if (keep.length !== this.selected.length) this.selected = keep;
  }
  clear() {
    if (this.selected.length) this.selected = [];
  }
  zoneAction(zoneId: string) {
    return zoneActionOf(this.#actions(), zoneId, this.selected);
  }
}
