import type { Page } from '@playwright/test';

/**
 * The screen audit's layout check (e2e/audit.spec.ts), also used by tests of their own: anything
 * off-screen, overlapping what it shouldn't, with its text cut off, or too small to touch or read.
 * The cards are drawn by the card layer (`.layer`: see src/ui/components/CardLayer.svelte), each
 * where its frame (the zone or hand it's laid out in) puts it: a card is in your hand or in the
 * middle as its frame is. Cards on their way out (`data-leaving`) don't count.
 */
/** Everything wrong with the layout as it stands. */
export async function screenProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const W = innerWidth;
    const H = innerHeight;
    const shown = (el: Element) => {
      const r = rect(el);
      const st = getComputedStyle(el);
      // (a card on the layer fades as a whole, and one on its way out isn't on the table)
      const lc = el.closest<HTMLElement>('.layer .layer-card');
      if (lc && (lc.dataset.leaving || Number(getComputedStyle(lc).opacity) <= 0.05)) return false;
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
    };
    /** Where a card on the layer is laid out: its frame (your hand's fan, or a zone). */
    const frameOf = (el: Element): Element | null => {
      const lc = el.closest<HTMLElement>('.layer .layer-card');
      if (!lc) return null;
      return lc.dataset.frame === 'hand'
        ? lc.closest('.table')!.querySelector('footer .hand')
        : lc.closest('.table')!.querySelector(`.zone[data-zone="${CSS.escape(lc.dataset.in ?? '')}"]`);
    };
    const inHand = (el: Element) => !!el.closest('footer') || !!frameOf(el)?.closest('footer');
    const name = (el: Element) => {
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter((c) => c && !c.startsWith('s-'))[0] : '';
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
    };
    // what shows of an element: its box cut down to any scrolling or clipping box around it
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      let { left, top, right, bottom } = r;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
        const c = p.getBoundingClientRect();
        if (st.overflowX !== 'visible') {
          left = Math.max(left, c.left);
          right = Math.min(right, c.right);
        }
        if (st.overflowY !== 'visible') {
          top = Math.max(top, c.top);
          bottom = Math.min(bottom, c.bottom);
        }
      }
      // (a card on the layer in a row that scrolls is clipped to what shows of the row: its clip-path)
      const lc = el.closest<HTMLElement>('.layer .layer-card');
      const inset = lc && /inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px\)/.exec(lc.style.clipPath);
      if (lc && inset) {
        const b = lc.getBoundingClientRect();
        top = Math.max(top, b.top + Number(inset[1]));
        right = Math.min(right, b.right - Number(inset[2]));
        bottom = Math.min(bottom, b.bottom - Number(inset[3]));
        left = Math.max(left, b.left + Number(inset[4]));
      }
      return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    };
    const meets = (a: DOMRect, b: DOMRect, slack = 2) =>
      a.left < b.right - slack && b.left < a.right - slack && a.top < b.bottom - slack && b.top < a.bottom - slack;
    // a sheet or banner covers the table on purpose: check only what's in it
    const sheet = document.querySelector('.sheet');
    const root: ParentNode = sheet ?? document;

    // 1. nothing off-screen
    // (inside something that scrolls, out of view is fine: you scroll to it)
    const scrolls = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (/(auto|scroll)/.test(st.overflowY + st.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return true;
      }
      return document.scrollingElement!.scrollHeight > H + 1;
    };
    const edge = (sel: string) =>
      root.querySelectorAll(sel).forEach((el) => {
        if (!shown(el) || scrolls(el)) return;
        if (el.closest('.seats, .strip')) return;
        const r = rect(el);
        // a hand of cards may sit a little below the screen's edge (its corners show)
        const handCard = inHand(el);
        const bottom = handCard ? r.top + r.height * 0.65 : r.bottom;
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || bottom > H + 1)
          out.push(`off-screen: ${name(el)} at ${Math.round(r.left)},${Math.round(r.top)}→${Math.round(r.right)},${Math.round(r.bottom)}`);
      });
    edge('button, .btn, .card, .headline, .last, .label, .banner, .sheet, .track, .me, aside, input, select');

    // 2. no text cut off inside its box (an ellipsis or a clipped line), in anything showing
    root
      .querySelectorAll('button, .btn, .headline, .last span, .label, .badge, .eyebrow, h1, h2, h3, p, li, b, td, th, .name, .me *, .seat-slot *')
      .forEach((el) => {
        if (!shown(el) || !(el.textContent ?? '').trim()) return;
        if (el.closest('.seats') && !el.closest('.seat-slot')) return;
        // (a line that glides along its box to show the rest: see src/ui/marquee.ts)
        if (el.closest('.moving')) return;
        const st = getComputedStyle(el);
        const clips = (o: string) => o === 'hidden' || o === 'clip';
        const wide = el.scrollWidth > el.clientWidth + 1 && (clips(st.overflowX) || st.textOverflow === 'ellipsis');
        const tall = el.scrollHeight > el.clientHeight + 2 && (clips(st.overflowY) || st.webkitLineClamp !== 'none');
        if (wide || tall) out.push(`text cut off: ${name(el)} (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`);
      });

    // 2b. no label spilling out of its button (nothing clips it, so 2 doesn't see it)
    root.querySelectorAll('button, .btn').forEach((el) => {
      // (a pile of cards isn't a label: its cards fan out past the pile on purpose)
      if (!shown(el) || !(el.textContent ?? '').trim() || el.querySelector('.card')) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (t.width && (t.left < b.left - 1 || t.right > b.right + 1))
        out.push(`text past its button: ${name(el)} (${Math.round(t.width)} wide in ${Math.round(b.width)})`);
    });

    if (!sheet) {
      // 3. nothing overlapping that shouldn't
      const all = (sel: string) => [...document.querySelectorAll(sel)].filter(shown);
      const cards = all('.table:not(.display) .card').filter((c) => !c.closest('header'));
      const center = cards.filter((c) => (c.closest('main') ?? frameOf(c)?.closest('main')) && !inHand(c));
      const hand = cards.filter(inHand);
      const buttons = all('.table:not(.display) aside button');
      // (whose turn it is and the last move: above the middle, or on a phone in the column on the left)
      const text = all('.table:not(.display) .headline, .table:not(.display) .last, .table:not(.display) main .track');
      const seats = all('.table:not(.display) header .seat-slot');
      // (your name and status: the column's own part, below whose turn it is when that's there too)
      const me = all('.table:not(.display) .me-own');
      const labels = all('.table:not(.display) main .zones .label');
      // (the hand's summary, at the end of a hand: under the middle, or in the column on the left)
      const recap = all('.table:not(.display) .recap');
      const banner = document.querySelector('.banner');
      const covered = (el: Element) => banner && shown(banner) && meets(rect(el), rect(banner), 0);
      const pairs: [string, Element[], Element[]][] = [
        ['a card in the middle and your hand', center, hand],
        ['a card in the middle and a button', center, buttons],
        ['a card in the middle and the headline', center, text],
        ['a card in the middle and a seat', center, seats],
        ['your hand and a button', hand, buttons],
        ['your hand and your name', hand, me],
        ['a card in the middle and your name', center, me],
        ['the headline and your name', text, me],
        ['a button and your name', buttons, me],
        ['the headline and a seat', text, seats],
        ['a button and a seat', buttons, seats],
        ["a card in the middle and the hand's summary", center, recap],
        ["your hand and the hand's summary", hand, recap],
      ];
      for (const [what, as, bs] of pairs) {
        let n = 0;
        for (const a of as)
          for (const b of bs) {
            if (a === b || a.contains(b) || b.contains(a) || covered(a) || covered(b)) continue;
            if (meets(rect(a), rect(b)) && n++ < 2) out.push(`overlap, ${what}: ${name(a)} / ${name(b)}`);
          }
      }
      // a zone's label clear of the other zones' cards; zones clear of each other
      // (a card on the layer belongs to the zone it's laid out in)
      const zoneOf = (el: Element) => (frameOf(el) ?? el).closest('.zone-slot, .strip > *');
      for (const l of labels)
        for (const c of center)
          if (zoneOf(l) !== zoneOf(c) && meets(rect(l), rect(c))) {
            out.push(`overlap, a label and another pile's card: ${name(l)} / ${name(c)}`);
            break;
          }
      const slots = all('.table:not(.display) main .zones > .zone-slot');
      for (let i = 0; i < slots.length; i++)
        for (let j = i + 1; j < slots.length; j++)
          if (meets(rect(slots[i]), rect(slots[j]))) out.push(`overlap, two piles: ${name(slots[i])} / ${name(slots[j])}`);
      // the action buttons all inside their column
      const aside = document.querySelector('.table:not(.display) aside');
      if (aside)
        for (const btn of all('.table:not(.display) aside button')) {
          const a = rect(aside);
          const r = rect(btn);
          if (r.top < a.top - 1 || r.bottom > a.bottom + 1 || r.left < a.left - 1 || r.right > a.right + 1)
            out.push(`a button outside its column: ${name(btn)}`);
        }
    }
    // 4. big enough to touch: buttons at least 44×44 (Apple; Google asks 48), never under 24 (WCAG 2.5.8);
    // an overlapped card needs a strip of at least 28px showing to tap it
    root.querySelectorAll('button:not(:disabled), a.btn, [role="button"], input, select').forEach((el) => {
      if (!shown(el) || el.closest('.scrim') || el.classList.contains('scrim') || el.closest('.slot, .scard, .stack, .layer-card')) return;
      const r = rect(el);
      const small = Math.min(r.width, r.height);
      if (small < 24) out.push(`too small to touch: ${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      else if (small < 44) out.push(`small to touch (under 44): ${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    });
    // (what you tap: each card's place in your hand or a zone, under the card the layer draws there)
    const strips = (sel: string, what: string) => {
      const els = [...document.querySelectorAll(sel)].filter(shown);
      els.forEach((el, i) => {
        const next = els[i + 1];
        if (!next || el.parentElement !== next.parentElement) return;
        const r = rect(el);
        const strip = Math.min(r.width, rect(next).left - r.left);
        if (strip > 0 && strip < 28) out.push(`hard to touch: ${what} with ${Math.round(strip)}px showing (${name(el)})`);
      });
    };
    if (!sheet) {
      strips('.table:not(.display) footer .hand .slot', 'a card in your hand');
      strips('.table:not(.display) main .zones .scard:not(:disabled)', 'a card you can pick on the table');
    }
    // 5. big enough to read, touched or not: text at least 11px (Apple's smallest, for captions),
    // never under 9; a face-up card at least 30px wide, or its corner's rank and suit can't be read
    root.querySelectorAll('*').forEach((el) => {
      if (!shown(el) || el.closest('.scrim')) return;
      const own = [...el.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim());
      // (not the drawings on game icons or the avatars' pictures, and not inside a card: a card is measured as a whole, below)
      if (!own || el.closest('.card, .game-icon, .av')) return;
      const px =
        parseFloat(getComputedStyle(el).fontSize) *
        (el instanceof SVGElement
          ? (el.ownerSVGElement ?? (el as SVGSVGElement)).getBoundingClientRect().width /
            Math.max(
              1,
              (el.ownerSVGElement ?? (el as SVGSVGElement)).viewBox.baseVal?.width ||
                (el.ownerSVGElement ?? (el as SVGSVGElement)).getBoundingClientRect().width,
            )
          : 1);
      if (px < 9) out.push(`too small to read: ${name(el)} at ${px.toFixed(1)}px`);
      else if (px < 11) out.push(`small to read (under 11px): ${name(el)} at ${px.toFixed(1)}px`);
    });
    root.querySelectorAll('.card:not(.back)').forEach((el) => {
      if (!shown(el)) return;
      const w = el.getBoundingClientRect().width;
      if (w < 30)
        out.push(
          `hard to read: a face-up card ${Math.round(w)}px wide (${el.closest('header') ? 'in a seat' : inHand(el) ? 'in your hand' : 'on the table'}: ${el.getAttribute('aria-label')})`,
        );
    });

    // 5b. whose turn it is, in the column on the left, shows whole: not cut off by the column (the
    // last move may give way, but only whole, never half a line)
    document.querySelectorAll('.table:not(.display) .side-status').forEach((box) => {
      const b = box.getBoundingClientRect();
      box.querySelectorAll('.headline, .last').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height && r.top < b.bottom - 1 && r.bottom > b.bottom + 1) out.push(`text cut off: ${name(el)} runs past the bottom of its column`);
      });
    });

    // 6. the buttons run down beside your hand only when they don't fit beside the middle (and not
    // in a replay or hand mode, which always have them there): otherwise your hand loses its width
    const table = document.querySelector('.table:not(.display):not(.handmode)');
    const mainEl = table?.querySelector('main');
    if (table?.classList.contains('tall-actions') && mainEl && !table.querySelector('.replay')) {
      const btns = [...table.querySelectorAll('aside > .bar > .btn, aside > .replay-quick')].filter(shown);
      const used = btns.reduce((h, b) => h + b.getBoundingClientRect().height + 7, 0);
      if (btns.length && used < mainEl.getBoundingClientRect().height - 8)
        out.push(
          `buttons beside your hand though they'd fit beside the middle (${btns.length} buttons, ${Math.round(used)}px in ${Math.round(mainEl.getBoundingClientRect().height)}px)`,
        );
    }

    if (document.documentElement.scrollWidth > W + 1) out.push(`page wider than the screen: ${document.documentElement.scrollWidth}px`);
    return [...new Set(out)];
  });
}
