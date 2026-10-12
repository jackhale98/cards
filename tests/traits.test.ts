import { describe, expect, it } from 'vitest';
import { GAMES as INFO } from '../src/games';
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
