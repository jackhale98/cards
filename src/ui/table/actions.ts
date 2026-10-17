/** Svelte actions the table puts on its elements: they watch the page, not the game. */

interface FitOpts {
  /** A table screen: the middle may run a few percent past its box, and its room sizes the cards. */
  display: boolean;
  /** The room under the headline (a table screen sizes its cards to it: see displayCw). */
  onroom: (room: number) => void;
}

/**
 * The safety net under the table's sizes (sizing.svelte.ts): if the middle's cards still come out taller
 * than the room under the headline (labels grow during play; a row wraps that wasn't expected),
 * they're drawn smaller to fit. A transform doesn't change the layout, so measuring it can't
 * set off another round.
 */
export function fitHeight(el: HTMLElement, opts: FitOpts) {
  let { display, onroom } = opts;
  const main = el.parentElement!;
  // The content's own size, from where its piles sit in the layout (offset sizes: a card in
  // flight is drawn transformed, outside its pile, and must not count, or the middle shrinks
  // for the length of every move and springs back). The box itself may be squeezed to the room
  // while its piles spill out of it, so it's the children that are measured.
  const extent = () => {
    let top = Infinity;
    let bottom = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const c of [...el.children] as HTMLElement[]) {
      if (c.dataset.pinned || !c.offsetWidth) continue;
      top = Math.min(top, c.offsetTop);
      bottom = Math.max(bottom, c.offsetTop + c.offsetHeight);
      // (a table screen's strip may reach past the middle's sides on purpose: its height counts, not its width)
      if (c.dataset.wide) continue;
      left = Math.min(left, c.offsetLeft);
      right = Math.max(right, c.offsetLeft + c.offsetWidth);
    }
    // (offsets are from the middle (main), as is the box's own top)
    return Number.isFinite(top) ? { h: bottom - Math.min(top, el.offsetTop), w: right - left } : { h: 0, w: 0 };
  };
  const fit = () => {
    // (anything below the piles in the middle, the hand's summary say, keeps its room; not what
    // floats over the table, the result banner)
    let below = 0;
    for (let c = el.nextElementSibling as HTMLElement | null; c; c = c.nextElementSibling as HTMLElement | null)
      if (c.offsetHeight && !['absolute', 'fixed'].includes(getComputedStyle(c).position)) below += c.offsetHeight + 6;
    const room = main.clientHeight - el.offsetTop - below;
    // (a table screen sizes its cards to this room: see displayCw)
    if (display) onroom(room);
    const { h, w } = extent();
    // (too tall, or too wide: a showdown's two seven-card hands side by side on a phone)
    // (nothing in the middle, hand mode between moves say: nothing to fit)
    const k = h ? Math.min(1, room / h, main.clientWidth / Math.max(1, w, el.offsetWidth)) : 1;
    // (a table screen lets the middle run a few percent past its box into the oval, rather than
    // shrink everything by a hair and back as melds land)
    const want = display && k >= 0.96 ? 1 : Math.max(0.6, Math.min(1, k));
    // (back to full size at once; smaller only once it's lasted a moment, so the brief overflow
    // as a meld lands, before the sizes catch up, doesn't make the middle twitch. A pile that
    // has just appeared, bridge's dummy, is drawn at its size from the start.)
    clearTimeout(settle);
    const set = () => (el.style.transform = want < 0.999 ? `scale(${want.toFixed(3)})` : '');
    const now = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
    const piles = el.children.length;
    if (want >= now || piles !== seen) set();
    else settle = window.setTimeout(set, 250);
    seen = piles;
  };
  let settle = 0;
  let frame = 0;
  let seen = el.children.length;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  const ro = new ResizeObserver(later);
  ro.observe(el);
  ro.observe(main);
  // (a card or a longer label changes what's inside without changing the box)
  const mo = new MutationObserver(later);
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  // (and what comes and goes below it: the hand's summary)
  mo.observe(main, { childList: true });
  return {
    update: (o: FitOpts) => ({ display, onroom } = o),
    destroy: () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      ro.disconnect();
      mo.disconnect();
    },
  };
}
/**
 * A row that scrolls sideways (everyone's melds, face-up cards) fades out at an edge with more
 * beyond it, so a third player's cards past the edge aren't simply missing.
 */
export function edgeFade(el: HTMLElement) {
  const update = () => {
    el.classList.toggle('more-left', el.scrollLeft > 2);
    el.classList.toggle('more-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };
  update();
  const ro = new ResizeObserver(update);
  ro.observe(el);
  for (const c of el.children) ro.observe(c);
  const mo = new MutationObserver(update);
  mo.observe(el, { childList: true, subtree: true });
  el.addEventListener('scroll', update, { passive: true });
  return {
    destroy() {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', update);
    },
  };
}
