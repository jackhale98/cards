import type { Action, ActionSpec } from './types';

/** The most moves worth trying (one card at a time from a big hand, a few ways of each). */
const MOST = 200;
/** Moves that commit to least, tried first. */
const PASSIVE = ['check', 'call', 'pass', 'decline', 'go', 'stand', 'next', 'fold'];

/**
 * Moves to try, in order, for a seat whose bot has failed (or that proposed a move the rules
 * refuse): the most passive on offer first, then each offered move in its plainest form (one card
 * at a time, or the fewest cards it takes; the suggested amount; the first target or choice). The
 * host tries them until the rules accept one, so a broken bot never freezes the table.
 */
export function fallbackMoves(offered: ActionSpec[]): Action[] {
  const rank = (a: ActionSpec) => {
    const i = PASSIVE.indexOf(a.type);
    return i < 0 ? PASSIVE.length : i;
  };
  const specs = offered.filter((a) => !a.menu && !a.react).sort((a, b) => rank(a) - rank(b));
  const out: Action[] = [];
  for (const spec of specs) {
    const base: Action = { type: spec.type };
    if (spec.amount) base.amount = spec.amount.default;
    if (spec.choose) {
      const first = spec.choose.options.find((o) => !o.disabled);
      if (!first) continue;
      base.amount = first.value;
    }
    if (spec.target) {
      if (!spec.target.seats.length) continue;
      base.seat = spec.target.seats[0];
    }
    if (!spec.select) {
      out.push(base);
      continue;
    }
    const { min, max, cards } = spec.select;
    if (min === 0) out.push({ ...base, cards: [] });
    const n = Math.max(1, min);
    if (n > max || n > cards.length) continue;
    for (let i = 0; i + n <= cards.length; i++) out.push({ ...base, cards: cards.slice(i, i + n) });
  }
  return out.slice(0, MOST);
}
