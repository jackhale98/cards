import { it } from 'vitest';
import { GAME_LIST } from './games';
import type { GameModule, GameState } from '../src/engine/types';

/**
 * Search bots against the quick heuristics, each deal played twice with the sides swapped:
 * `BENCH=1 LEVEL=1 BASE=0 DEALS=40 GAMES=spades,gin-rummy npx vitest run tests/search.bench.test.ts`
 */
it.skipIf(!process.env.BENCH)('search strength', () => {
  const level = Number(process.env.LEVEL ?? 1);
  const base = Number(process.env.BASE ?? 0); // the level it plays against
  const deals = Number(process.env.DEALS ?? 40);
  const games = (process.env.GAMES ?? 'spades,hearts,euchre,five-hundred,oh-hell,bridge,crazy-eights,president,gin-rummy,cribbage').split(',');
  for (const id of games) {
    const g = GAME_LIST.find((x) => x.config.id === id) as GameModule;
    const family = g.config.rules?.family;
    const n = g.config.players.max === 2 ? 2 : 4;
    // a seat's result for the hand, higher is better
    const result = (before: GameState, after: GameState, seat: number): number => {
      const d = after.data as any;
      if (family === 'climbing' || family === 'palace') return -(d.finished.indexOf(seat) < 0 ? n : d.finished.indexOf(seat));
      const scores = d.scores as number[];
      const was = (before.data as any).scores as number[];
      const k = scores.length === n ? seat : seat % scores.length;
      const low = family === 'eights' || !!(g.config.rules as any)?.end?.lowWins;
      return (low ? -1 : 1) * (scores[k] - was[k]);
    };
    let diff = 0, moves = 0, ms = 0, maxMs = 0;
    for (let seed = 1; seed <= deals; seed++) {
      for (const smart of n === 2 ? [[0], [1]] : [[0, 2], [1, 3]]) {
        const s: GameState = g.setup(Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })), seed,
          Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])));
        const before = structuredClone(s);
        const startHand = (x: GameState) => JSON.stringify([(x.data as any).handNo, (x.data as any).round]);
        const hand0 = startHand(s);
        for (let i = 0; i < 4000; i++) {
          if (['roundOver', 'handOver', 'gameOver'].includes(s.phase) || startHand(s) !== hand0) break;
          const sys = g.system?.(s);
          if (sys) { sys.run(s); continue; }
          s.options.botLevel = 0;
          const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
          if (seat < 0) break;
          s.options.botLevel = smart.includes(seat) ? level : base;
          const t = performance.now();
          const a = g.bot!(s, seat)!;
          const dt = performance.now() - t;
          if (smart.includes(seat) && level) { moves++; ms += dt; maxMs = Math.max(maxMs, dt); }
          g.apply(s, seat, a);
        }
        const others = s.players.map((p) => p.seat).filter((x) => !smart.includes(x));
        const avg = (xs: number[]) => xs.map((x) => result(before, s, x)).reduce((a, b) => a + b, 0) / xs.length;
        diff += avg(smart) - avg(others);
      }
    }
    process.stderr.write(`${id}: search edge ${(diff / (2 * deals)).toFixed(2)}/hand, ${(ms / Math.max(1, moves)).toFixed(1)} ms/decision avg, max ${maxMs.toFixed(0)} ms\n`);
  }
}, 3_600_000);
