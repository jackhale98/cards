const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * A pop-up's keyboard (`use:dialog={close}`): focus moves into it (to an element marked
 * `data-autofocus`, or the first thing that takes focus), Tab and Shift+Tab stay inside it, Escape
 * closes it, and focus goes back to whatever opened it when it closes.
 */
export function dialog(node: HTMLElement, onclose: () => void) {
  let close = onclose;
  const back = document.activeElement as HTMLElement | null;
  const focusables = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  requestAnimationFrame(() => {
    if (node.isConnected && !node.contains(document.activeElement))
      (node.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? node).focus({ preventScroll: true });
  });
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  node.addEventListener('keydown', key);
  return {
    update(fn: () => void) {
      close = fn;
    },
    destroy() {
      node.removeEventListener('keydown', key);
      if (back?.isConnected) back.focus({ preventScroll: true });
    },
  };
}
