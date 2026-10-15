import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cardsLanded } from './wait';

/**
 * The screen audit (not part of the usual run): every game played through its stages at a small
 * phone and a large screen, the player's own seat driven by a bot (window.__botMove, development
 * builds only). At each new stage the layout is checked (anything off-screen, overlapping or with
 * its text cut off) and a screenshot kept for a person to look over.
 *
 *   pnpm audit:screens                           every game (about an hour on 4 cores)
 *   AUDIT_GAMES=holdem,omaha pnpm audit:screens  just these (a few minutes each)
 *
 * Audit the games a change touches; every game only when it changes the table for all of them
 * (src/ui/screens/Table.svelte, the shared components, the theme).
 *
 * Findings land in AUDIT_OUT/<game>/<run>.json (default audit/), screenshots beside them.
 */
test.skip(!process.env.AUDIT, 'the screen audit runs on request (AUDIT=1)');
test.setTimeout(240_000);

const OUT = process.env.AUDIT_OUT ?? 'audit';
const ONLY = process.env.AUDIT_GAMES?.split(',');

interface GameJson {
  id: string;
  name: string;
  players: { min: number; max: number; recommended?: number; counts?: number[] };
}
const GAMES: GameJson[] = readdirSync('src/games', { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'freetable')
  .map((d) => JSON.parse(readFileSync(`src/games/${d.name}/game.json`, 'utf8')) as GameJson)
  .filter((g) => !ONLY || ONLY.includes(g.id));

const allowed = (g: GameJson, n: number) => (g.players.counts ? g.players.counts.includes(n) : n >= g.players.min && n <= g.players.max);
const recommended = (g: GameJson) => {
  const want = g.players.recommended ?? Math.max(g.players.min, Math.min(4, g.players.max));
  return allowed(g, want) ? want : (g.players.counts?.at(-1) ?? g.players.min);
};
const most = (g: GameJson) => Math.min(8, g.players.counts ? Math.max(...g.players.counts) : g.players.max);
// (the fewest players: often the biggest hands)
const fewest = (g: GameJson) => (g.players.counts ? Math.min(...g.players.counts) : Math.max(2, g.players.min));

const SIZES = {
  // a phone in landscape with the browser's bars showing
  small: { width: 667, height: 320 },
  // a laptop or tablet
  large: { width: 1280, height: 800 },
};

/** Everything wrong with the layout as it stands. */
async function check(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const W = innerWidth;
    const H = innerHeight;
    const shown = (el: Element) => {
      const r = rect(el);
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
    };
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
        const handCard = !!el.closest('footer .hand, footer .hand-wrap');
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
      const center = all('.table:not(.display) main .zones .card');
      const hand = all('.table:not(.display) footer .card');
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
      const zoneOf = (el: Element) => el.closest('.zone-slot, .strip > *');
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
      if (!shown(el) || el.closest('.scrim') || el.classList.contains('scrim') || el.closest('.slot, .scard, .stack')) return;
      const r = rect(el);
      const small = Math.min(r.width, r.height);
      if (small < 24) out.push(`too small to touch: ${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      else if (small < 44) out.push(`small to touch (under 44): ${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    });
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
          `hard to read: a face-up card ${Math.round(w)}px wide (${el.closest('header') ? 'in a seat' : el.closest('footer') ? 'in your hand' : 'on the table'}: ${el.getAttribute('aria-label')})`,
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

/** A short name for the stage the table is at: the phase, the headline's words, a banner. */
async function stage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const phase = (window as unknown as { __phase?: () => string | null }).__phase?.() ?? '?';
    const head = (document.querySelector('main .headline')?.textContent ?? '')
      .toLowerCase()
      .replace(/[0-9]+/g, '#')
      .replace(/\b(ada|bix|cleo|dash|eli|fay|gus|hal|tester)\b/g, 'X')
      .split(/[·:—]/)[0]
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(' ');
    const banner = document.querySelector('.banner') ? '+banner' : '';
    return `${phase}|${head}${banner}`;
  });
}

interface Shot {
  stage: string;
  file: string;
  issues: string[];
}

/**
 * `sheets`: also the menu, save and scores sheets (once a game: they hardly change with the
 * screen or the number of players) and `replay`, the table in a replay (once a screen size).
 */
async function audit(page: Page, g: GameJson, size: keyof typeof SIZES, seats: number, tag: string, { sheets = false, replay = false, tv = false } = {}) {
  const shots: Shot[] = [];
  const dir = `${OUT}/${g.id}`;
  mkdirSync(dir, { recursive: true });
  const snap = async (label: string) => {
    await cardsLanded(page).catch(() => {});
    // (a sheet or banner part way through fading in isn't what anyone sees for long)
    await page
      .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), null, {
        timeout: 1500,
      })
      .catch(() => {});
    const file = `${tag}-${String(shots.length).padStart(2, '0')}-${label.replace(/[^a-z0-9#+]+/gi, '_').slice(0, 50)}.png`;
    let issues = await check(page);
    // (the bots play on meanwhile: a card caught in flight isn't a layout problem, so a problem
    // counts only if it's still there once things settle)
    if (issues.length) {
      await page.waitForTimeout(700);
      await cardsLanded(page).catch(() => {});
      const again = new Set(await check(page));
      issues = issues.filter((i) => again.has(i));
    }
    await page.screenshot({ path: `${dir}/${file}` });
    shots.push({ stage: label, file, issues });
  };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SIZES[size]);
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${g.id}"]`).first().click();
  for (let i = 1; i < seats; i++) await page.click('text=+ Add bot');
  await snap('lobby');
  await page.click(`button:has-text("Deal ${g.name}")`);
  await page.locator('.table').waitFor();
  // a TV showing the table: the phone shows just your hand and the piles you can use ("hand mode")
  if (tv) {
    const code = page.url().match(/#\/room\/([^/?]+)/)![1];
    const screen = await page.context().newPage();
    await screen.setViewportSize({ width: 1366, height: 768 });
    await screen.goto(`/?net=local#/display/${code}`);
    await page.locator('.table.handmode').waitFor();
  }

  const seen = new Set<string>();
  const start = Date.now();
  for (let i = 0; i < 600 && Date.now() - start < 120_000 && shots.length < 18; i++) {
    const s = await stage(page);
    if (!seen.has(s)) {
      seen.add(s);
      await snap(s);
    }
    if (s.startsWith('gameOver')) break;
    const moved = await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(moved ? 120 : 300);
  }
  // the menu, the scores, the save choices, and a replay
  await cardsLanded(page).catch(() => {});
  const close = () =>
    page
      .locator('.sheet .x')
      .first()
      .click()
      .catch(() => page.keyboard.press('Escape'));
  if (sheets) {
    await page.click('button[aria-label="Menu"]');
    await snap('menu');
    if (await page.locator('.sheet button:has-text("Save this game")').count()) {
      await page.click('.sheet button:has-text("Save this game")');
      await snap('save');
    }
    await close();
    const scores = page.locator('button[aria-label="Scores and log"]');
    if (await scores.count()) {
      await scores.click();
      await snap('scores');
      await close();
    }
  }
  if (replay) {
    await page.click('button[aria-label="Menu"]');
    const again = page.locator('.sheet button:has-text("Replay the last hand")');
    if (await again.count()) {
      await again.click();
      await page.locator('.replay').waitFor();
      await snap('replay');
    } else await close();
  }

  writeFileSync(`${dir}/${tag}.json`, JSON.stringify({ game: g.id, size, seats, errors, shots }, null, 1));
  expect(errors).toEqual([]);
}

for (const g of GAMES) {
  test(`${g.name}: small screen`, async ({ page }) => audit(page, g, 'small', recommended(g), 'small', { sheets: true, replay: true }));
  test(`${g.name}: large screen`, async ({ page }) => audit(page, g, 'large', recommended(g), 'large', { replay: true }));
  test(`${g.name}: small screen, with a TV`, async ({ page }) => audit(page, g, 'small', recommended(g), 'small-tv', { tv: true }));
  if (most(g) > recommended(g)) test(`${g.name}: small screen, ${most(g)} players`, async ({ page }) => audit(page, g, 'small', most(g), `small-${most(g)}p`));
  if (fewest(g) < recommended(g)) {
    test(`${g.name}: small screen, ${fewest(g)} players`, async ({ page }) => audit(page, g, 'small', fewest(g), `small-${fewest(g)}p`));
    test(`${g.name}: large screen, ${fewest(g)} players`, async ({ page }) => audit(page, g, 'large', fewest(g), `large-${fewest(g)}p`));
  }
}
