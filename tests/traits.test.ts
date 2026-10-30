import { describe, expect, it } from 'vitest';
import { GAMES as INFO } from '../src/games';
import { sidesOf } from '../src/engine/families/traits';
import { GAMES } from './games';

/**
 * The picker and table know whether a game has bots (and bot strengths) and is played in real time
 * without loading its rules (engine/families/traits.ts). Check that against every real engine.
 */
describe('what the lobby knows about a game matches its rules', () => {
  for (const [id, info] of Object.entries(INFO)) {
    it(id, () => {
      const m = GAMES[id];
      expect({ bot: info.bot, botLevels: info.botLevels, realtime: info.realtime }).toEqual({ bot: !!m.bot, botLevels: !!m.botLevels, realtime: !!m.realtime });
      // (one config, shared: the rules see the same options the lobby shows)
      expect(m.config).toBe(info.config);
    });
  }
});

/** The lobby's partnerships (engine/families/traits.ts sidesOf) against every engine's own, at every size it seats. */
describe('the lobby’s partnerships match each game’s rules', () => {
  for (const [id, info] of Object.entries(INFO)) {
    it(id, () => {
      const m = GAMES[id];
      const p = info.config.players;
      const sizes = p.counts ?? Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i);
      for (const n of sizes) {
        const solo = Array.from({ length: n }, (_, i) => [i]);
        expect(sidesOf(info.config, n), `${id} at ${n}`).toEqual(m.sides?.(n) ?? solo);
      }
    });
  }
});
