import { cubicOut } from 'svelte/easing';
import { crossfade } from 'svelte/transition';

/**
 * Where the current move came from: the seat (or your hand) of the player who just acted.
 * Set by the table right before each update, so a card that leaves for a hidden hand flies
 * toward that player, and a card played from a hidden hand flies in from them.
 */
export const flight: { actor: DOMRect | null; to: DOMRect | null } = { actor: null, to: null };

/**
 * Cards keyed by id glide between zones (hand → trick, deck → hand …). Cards with no visible
 * counterpart (an opponent's hidden card) fly to/from the acting player's seat instead.
 */
export const [send, receive] = crossfade({
  duration: (d) => Math.min(520, 220 + Math.sqrt(d) * 12),
  easing: cubicOut,
  fallback(node, _params, intro) {
    const t0 = getComputedStyle(node).transform;
    const base = t0 === 'none' ? '' : t0;
    // arriving cards come from the actor; leaving cards go to the recipient (or the actor, who took them)
    const actor = intro ? flight.actor : (flight.to ?? flight.actor);
    if (actor) {
      const r = node.getBoundingClientRect();
      const dx = actor.left + actor.width / 2 - (r.left + r.width / 2);
      const dy = actor.top + actor.height / 2 - (r.top + r.height / 2);
      return {
        duration: 420,
        easing: cubicOut,
        // t runs 0→1 when arriving and 1→0 when leaving, so (1 - t) is "how far toward the seat"
        css: (t) =>
          `transform:translate(${(1 - t) * dx}px,${(1 - t) * dy}px) ${base} scale(${0.45 + 0.55 * t});opacity:${Math.min(1, t * (intro ? 3 : 2))}`,
      };
    }
    return {
      duration: 260,
      easing: cubicOut,
      css: (t) => `opacity:${t};transform:${base} translateY(${(1 - t) * -24}px) scale(${0.85 + 0.15 * t})`,
    };
  },
});

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
