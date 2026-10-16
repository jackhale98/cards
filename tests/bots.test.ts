import { describe, expect, it } from 'vitest';
import { GAME_LIST } from './games';
import type { GameModule, GameState } from '../src/engine/types';
import { checkAction } from '../src/engine/validate';
import { botView } from '../src/engine/botView';
import { resolveAction } from '../src/engine/redact';

/**
 * A bot that proposes a move the rules don't offer would freeze a real table (the host can only
 * fall back to a passive move), so every bot move in every game must be one that's on offer and
 * that the rules accept. Bots use randomness, so play plenty of deals. Each bot thinks as at a
 * real table: with its own seat's view (botView), its move brought back to the real deal.
 */
function botMove(g: GameModule, s: GameState, seat: number) {
  const v = botView(g, s, seat);
  const a = g.bot!(v.view, seat);
  return a ? resolveAction(s, seat, v.unfill(a)) : null;
}
function playDeal(g: GameModule, seed: number, n: number): string | null {
  const s: GameState = g.setup(
    Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })),
    seed,
    { ...Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])), botLevel: 0 },
  );
  const start = s.phase;
  for (let i = 0; i < 5000; i++) {
    if (i > 0 && s.phase === 'handOver') return null; // an all-bot poker table deals on by itself
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    // (each bot asked once: its answer can change from one asking to the next)
    let seat = -1;
    let a: ReturnType<typeof botMove> = null;
    for (const p of s.players)
      if ((a = botMove(g, s, p.seat))) {
        seat = p.seat;
        break;
      }
    if (!a) return null; // the deal is over (or waits on a person)
    const offered = g.actions(s, seat);
    // (the host checks every move against what was offered, bots' too)
    const checked = checkAction(a, offered);
    if ('error' in checked)
      return `seed ${seed}: ${JSON.stringify(a)} not offered in ${s.phase}: ${checked.error} (offered ${JSON.stringify(offered.filter((o) => o.type === a.type)).slice(0, 300)})`;
    try {
      g.apply(s, seat, checked.action);
    } catch (e) {
      return `seed ${seed}: ${JSON.stringify(a)} rejected in ${s.phase}: ${(e as Error).message}`;
    }
  }
  return `seed ${seed}: still in ${s.phase} after 5000 moves (started in ${start})`;
}

/** Games whose Easy bots look a little ahead (trick/index.ts, climbing.ts): slower to play out. */
const EASY_LOOKS = new Set(['hearts', 'spades', 'oh-hell', 'president']);

describe('bots only make moves the rules allow', () => {
  for (const g of GAME_LIST.filter((g) => g.bot)) {
    it(
      g.config.id,
      () => {
        const n = Math.max(g.config.players.min, Math.min(g.config.players.max, g.config.id === 'holdem' || g.config.id === 'omaha' ? 3 : 4));
        const problems: string[] = [];
        // (where Easy plays a few deals out before each move, fewer deals: its moves come from the legal ones)
        const deals = EASY_LOOKS.has(g.config.id) ? 60 : 400;
        for (let seed = 1; seed <= deals && problems.length < 3; seed++) {
          const p = playDeal(g, seed, n);
          if (p) problems.push(p);
        }
        expect(problems).toEqual([]);
      },
      120000,
    ); // (400 deals of the slower games take a while: real-time ones make thousands of moves a deal)
  }
});
