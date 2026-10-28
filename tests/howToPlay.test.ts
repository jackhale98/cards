import { describe, expect, it } from 'vitest';
import { GAME_LIST, GAMES, howToPlay } from './games';

describe('how to play', () => {
  it('shows the lines for the number seated after the game’s own', () => {
    const hearts = GAMES.hearts.config;
    expect(howToPlay(hearts, 4)).toEqual(hearts.rulesSummary);
    const five = howToPlay(hearts, 5);
    expect(five.slice(0, -1)).toEqual(hearts.rulesSummary);
    expect(five.at(-1)).toMatch(/3♣ leads/);
  });

  it('an option’s line in the lobby (what it does, where How to play has no room) is short', () => {
    for (const { config } of GAME_LIST)
      for (const o of config.options ?? []) if (o.about) expect(o.about.length, `${config.id} ${o.id}`).toBeLessThanOrEqual(200);
  });

  it('every game has short rules, with size lines only for sizes it can be played at', () => {
    for (const { config } of GAME_LIST) {
      const p = config.players;
      const sizes = p.counts ?? Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i);
      expect(config.rulesSummary?.length, config.id).toBeGreaterThan(2);
      for (const n of Object.keys(config.byPlayers ?? {})) expect(sizes, `${config.id} ${n}`).toContain(+n);
      for (const n of sizes) {
        const lines = howToPlay(config, n);
        expect(lines.length, `${config.id} at ${n}`).toBeLessThanOrEqual(13);
        for (const l of lines) {
          expect(l.length, `${config.id}: ${l}`).toBeLessThanOrEqual(260);
          expect(l, config.id).not.toMatch(/pagat/i);
        }
      }
    }
  });
});
