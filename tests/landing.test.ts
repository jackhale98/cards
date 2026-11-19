import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_LIST } from '../src/games';

/** The landing page (about/index.html) names every game, and counts them right. */
const page = readFileSync('about/index.html', 'utf8').replace(/&#x27;|&apos;/g, "'");

describe('the landing page', () => {
  it('names every game', () => {
    const missing = GAME_LIST.map((g) => g.config.name).filter((name) => !page.includes(name));
    expect(missing).toEqual([]);
  });

  it('says how many games there are', () => {
    const counts = [...page.matchAll(/(\d+) games/g)].map((m) => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    for (const n of counts) expect(n).toBe(GAME_LIST.length);
  });

  it('runs no script of its own (it loads at once, and the security policy has nothing to allow)', () => {
    expect(page).not.toMatch(/<script/i);
  });
});
