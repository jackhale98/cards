import type { Labels } from './layout/table';

/**
 * Measures labels as the table draws them (a zone's `.label.eyebrow`: small capitals, spaced, on
 * one line), so the table's sizes (layout/table.ts) know how wide a pile's label makes it. One
 * hidden element off screen; widths remembered by text (and the root font size: a table screen
 * sizes everything to the screen).
 */
let probe: HTMLSpanElement | null = null;
const widths = new Map<string, number>();

function element(): HTMLSpanElement {
  if (probe?.isConnected) return probe;
  probe = document.createElement('span');
  probe.className = 'eyebrow';
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', whiteSpace: 'nowrap', fontSize: '0.7rem' });
  document.body.appendChild(probe);
  return probe;
}

const lines = new Map<string, number>();
const rootSize = () => getComputedStyle(document.documentElement).fontSize;

export function labelMeasure(): Labels {
  return {
    get lineH() {
      const rem = rootSize();
      let h = lines.get(rem);
      if (h == null) {
        const el = element();
        el.textContent = 'Ag';
        h = el.offsetHeight;
        lines.set(rem, h);
      }
      return h;
    },
    width: (text: string) => {
      const key = `${rootSize()}|${text}`;
      let w = widths.get(key);
      if (w == null) {
        const el = element();
        el.textContent = text;
        w = el.offsetWidth;
        widths.set(key, w);
      }
      return w;
    },
  };
}
