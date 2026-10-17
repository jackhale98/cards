/**
 * Motion for what isn't a card (the card layer, components/CardLayer.svelte, moves every card on
 * the table, the seats' too): everything marked `data-flip` that merely shifts position (a label
 * as its pile moves, the pot) slides there — translation only, never scaled.
 */

const CSS_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const travel = (dx: number, dy: number) => Math.min(520, 240 + Math.hypot(dx, dy) * 0.35);

/** Positions of `data-flip` elements just before the latest update. */
let lastRects = new Map<Element, DOMRect>();

/** What's already sliding since the latest update (play runs twice: see the table). */
let slid = new WeakSet<Element>();

/**
 * This update moves whole hands about (bridge's dummy and yours trading places): nothing slides;
 * the cards trade places as one calm move (see Frames.calm).
 */
let quiet = false;

/** Record where every `data-flip` element is, right before the DOM updates. */
export function snapshot(root: Element, calm = false) {
  quiet = calm;
  lastRects = new Map();
  slid = new WeakSet();
  root.querySelectorAll('[data-flip]').forEach((el) => lastRects.set(el, el.getBoundingClientRect()));
}

/** After the update, slide every element that moved back from where it was. */
export function play(root: Element) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || quiet) return;
  root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
    const a = lastRects.get(el);
    if (!a || slid.has(el)) return; // new element: its own transition handles it
    // (already gliding there on a transition of its own, as a card in your hand does)
    if (el.getAnimations().some((x) => x instanceof CSSTransition && x.playState === 'running')) return;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    slid.add(el);
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
      duration: travel(dx, dy) * 0.8,
      easing: CSS_EASE,
      composite: 'add',
    });
  });
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
