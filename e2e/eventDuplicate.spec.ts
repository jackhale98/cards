import { expect, test } from '@playwright/test';

test.setTimeout(240_000);

/**
 * A duplicate pairs tournament of bridge (`?net=local&seed=7&still`, stepped with `__eventStep`):
 * two phones sign up (paired with each other) beside three pairs of bots, every table hosted on
 * the director's device and playing the same boards. At the end, the standings in percentages, each
 * board's traveller (on the desk, the board, and the phones), and the results saved as PBN.
 */
const URL = '/?net=local&seed=7&still';

type Hooks = { __eventStep: (n: number) => number };

test('duplicate pairs: every table plays the same boards, matchpointed; the board shows the travellers', async ({ context }) => {
  const director = await context.newPage();
  await director.setViewportSize({ width: 1280, height: 800 });
  await director.goto(URL);
  await director.fill('input[aria-label="Your name"]', 'Dee');
  await director.getByRole('button', { name: 'Run a tournament' }).click();
  await director.getByLabel('Game', { exact: true }).selectOption('bridge');
  await expect(director.getByText('Directing · Contract Bridge')).toBeVisible({ timeout: 20_000 });
  await director.getByRole('button', { name: 'Pairs', exact: true }).click();
  // the format decides the scoring (and hosts the tables here, so no phone holds the boards)
  await expect(director.getByText('Every table plays the same boards')).toBeVisible();
  await expect(director.locator('.setup').getByText('Scoring', { exact: true })).toHaveCount(0);
  await expect(director.getByRole('button', { name: 'This device' })).toHaveClass(/on/);
  const step = async (label: string, want: number) => {
    const row = director.locator('.opt', { hasText: label });
    for (let i = 0; i < 8 && Number(await row.locator('b').textContent()) !== want; i++)
      await row.getByRole('button', { name: Number(await row.locator('b').textContent()) < want ? /More/ : /Fewer/ }).click();
    await expect(row.locator('b')).toHaveText(String(want));
  };
  await step('Boards a round', 2);
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
  for (let i = 0; i < 3; i++) await director.getByRole('button', { name: 'Add a bot' }).click();
  await expect(director.locator('.people li')).toHaveCount(5);
  // (four pairs: three rounds unless the director says; one here)
  await expect(director.locator('.opt', { hasText: 'Rounds' }).locator('b')).toHaveText('3');
  await step('Rounds', 1);
  await director.getByRole('button', { name: 'Start the tournament' }).click();
  for (const p of phones) await expect(p.locator('.table')).toBeVisible({ timeout: 20_000 });
  await expect(director.locator('article.tile')).toHaveCount(2);
  // the games, stepped on here, to the end
  await expect
    .poll(
      async () => {
        await director.evaluate(() => (window as unknown as Hooks).__eventStep(400));
        return director.getByText('Final standings').isVisible();
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  const standings = director.getByLabel('Standings');
  await expect(standings.getByText('%', { exact: true })).toBeVisible();
  await expect(standings.getByText(/^(Ann & Bo|Bo & Ann)$/)).toBeVisible();
  await expect(standings.locator('li:not(.head)')).toHaveCount(4);
  // each board's traveller: on the desk, and on the screens
  await expect(director.getByLabel('Travellers').getByLabel('Board 1')).toBeVisible();
  const [file] = await Promise.all([director.waitForEvent('download'), director.getByRole('button', { name: 'Save the results' }).click()]);
  expect(file.suggestedFilename()).toMatch(/^lamplight-dee-s-tournament-.*\.pbn$/);
  const text = await (await file.createReadStream()).toArray().then((parts) => Buffer.concat(parts).toString('latin1'));
  expect(text.match(/\[Board "\d+"\]/g)).toHaveLength(2);
  expect(text).toContain('[ScoreTable "Table');
  expect(text).toContain('[TotalScoreTable "Rank');
  await director.getByRole('button', { name: 'Travellers', exact: true }).click();
  await director.getByRole('button', { name: 'Show the board' }).click();
  await expect(director.locator('main.board').getByLabel('Board 2')).toBeVisible();
  await expect(director.locator('main.board').getByText('Dealer E')).toBeVisible();
  for (const p of phones) await expect(p.getByText("That's the tournament!")).toBeVisible({ timeout: 20_000 });
  // (each phone: the round's boards, every table's result on each)
  for (const p of phones) await expect(p.getByLabel('Travellers').getByLabel('Board 2')).toBeVisible();
});
