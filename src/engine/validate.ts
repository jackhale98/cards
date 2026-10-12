import type { Action, ActionSpec } from './types';

/**
 * Check an action from the network against what the rules offered the player, and return a clean
 * copy holding only the fields that action may carry (or an error). Rules modules may then trust
 * an action's shape: its cards are ones that could be selected, in an allowed number, its amount
 * is a finite number in range (or one of the choices), its seat one of the targets.
 *
 * The host runs every action through this, from people and bots alike, before `apply`.
 */
export function checkAction(raw: unknown, offered: ActionSpec[]): { action: Action } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'That move isn’t available right now' };
  const a = raw as Record<string, unknown>;
  const specs = offered.filter((s) => s.type === a.type);
  if (typeof a.type !== 'string' || !specs.length) return { error: 'That move isn’t available right now' };
  let last = 'That move isn’t available right now';
  // (a type can be offered more than once, e.g. play onto different piles: any one may fit)
  for (const spec of specs) {
    const r = against(a, spec);
    if ('action' in r) return r;
    last = r.error;
  }
  return { error: last };
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function against(a: Record<string, unknown>, spec: ActionSpec): { action: Action } | { error: string } {
  const out: Action = { type: spec.type };
  if (spec.select) {
    const cards = a.cards;
    if (!Array.isArray(cards) || !cards.every((c) => typeof c === 'string')) return { error: 'Pick some cards first' };
    if (new Set(cards).size !== cards.length) return { error: 'That card is picked twice' };
    if (cards.length < spec.select.min || cards.length > spec.select.max) return { error: 'Wrong number of cards for that' };
    const allowed = new Set(spec.select.cards);
    if (!cards.every((c) => allowed.has(c))) return { error: 'You can’t use that card for this' };
    out.cards = [...cards];
  }
  if (spec.amount) {
    if (!num(a.amount)) return { error: 'Choose an amount' };
    if (a.amount < spec.amount.min || a.amount > spec.amount.max) return { error: `Choose between ${spec.amount.min} and ${spec.amount.max}` };
    out.amount = a.amount;
  } else if (spec.choose) {
    const pick = spec.choose.options.find((o) => o.value === a.amount && !o.disabled);
    if (!pick) return { error: 'Choose one of the options' };
    out.amount = pick.value;
  }
  if (spec.target) {
    if (!num(a.seat) || !spec.target.seats.includes(a.seat)) return { error: 'Choose a player' };
    out.seat = a.seat;
  }
  if (typeof a.zone === 'string' && a.zone.length <= 40) out.zone = a.zone;
  if (num(a.race)) out.race = a.race;
  if (num(a.rt)) out.rt = a.rt;
  return { action: out };
}
