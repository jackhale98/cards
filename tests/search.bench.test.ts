import { it } from 'vitest';
import { GAME_LIST } from '../src/games';
import type { GameModule, GameState } from '../src/engine/types';

/** Search bots against the quick heuristics: `BENCH=1 LEVEL=1 DEALS=40 npx vitest run tests/search.bench.test.ts`. */
it.skipIf(!process.env.BENCH)('search strength', () => {
const level = Number(process.env.LEVEL ?? 1);
const deals = Number(process.env.DEALS ?? 40);
for (const id of (process.env.GAMES ?? 'spades,hearts,euchre,five-hundred,oh-hell,bridge').split(',')) {
  const g = GAME_LIST.find((x) => x.config.id === id) as GameModule;
  const n = g.config.players.min <= 4 && g.config.players.max >= 4 ? 4 : g.config.players.min;
  let diff = 0, moves = 0, ms = 0, maxMs = 0;
  for (let seed = 1; seed <= deals; seed++) {
    // each deal twice, with the searching side swapped, so the cards even out
    for (const smart of [[0, 2], [1, 3]]) {
      const s: GameState = g.setup(Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })), seed,
        Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])));
      const before = [...(s.data as any).scores];
      for (let i = 0; i < 3000 && s.phase !== 'roundOver' && s.phase !== 'gameOver'; i++) {
        const sys = g.system?.(s);
        if (sys) { sys.run(s); continue; }
        const seat = s.players.findIndex((p) => { s.options.botLevel = 0; return g.bot!(s, p.seat); });
        if (seat < 0) break;
        s.options.botLevel = smart.includes(seat) ? level : 0;
        const t = performance.now();
        const a = g.bot!(s, seat)!;
        const dt = performance.now() - t;
        if (s.phase === 'play' && smart.includes(seat)) { moves++; ms += dt; maxMs = Math.max(maxMs, dt); }
        g.apply(s, seat, a);
      }
      const sc = (s.data as any).scores as number[];
      const teamOfSeat = (x: number) => (sc.length === 2 ? x % 2 : x);
      const mine = smart.map(teamOfSeat), deltas = sc.map((x, i) => x - before[i]);
      const m = deltas.filter((_, i) => mine.includes(i)).reduce((a, b) => a + b, 0) / new Set(mine).size;
      const o = deltas.filter((_, i) => !mine.includes(i)).reduce((a, b) => a + b, 0) / Math.max(1, sc.length - new Set(mine).size);
      diff += (g.config.rules as any)?.end?.lowWins ? o - m : m - o;
    }
  }
  process.stderr.write(`${id}: search edge ${(diff / (2 * deals)).toFixed(1)} pts/hand, ${(ms / moves).toFixed(1)} ms/move avg, max ${maxMs.toFixed(0)} ms\n`);
}
}, 3_600_000);
