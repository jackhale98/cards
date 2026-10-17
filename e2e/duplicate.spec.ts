import { expect, test, type Page } from '@playwright/test';

test.setTimeout(180_000);

/**
 * Duplicate bridge in a room (`?net=local&seed=7&still`, stepped with `__advance`): another table
 * plays the same boards on the host's phone, bots alone when nobody is sitting out, else whoever is.
 * Each board is compared in IMPs; the game ends when both tables have played every board.
 */
const URL = '/?net=local&seed=7&still';

type Hooks = { __phase?: () => string | null; __advance: (n: number) => number };

async function bridgeDuplicate(host: Page) {
  await host.locator('[data-game="bridge"]').first().click();
  await host.getByRole('button', { name: 'Settings' }).click();
  await host.getByRole('button', { name: 'Duplicate', exact: true }).first().click();
  await host.keyboard.press('Escape');
}

/** Every move at both tables, a few hundred at a time, to the end of the game here. */
async function playOut(host: Page) {
  await expect
    .poll(
      async () => {
        await host.evaluate(() => {
          const w = window as unknown as Hooks;
          for (let i = 0; i < 400 && w.__phase?.() !== 'gameOver'; i++) if (!w.__advance(1)) break;
        });
        return host.evaluate(() => (window as unknown as Hooks).__phase?.());
      },
      { timeout: 90_000 },
    )
    .toBe('gameOver');
}

test('four at the table: a table of bots plays the same boards, compared in IMPs', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto(URL);
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await bridgeDuplicate(page);
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  await playOut(page);
  await expect(page.getByText('IMPs').first()).toBeVisible();
  await page.click('button[aria-label="Scores and log"]');
  const scores = page.getByRole('dialog');
  await expect(scores.getByText('Bots', { exact: true })).toBeVisible();
  await expect(scores.getByText('Board 4')).toBeVisible();
});

test('compared with par: each board against the solver’s (worked out in a worker)', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto(URL);
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await bridgeDuplicate(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Par', exact: true }).click();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  await playOut(page);
  await page.click('button[aria-label="Scores and log"]');
  const scores = page.getByRole('dialog');
  await expect(scores.getByText('Par', { exact: true })).toBeVisible();
  // (the solver stays in its worker: never in the page)
  expect(await page.evaluate(() => !!(globalThis as { __ddsReady?: boolean }).__ddsReady)).toBe(false);
});

test('five here: whoever is sitting out plays the same boards at a second table, then comes back', async ({ context }) => {
  const host = await context.newPage();
  await host.setViewportSize({ width: 852, height: 393 });
  await host.goto(URL);
  await host.fill('input[aria-label="Your name"]', 'Hana');
  await host.click('text=Start a table');
  await host.waitForURL(/#\/room\//);
  const code = /#\/room\/(\w+)/.exec(host.url())![1];
  await bridgeDuplicate(host);
  const phones: Page[] = [];
  for (const name of ['Ann', 'Bo', 'Cy', 'Di']) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 852, height: 393 });
    await p.goto(`${URL}#/join/${code}`);
    await p.fill('input[aria-label="Your name"]', name);
    await p.click('text=Deal me in');
    await p.waitForURL(/#\/room\//);
    await expect(host.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    phones.push(p);
  }
  await host.click('.dealbar button.primary');
  await host.locator('.table').waitFor();
  // Di sat out: she's sent to the second table, a room of its own, and plays there
  const di = phones[3];
  await expect(di).not.toHaveURL(new RegExp(`#/room/${code}$`), { timeout: 20_000 });
  await expect(di.locator('.table')).toBeVisible({ timeout: 30_000 });
  await playOut(host);
  await host.click('button[aria-label="Scores and log"]');
  await expect(host.getByRole('dialog').getByText('Table 2', { exact: true })).toBeVisible();
  await di.click('button[aria-label="Scores and log"]');
  await expect(di.getByRole('dialog').getByText('Table 1', { exact: true })).toBeVisible();
  // back to the lobby: Di comes back to this table
  await host.keyboard.press('Escape');
  await host.getByRole('button', { name: 'Menu' }).click();
  await host.getByRole('button', { name: 'Back to lobby' }).click();
  await expect(di).toHaveURL(new RegExp(`#/room/${code}$`), { timeout: 20_000 });
});
