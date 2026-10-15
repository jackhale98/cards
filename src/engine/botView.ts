import { buildDeck } from './cards';
import { isHidden, redact } from './redact';
import type { Action, GameModule, GameState } from './types';

/**
 * What a bot is allowed to think with: the game as its own seat sees it, never the real deal.
 *
 * The view is the one that seat's device would get (`redact`), with each card it can't see
 * replaced by a card it can't see, at random: the hands keep their sizes and every card is a real
 * one, so any bot (even rules of thumb that glance at another hand) works as before, but can only
 * ever learn made-up cards. Search bots re-deal those cards their own way anyway. The bot's answer
 * comes back through `unfill`, which turns any made-up card it picked (a face-down card on the
 * table, say) back into the placeholder for that spot, for the host to resolve like anyone's move.
 */
export interface BotView<D = unknown> {
  view: GameState<D>;
  unfill: (a: Action) => Action;
}

/** Each game's whole pack (built once: some games use several decks). */
const packs = new WeakMap<object, string[]>();
const packOf = (m: GameModule<unknown>) => {
  let p = packs.get(m.config);
  if (!p) packs.set(m.config, (p = buildDeck(m.config.deck)));
  return p;
};

export function botView<D>(m: GameModule<D>, s: GameState<D>, seat: number, rand: () => number = Math.random): BotView<D> {
  const view = redact(m, s, seat) as GameState<D>;
  // the cards this seat can't see: the whole pack, less every card it can (ids are unique, even
  // across several decks)
  let hidden = 0;
  const seen = new Set<string>();
  for (const z of Object.values(view.zones))
    for (const c of z.cards) {
      if (isHidden(c.id)) hidden++;
      else seen.add(c.id);
    }
  const unseen = hidden ? packOf(m as GameModule<unknown>).filter((id) => !seen.has(id)) : [];
  const back = new Map<string, string>();
  for (const z of Object.values(view.zones))
    z.cards = z.cards.map((c) => {
      if (!isHidden(c.id) || !unseen.length) return c;
      const at = Math.floor(rand() * unseen.length);
      const id = unseen[at];
      unseen[at] = unseen[unseen.length - 1];
      unseen.pop();
      back.set(id, c.id);
      return { ...c, id };
    });
  // (its own dice: the real ones would say how the rest of the pack was shuffled)
  view.rng = Math.floor(rand() * 2 ** 32) as never;
  return {
    view,
    unfill: (a) => (a.cards ? { ...a, cards: a.cards.map((c) => back.get(c) ?? c) } : a),
  };
}
