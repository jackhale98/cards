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
  /** This update moves whole hands about (bridge's dummy and yours trading places): no card flies
   * on its own and nothing slides; the hands' own transitions do it, as one calm move. */
  quiet: boolean;
} = { actor: null, to: null, fromZone: null, toZone: null, quiet: false };

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
  const parent = node.offsetParent as HTMLElement | null;
  node.dataset.pinned = '1';
  node.style.position = 'absolute';
  node.style.width = width;
  node.style.height = height;
  node.style.margin = '0';
  if (parent) {
    // explicit coordinates: an absolutely positioned flex child would otherwise sit at its
    // "static position", which moves as the rest of the row re-centres
    const p = parent.getBoundingClientRect();
    node.style.left = `${a.left - p.left - parent.clientLeft}px`;
    node.style.top = `${a.top - p.top - parent.clientTop}px`;
  }
  const b = node.getBoundingClientRect();
  if (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5) {
    const shift = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
    node.style.transform = node.style.transform ? `${node.style.transform} ${shift}` : shift;
  }
}

/** Where an element was on screen before this update (falls back to where it is now). */
function origin(node: Element): DOMRect {
  return lastRects.get(node) ?? node.getBoundingClientRect();
}

/** The element's own transform split into translation + rotation (hand cards are fanned). */
function ownTransform(node: Element) {
  const t = getComputedStyle(node).transform;
  const m = new DOMMatrixReadOnly(t === 'none' ? undefined : t);
  return { tx: m.e, ty: m.f, angle: Math.atan2(m.b, m.a) };
}

/**
 * Build a move between the element's home (u = 0) and an "away" rectangle (u = 1): where it
 * comes from (intro) or goes to (outro). Rotation unwinds toward away; size matches away.
 * `home` optionally shifts the home end (a leaving card whose row has already moved).
 */
function move(node: HTMLElement, away: DOMRect, opts: { fade?: 'in' | 'out'; scale?: number; home?: { x: number; y: number } } = {}): TransitionConfig {
  const r = node.getBoundingClientRect();
  const { tx, ty, angle } = ownTransform(node);
  const k = opts.scale ?? (r.width ? away.width / r.width : 1);
  const hx = opts.home?.x ?? 0;
  const hy = opts.home?.y ?? 0;
  let dx = center(away).x - center(r).x;
  let dy = center(away).y - center(r).y;
  // transform-origin (hand cards pivot below the card) shifts a scaled card; measure the away
  // end once and correct, so it lines up exactly with the rectangle it comes from / goes to
  // (CSS transitions are paused while probing, or we'd read their starting value)
  const keep = node.style.transform;
  const keepTransition = node.style.transition;
  node.style.transition = 'none';
  node.style.transform = `translate(${dx}px,${dy}px) translate(${tx}px,${ty}px) scale(${k})`;
  const probe = node.getBoundingClientRect();
  node.style.transform = keep;
  void node.offsetWidth; // apply the restore before transitions come back
  node.style.transition = keepTransition;
  dx += center(away).x - center(probe).x;
  dy += center(away).y - center(probe).y;
  const fade = opts.fade;
  return {
    duration: travel(dx, dy),
    easing: EASE,
    css: (t, u) =>
      `z-index:30;transform:translate(${u * dx + t * hx}px,${u * dy + t * hy}px) translate(${tx}px,${ty}px) rotate(${angle * t}rad) scale(${1 + (k - 1) * u})` +
      (fade === 'in' ? `;opacity:${Math.min(1, t * 3)}` : fade === 'out' ? `;opacity:${Math.min(1, t * 2)}` : ''),
  };
}

/** Glide `node` (already in its final place) from the rectangle `from`. */
function glide(from: DOMRect, node: HTMLElement): TransitionConfig {
  return move(node, from);
}

/**
 * No visible counterpart. Cards drawn from / put onto a pile fly solidly between the pile and
 * their spot, matching the pile's card size. Cards going to or coming from someone's hidden hand
 * fly to/from their seat, shrinking and fading. Otherwise, a short fade.
 */
function fallback(node: HTMLElement, intro: boolean): TransitionConfig {
  const pile = intro ? flight.fromZone : flight.toZone;
  const seat = intro ? flight.actor : (flight.to ?? flight.actor);
  const target = pile ?? seat;
  if (target) {
    // a leaving card starts from where it was before the update, even if its row has shifted
    const r = node.getBoundingClientRect();
    const was = intro ? r : origin(node);
    const home = { x: center(was).x - center(r).x, y: center(was).y - center(r).y };
    // a pile is drawn with real cards (match its size, stay opaque); a seat is a small avatar
    const scale = pile ? undefined : 0.45;
    return move(node, target, { scale, home, fade: pile ? undefined : intro ? 'in' : 'out' });
  }
  const { tx, ty, angle } = ownTransform(node);
  return {
    duration: 240,
    easing: EASE,
    css: (t, u) => `opacity:${t};transform:translate(${tx}px,${ty + u * -16}px) rotate(${angle}rad) scale(${0.9 + 0.1 * t})`,
  };
}

const sending = new Map<string, HTMLElement>();
const receiving = new Map<string, HTMLElement>();

/** Undo pin()/hide if an element that was leaving comes back (e.g. a quick undo). */
function unpin(node: HTMLElement) {
  node.style.visibility = '';
  if (!node.dataset.pinned) return;
  delete node.dataset.pinned;
  for (const prop of ['position', 'width', 'height', 'margin', 'transform', 'left', 'top'] as const) node.style[prop] = '';
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
      if (flight.quiet) {
        mine.delete(params.key);
        theirs.delete(params.key);
        if (!intro) node.style.visibility = 'hidden';
        return { duration: 0 };
      }
      const other = theirs.get(params.key);
      if (other) {
        theirs.delete(params.key);
        if (intro) return glide(origin(other), node);
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

/** Positions of `data-flip` elements just before the latest update (also used by card moves). */
let lastRects = new Map<Element, DOMRect>();

/** What's already sliding since the latest update (play runs twice: see the table). */
let slid = new WeakSet<Element>();

/** Record where every `data-flip` element is, right before the DOM updates. */
export function snapshot(root: Element) {
  lastRects = new Map();
  slid = new WeakSet();
  root.querySelectorAll('[data-flip]').forEach((el) => lastRects.set(el, el.getBoundingClientRect()));
}

/** After the update, slide every element that moved back from where it was. */
export function play(root: Element) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || flight.quiet) return;
  root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
    const a = lastRects.get(el);
    if (!a || slid.has(el)) return; // new element: its own transition handles it
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
