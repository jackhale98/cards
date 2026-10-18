import { expect, test } from '@playwright/test';

test.setTimeout(240_000);

/**
 * A multi-table Hold'em tournament (`?net=local&seed=7&still`, stepped with `__eventStep`, the
 * blinds moved on with `__eventClock`): two phones sign up beside six bots, four to a table, every
 * table hosted on the director's device. As players go out the tables are broken up down to the
 * final table, and at the end the standings are by chips.
 */
const URL = '/?net=local&seed=7&still';

type Hooks = { __eventStep: (n: number) => number; __eventClock: (minutes: number) => void };

test('multi-table poker: two tables of four, down to the final table and one winner', async ({ context }) => {
  const director = await context.newPage();
  await director.setViewportSize({ width: 1280, height: 800 });
  await director.goto(URL);
  await director.fill('input[aria-label="Your name"]', 'Dee');
  await director.getByRole('button', { name: 'Run a tournament' }).click();
  await director.getByLabel('Game', { exact: true }).selectOption('holdem');
  await expect(director.getByText(/Directing · Texas Hold.em · Multi-table/)).toBeVisible({ timeout: 20_000 });
  await expect(director.getByText('the blinds go up every 10 minutes')).toBeVisible();
  await expect(director.getByRole('button', { name: 'This device' })).toHaveClass(/on/);
  const step = async (label: string, want: number) => {
    const row = director.locator('.opt', { hasText: label });
    for (let i = 0; i < 40 && Number(await row.locator('b').textContent()) !== want; i++)
      await row
        .getByRole('button')
        .nth(Number(await row.locator('b').textContent()) < want ? 1 : 0)
        .click();
    await expect(row.locator('b')).toHaveText(String(want));
  };
  await step('Seats a table', 4);
  const code = (await director.locator('.code').getAttribute('aria-label'))!.replace('Code ', '');

  const phones = [];
  for (const name of ['Ann', 'Bo']) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 852, height: 393 });
    await p.goto(URL);
    await p.fill('input[aria-label="Your name"]', name);
    await p.fill('input[aria-label="Table code"]', code);
    await p.getByRole('button', { name: 'Sign me up' }).click();
    await expect(p.getByText("You're in.")).toBeVisible();
    phones.push(p);
  }
  for (let i = 0; i < 6; i++) await director.getByRole('button', { name: 'Add a bot' }).click();
  await expect(director.locator('.people li')).toHaveCount(8);
  await director.getByRole('button', { name: 'Start the tournament' }).click();
  for (const p of phones) await expect(p.locator('.table')).toBeVisible({ timeout: 20_000 });
  await expect(director.locator('article.tile')).toHaveCount(2);
  await expect(director.getByText('8 of 8 left, at 2 tables')).toBeVisible();
  await expect(director.getByText('Level 1', { exact: true })).toBeVisible();
  // the games, stepped on here, the blinds going up as they go, to the end
  await expect
    .poll(
      async () => {
        await director.evaluate(() => {
          const w = window as unknown as Hooks;
          w.__eventStep(300);
          w.__eventClock(10);
        });
        return director.getByText('Final standings').isVisible();
      },
      { timeout: 150_000 },
    )
    .toBe(true);
  const standings = director.getByLabel('Standings');
  await expect(standings.getByText('Chips', { exact: true })).toBeVisible();
  await expect(standings.locator('li:not(.head)')).toHaveCount(8);
  await expect(standings.locator('li:not(.head)').first().locator('.pts')).toHaveText('8000');
  for (const p of phones) await expect(p.getByText("That's the tournament!")).toBeVisible({ timeout: 20_000 });
});
