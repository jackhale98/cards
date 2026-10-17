import { expect, test } from '@playwright/test';

test.setTimeout(180_000);

/**
 * The director can host every table itself (the setup's "Tables hosted on"): two phones sign up
 * for a one-round Swiss of Gin, and both sit at a table hosted on the director's device, neither
 * hosting it. The game is stepped on there to the end of the tournament.
 */
const URL = '/?net=local&seed=7&still';

type Hooks = { __round?: () => number | null; __eventStep: (n: number) => number };

test('the director hosts every table: the phones only play', async ({ context }) => {
  const director = await context.newPage();
  await director.setViewportSize({ width: 1280, height: 800 });
  await director.goto(URL);
  await director.fill('input[aria-label="Your name"]', 'Dee');
  await director.getByRole('button', { name: 'Run a tournament' }).click();
  await director.getByLabel('Game', { exact: true }).selectOption('gin-rummy');
  await expect(director.getByText('Directing · Gin Rummy')).toBeVisible({ timeout: 20_000 });
  const rounds = director.locator('.opt', { hasText: 'Rounds' });
  for (let i = 0; i < 5 && Number(await rounds.locator('b').textContent()) !== 1; i++)
    await rounds.getByRole('button', { name: Number(await rounds.locator('b').textContent()) < 1 ? 'More rounds' : 'Fewer rounds' }).click();
  await director.getByRole('button', { name: 'This device' }).click();
  await expect(director.getByText('Every table is hosted here')).toBeVisible();
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
  await expect(director.locator('.people li')).toHaveCount(2);
  await director.getByRole('button', { name: 'Start the tournament' }).click();
  // both at the table, as players: neither phone hosts it
  for (const p of phones) await expect(p.locator('.table')).toBeVisible({ timeout: 20_000 });
  for (const p of phones) expect(await p.evaluate(() => !!(window as unknown as Hooks).__round?.())).toBe(false);
  // the game, stepped on where it's hosted, to the end of the tournament
  await expect
    .poll(
      async () => {
        await director.evaluate(() => (window as unknown as Hooks).__eventStep(400));
        return director.getByText('Final standings').isVisible();
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  for (const p of phones) await expect(p.getByText("That's the tournament!")).toBeVisible({ timeout: 20_000 });
});
