import { expect, test } from '@playwright/test';
import { backOf, clothOf } from '../src/ui/looks';

test('the host picks the card backs and cloth; every phone at the table follows', async ({ context }) => {
  const host = await context.newPage();
  await host.setViewportSize({ width: 852, height: 393 });
  await host.goto('/?net=local');
  await host.fill('input[aria-label="Your name"]', 'Hana');
  await host.click('text=Start a table');
  await host.waitForURL(/#\/room\//);
  const code = host.url().split('/').pop()!;
  const guest = await context.newPage();
  await guest.setViewportSize({ width: 852, height: 393 });
  await guest.goto(`/?net=local#/join/${code}`);
  await guest.fill('input[aria-label="Your name"]', 'Ann');
  await guest.click('text=Deal me in');
  await guest.waitForURL(/#\/room\//);

  const cssVar = (p: typeof host, name: string) => p.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  await host.click('.look-btn');
  await host.click('button[aria-label="Tartan"]');
  await host.click('button[aria-label="Oak"]');
  await host.keyboard.press('Escape');
  await expect.poll(() => cssVar(guest, '--back-a')).toBe(backOf('tartan').colour);
  await expect.poll(() => cssVar(guest, '--felt-1')).toBe(clothOf('wood').felt[0]);
  await expect(guest.locator('.look-btn')).toContainText('Tartan backs · Oak');
  // guests can look but not choose
  await guest.click('.look-btn');
  await expect(guest.locator('button[aria-label="Rosette"]')).toBeDisabled();
  await guest.keyboard.press('Escape');

  // the host's next table starts with the same look; the home screen keeps the usual green
  await host.click('text=Leave');
  await host.waitForURL((u) => !u.hash.includes('room'));
  await expect.poll(() => cssVar(host, '--felt-1')).toBe('#1d5c47');
  await host.click('text=Start a table');
  await host.waitForURL(/#\/room\//);
  await expect.poll(() => cssVar(host, '--felt-1')).toBe('#7a5432');
});
