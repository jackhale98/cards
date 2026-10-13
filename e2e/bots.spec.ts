import { expect, test } from '@playwright/test';

/**
 * The host's bots think in a background worker (src/net/botWorker.ts), so a bot thinking hard
 * never makes the host's screen stutter; and each game's rules are only downloaded when it's
 * picked. Both checked in a real browser.
 */
test("bots think in a worker, and a game's rules load only when it's picked", async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (r) => r.resourceType() === 'script' && scripts.push(r.url()));
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  // only the rules for the game the lobby opens on (Hold'em) come down, fetched ahead of dealing
  await expect.poll(() => scripts.some((u) => u.includes('engine/families/poker'))).toBe(true);
  expect(scripts.filter((u) => /engine\/families\/(?!traits|index|poker)[a-z]/.test(u))).toEqual([]);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
  // the trick-taking rules came down for Hearts, and no other game's
  expect(scripts.some((u) => u.includes('engine/families/trick/'))).toBe(true);
  expect(scripts.some((u) => /engine\/families\/(canasta|cribbage|rummy)\.ts/.test(u))).toBe(false);
  // pass three cards: the bots pass theirs from the worker, and play begins
  const cards = page.locator('.hand .slot');
  for (let i = 0; i < 3; i++) await cards.nth(i).click({ position: { x: 14, y: 50 } }); // (its visible edge: the next card covers the middle)
  await page.click('button:has-text("Pass")');
  await expect.poll(() => page.workers().length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(page.workers().some((w) => w.url().includes('botWorker'))).toBe(true);
  await expect(page.locator('.hand .slot')).toHaveCount(13, { timeout: 15_000 });
  await expect(page.locator('.headline, .status').first()).not.toContainText('Pass 3', { timeout: 15_000 });
});
