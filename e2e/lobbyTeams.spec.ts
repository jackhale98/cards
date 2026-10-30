import { expect, test, type Page } from '@playwright/test';

/**
 * Partnerships in the lobby: for a game played in teams, each player who's in shows their team,
 * and a line says who partners whom, by where they sit in the list (moving a player moves them to
 * another team). A game where everyone plays alone shows none of it.
 */
const SD = process.env.SHOT_DIR;

async function table(page: Page, game: string, bots: number) {
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${game}"]`).first().click();
  for (let i = 0; i < bots; i++) await page.click('text=+ Add bot');
  await expect(page.locator('.players li')).toHaveCount(bots + 1);
}

for (const [w, h] of [
  [390, 844],
  [1280, 800],
]) {
  test(`four at bridge: two teams, partners across, at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await table(page, 'bridge', 3);
    const rows = page.locator('.players li');
    const names = await rows.locator('.ptext').allTextContents();
    // the 1st and 3rd partner, the 2nd and 4th
    await expect(rows.nth(0).locator('em.team')).toHaveAttribute('aria-label', 'Team 1');
    await expect(rows.nth(1).locator('em.team')).toHaveAttribute('aria-label', 'Team 2');
    await expect(rows.nth(2).locator('em.team')).toHaveAttribute('aria-label', 'Team 1');
    await expect(rows.nth(3).locator('em.team')).toHaveAttribute('aria-label', 'Team 2');
    await expect(page.locator('.partners')).toContainText(`you & ${names[2]} · ${names[1]} & ${names[3]}`);
    if (SD) await page.screenshot({ path: `${SD}/teams-${w}.png` });
    // the 2nd player up to the top: now the 1st (who moved) and 3rd partner
    await rows.nth(1).getByRole('button', { name: 'Move up' }).click();
    await expect(page.locator('.partners')).toContainText(`${names[1]} & ${names[2]} · you & ${names[3]}`);
  });
}

test('a game everyone plays alone shows no teams', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await table(page, 'hearts', 3);
  await expect(page.locator('.partners')).toHaveCount(0);
  await expect(page.locator('em.team')).toHaveCount(0);
});
