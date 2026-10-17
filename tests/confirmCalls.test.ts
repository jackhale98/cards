import { describe, expect, it } from 'vitest';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

/** The bidding, where each game has one: every call there is asked about before it goes. */
const AUCTIONS: Record<string, string[]> = {
  bridge: ['call'],
  'five-hundred': ['auction'],
  euchre: ['order', 'name'],
  setback: ['pitch'],
  spades: ['bid'],
  'oh-hell': ['bid'],
  pinochle: ['bid', 'trump'],
};
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));

describe('calls are confirmed', () => {
  for (const [id, phases] of Object.entries(AUCTIONS)) {
    it(`${id}: every call in the bidding is asked about, and nothing after it`, () => {
      const g = GAMES[id] as GameModule;
      const s: GameState = g.setup(players(4), 3, {});
      const seen = new Set<string>();
      for (let i = 0; i < 400 && !['handOver', 'roundOver', 'gameOver'].includes(s.phase); i++) {
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        expect(seat, `stuck in ${s.phase}`).toBeGreaterThanOrEqual(0);
        for (const a of g.actions(s, seat)) {
          if (phases.includes(s.phase)) expect(a.confirm, `${s.phase}: ${a.label}`).toBe(true);
          else if (s.phase === 'play') expect(a.confirm, `${s.phase}: ${a.label}`).toBeFalsy();
        }
        seen.add(s.phase);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(phases.filter((p) => seen.has(p)).length).toBeGreaterThan(0);
      expect(seen.has('play')).toBe(true);
    });
  }
});
