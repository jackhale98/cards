import { cubicOut } from 'svelte/easing';
import { crossfade } from 'svelte/transition';

/**
 * Cards keyed by id glide between zones (hand → trick, deck → hand …). Cards that appear
 * from nowhere (e.g. an opponent's hidden card becoming visible) fade/scale in instead.
 */
export const [send, receive] = crossfade({
  duration: (d) => Math.min(520, 180 + Math.sqrt(d) * 12),
  easing: cubicOut,
  fallback(node) {
    const t0 = getComputedStyle(node).transform;
    const base = t0 === 'none' ? '' : t0;
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
