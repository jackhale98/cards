import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Card motion.
 *
 * 1. `send` / `receive`: a card that moves between zones (hand → table, table → hand…) glides
 *    as ONE solid card from where it was to where it lands. The copy it leaves behind is hidden
 *    at once and lifted out of the layout, so there is no see-through double image and the
 *    remaining cards can start closing the gap immediately.
 * 2. Cards with no visible counterpart (an opponent's hidden card) fly to/from the seat of the
 *    player who acted (`flight`).
 * 3. `snapshot` / `play`: everything marked `data-flip` that merely shifts position (a row closing
 *    a gap, a zone re-centring) slides there — translation only, never scaled.
 */

/** Where the current move came from / goes to; set by the table right before each update. */
export const flight: {
  actor: DOMRect | null;
  to: DOMRect | null;
  fromZone: DOMRect | null;
  toZone: DOMRect | null;
} = { actor: null, to: null, fromZone: null, toZone: null };

const EASE = cubicOut;
const CSS_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const travel = (dx: number, dy: number) => Math.min(520, 240 + Math.hypot(dx, dy) * 0.35);
const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Take a leaving element out of the layout without moving it on screen (like Svelte's animate). */
function pin(node: HTMLElement) {
  const style = getComputedStyle(node);
  if (style.position === 'absolute' || style.position === 'fixed') return;
  const { width, height } = style;
  const a = node.getBoundingClientRect();
  node.dataset.pinned = '1';
  node.style.position = 'absolute';
  node.style.width = width;
  node.style.height = height;
  node.style.margin = '0';
  const b = node.getBoundingClientRect();
  if (a.left !== b.left || a.top !== b.top) {
    const shift = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
    node.style.transform = node.style.transform ? `${node.style.transform} ${shift}` : shift;
  }
}

/** Glide `node` (already in its final place) from the rectangle `from`. */
function glide(from: DOMRect, node: Element): TransitionConfig {
  const to = node.getBoundingClientRect();
  const a = center(from);
  const b = center(to);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const scale = to.width ? from.width / to.width : 1;
  const base = getComputedStyle(node).transform;
  const rest = base === 'none' ? '' : base;
  return {
    duration: travel(dx, dy),
    easing: EASE,
    css: (_t, u) =>
      `z-index:30;transform:translate(${u * dx}px,${u * dy}px) ${rest} scale(${1 + (scale - 1) * u})`,
  };
}

/**
 * No visible counterpart. Cards drawn from / put onto a pile fly solidly between the pile and
 * their spot, matching the pile's card size. Cards going to or coming from someone's hidden hand
 * fly to/from their seat, shrinking and fading. Otherwise, a short fade.
 */
function fallback(node: Element, intro: boolean): TransitionConfig {
  const base = getComputedStyle(node).transform;
  const rest = base === 'none' ? '' : base;
  const pile = intro ? flight.fromZone : flight.toZone;
  const seat = intro ? flight.actor : (flight.to ?? flight.actor);
  const target = pile ?? seat;
  if (target) {
    const r = node.getBoundingClientRect();
    const dx = center(target).x - center(r).x;
    const dy = center(target).y - center(r).y;
    // a pile is drawn with real cards: end/start at that size, fully opaque
    const endScale = pile && r.width ? Math.min(1.5, Math.max(0.4, target.width / r.width)) : 0.45;
    return {
      duration: travel(dx, dy),
      easing: EASE,
      css: (t, u) =>
        `z-index:30;transform:translate(${u * dx}px,${u * dy}px) ${rest} scale(${1 + (endScale - 1) * u})` +
        (pile ? '' : `;opacity:${Math.min(1, t * (intro ? 3 : 2))}`),
    };
  }
  return {
    duration: 240,
    easing: EASE,
    css: (t, u) => `opacity:${t};transform:${rest} translateY(${u * -16}px) scale(${0.9 + 0.1 * t})`,
  };
}

const sending = new Map<string, HTMLElement>();
const receiving = new Map<string, HTMLElement>();

/** Undo pin()/hide if an element that was leaving comes back (e.g. a quick undo). */
function unpin(node: HTMLElement) {
  node.style.visibility = '';
  if (!node.dataset.pinned) return;
  delete node.dataset.pinned;
  for (const prop of ['position', 'width', 'height', 'margin', 'transform'] as const) node.style[prop] = '';
}

function pair(intro: boolean) {
  const mine = intro ? receiving : sending;
  const theirs = intro ? sending : receiving;
  return (node: HTMLElement, params: { key: string }) => {
    mine.set(params.key, node);
    if (intro) unpin(node);
    else pin(node);
    // decided once both sides of the move have registered
    return () => {
      const other = theirs.get(params.key);
      if (other) {
        theirs.delete(params.key);
        if (intro) return glide(other.getBoundingClientRect(), node);
        // hide the copy left behind right now (not one frame later via the animation)
        node.style.visibility = 'hidden';
        return { duration: travel(0, 0), css: () => 'opacity:0' };
      }
      mine.delete(params.key);
      return fallback(node, intro);
    };
  };
}

export const send = pair(false);
export const receive = pair(true);

// ---- layout shifts ----------------------------------------------------------------------

let before = new Map<Element, DOMRect>();

/** Record where every `data-flip` element is, right before the DOM updates. */
export function snapshot(root: Element) {
  before = new Map();
  root.querySelectorAll('[data-flip]').forEach((el) => before.set(el, el.getBoundingClientRect()));
}

/** After the update, slide every element that moved back from where it was. */
export function play(root: Element) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
    const a = before.get(el);
    if (!a) return; // new element: its own transition handles it
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
      duration: travel(dx, dy) * 0.8,
      easing: CSS_EASE,
      composite: 'add',
    });
  });
  before = new Map();
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
