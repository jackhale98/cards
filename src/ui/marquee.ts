/**
 * A line too long for its space glides along by itself: a pause at the start, slowly across to
 * the end, a pause, and back. How far it goes (and so how long it takes) is measured here. It
 * rests after a few passes (battery); a tap plays it again, and so does new text.
 *
 * The element holds one child (the text, `display: inline-block`); its CSS animates that child
 * with `--over` (how far) and `--cycle` (how long) once it has the class `moving`.
 */
export function marquee(el: HTMLElement) {
  const SPEED = 30; // px a second
  const run = () => el.firstElementChild as HTMLElement | null;
  const update = () => {
    const r = run();
    if (!r) return;
    // (the box's own overflow, rounded up as the browser rounds it: a line a pixel too long glides too)
    const moving = el.scrollWidth > el.clientWidth + 1;
    el.classList.toggle('moving', moving);
    // far enough that the last letter ends up clear of the soft right edge (and the padding)
    const css = getComputedStyle(el);
    const room = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const fade = parseFloat(css.getPropertyValue('--fade')) || 0;
    const over = moving ? Math.ceil(r.offsetWidth - room + fade) : 0;
    el.style.setProperty('--over', `${-over}px`);
    // the glide out takes half the cycle
    el.style.setProperty('--cycle', `${Math.max(6, (over / SPEED) * 2).toFixed(1)}s`);
  };
  const replay = () =>
    run()
      ?.getAnimations?.()
      .forEach((a) => (a.cancel(), a.play()));
  update();
  const ro = new ResizeObserver(update);
  ro.observe(el);
  if (run()) ro.observe(run()!);
  // (new text: measure again, and start from the beginning)
  const mo = new MutationObserver(() => {
    update();
    replay();
  });
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  el.addEventListener('pointerdown', replay);
  return {
    destroy: () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('pointerdown', replay);
    },
  };
}
