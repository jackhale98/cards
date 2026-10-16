import { expect, test } from '@playwright/test';
import { cardsLanded } from './wait';

test.setTimeout(120_000);

/**
 * The table's sizes (src/ui/layout/table.ts) reckon how tall the middle's piles will stand from the
 * zones' own layouts, before the page lays them out; the page puts the reckoning on the middle as
 * `data-middle-h`. Here it's held to what the page then draws, through part of a game of each way
 * of laying out cards. (Unless the middle can't fit even at the smallest cards: then it's squeezed,
 * and scaled to fit.)
 */
const GAMES = ['hearts', 'bridge', 'canasta', 'kings-corners', 'egyptian-rat-screw', 'rummy-500', 'palace', 'seven-card-stud', 'holdem', 'cribbage'];
for (const [where, size] of [
  ['a small phone', { width: 667, height: 320 }],
  ['a laptop', { width: 1280, height: 800 }],
] as const)
  for (const game of GAMES)
    test(`${game} on ${where}: the middle stands as tall as its sizes reckoned`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/?net=local');
      await page.fill('input[aria-label="Your name"]', 'Hana');
      await page.click('text=Start a table');
      await page.waitForURL(/#\/room\//);
      await page.locator(`[data-game="${game}"]`).first().click();
      for (let i = 1; i < 4; i++) {
        const add = page.locator('text=+ Add bot');
        if (!(await add.isVisible()) || !(await add.isEnabled())) break;
        await add.click();
      }
      await page.locator('button:has-text("Deal")').first().click();
      await page.locator('.zones').waitFor();
      const off: string[] = [];
      for (let k = 0; k < 24; k++) {
        if (k % 4 === 0) {
          await cardsLanded(page);
          const r = await page.evaluate(() => {
            const z = document.querySelector<HTMLElement>('.zones')!;
            return { said: Number(z.dataset.middleH), is: z.offsetHeight, squeezed: /scale\(/.test(z.style.transform) };
          });
          if (!r.squeezed && Math.abs(r.said - r.is) > 2) off.push(`move ${k}: reckoned ${r.said}, stands ${r.is}`);
        }
        await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
        await page.waitForTimeout(200);
      }
      expect(off).toEqual([]);
    });
