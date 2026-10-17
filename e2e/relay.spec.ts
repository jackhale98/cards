import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(180_000);

/**
 * A tournament through our relay, run here (see playwright.config.ts), as phones go through it on
 * the real site: it vouches for each room's host and a message takes a moment to arrive, so a phone
 * says hello to the director twice before the first answer comes back. (Through the stand-in for one
 * browser, `?net=local`, that never happened, and a table whose host was turned away for answering
 * the first question stayed "Setting up…".) Two phones and bots: every phone's table is dealt.
 */
const RELAY = `ws://127.0.0.1:${Number(process.env.PW_PORT ?? 4173) + 2}`;
test.skip(!existsSync('relay/node_modules/.bin/wrangler'), 'the relay isn’t installed here: pnpm -C relay install');
const URL = `/?net=relay&relay=${RELAY}`;

test('through the relay: each phone’s table is seated and dealt, its host linked to the director', async ({ context }) => {
  const director = await context.newPage();
  await director.setViewportSize({ width: 1280, height: 800 });
  await director.goto(URL);
  await director.fill('input[aria-label="Your name"]', 'Dee');
  await director.getByRole('button', { name: 'Run a tournament' }).click();
  await director.getByLabel('Game', { exact: true }).selectOption('hearts');
  await expect(director.getByText('Directing · Hearts')).toBeVisible({ timeout: 20_000 });
  const code = (await director.locator('.code').getAttribute('aria-label'))!.replace('Code ', '');
  const phones: Page[] = [];
  for (const name of ['Jack', 'Kim']) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 393, height: 852 });
    await p.goto(URL);
    await p.fill('input[aria-label="Your name"]', name);
    await p.fill('input[aria-label="Table code"]', code);
    await p.getByRole('button', { name: 'Sign me up' }).click();
    await expect(p.getByText("You're in.")).toBeVisible({ timeout: 20_000 });
    phones.push(p);
  }
  for (let i = 0; i < 6; i++) await director.getByRole('button', { name: 'Add a bot' }).click();
  await director.getByRole('button', { name: 'Start the tournament' }).click();
  for (const p of phones) await expect(p.locator('.table')).toBeVisible({ timeout: 40_000 });
  // (the director hears from every table: none still setting up)
  await expect(director.getByText('Setting up…')).toHaveCount(0, { timeout: 20_000 });
});
