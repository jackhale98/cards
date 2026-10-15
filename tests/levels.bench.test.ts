import { it } from 'vitest';
import { GAME_LIST } from './games';
import { botView } from '../src/engine/botView';
import { resolveAction } from '../src/engine/redact';
import { loadDds } from '../src/engine/bots/dds';
import type { GameModule, GameState } from '../src/engine/types';

/**
 * One bot level against another in every game that has levels, each deal played twice with the
 * sides swapped, every bot seeing only its own seat (botView), as at a real table:
 * `LEVELS=1 PAIRS=2-1,1-0 DEALS=40 GAMES=spades,hearts npx vitest run tests/levels.bench.test.ts`
 */
it.skipIf(!process.env.LEVELS)(
  'level against level',
  async () => {
    // (the Hard trick bots' solver, ready before the first card, as at a table)
    await loadDds();
    const deals = Number(process.env.DEALS ?? 40);
    const hands = Number(process.env.HANDS ?? 1);
    const pairs = (process.env.PAIRS ?? '2-1,1-0').split(',').map((p) => p.split('-').map(Number));
    for (const id of (process.env.GAMES ?? '').split(',')) {
      const g = GAME_LIST.find((x) => x.config.id === id) as GameModule;
      const family = g.config.rules?.family;
      const n = Math.min(4, g.config.players.max);
      const poker = family === 'poker';
      const wholeGame = family === 'cheat' || family === 'gofish';
      const result = (before: GameState, after: GameState, seat: number): number => {
        const d = after.data as any;
        if (poker) return after.players[seat].chips - before.players[seat].chips;
        if (family === 'cheat') return after.winner?.includes(seat) ? 1 : 0;
        if (family === 'gofish') return d.books[seat];
        if (family === 'climbing' || family === 'palace') return -(d.finished.indexOf(seat) < 0 ? n : d.finished.indexOf(seat));
        const scores = d.scores as number[];
        const was = (before.data as any).scores as number[];
        const k = scores.length === n ? seat : seat % scores.length;
        const low = family === 'eights' || !!(g.config.rules as any)?.end?.lowWins;
        return (low ? -1 : 1) * (scores[k] - was[k]);
      };
      for (const [level, base] of pairs) {
        const diffs: number[] = [];
        let ms = 0,
          moves = 0;
        for (let seed = 1; seed <= deals; seed++) {
          let diff = 0;
          for (const smart of n === 2
            ? [[0], [1]]
            : n === 3
              ? [[0], [1], [2]]
              : [
                  [0, 2],
                  [1, 3],
                ]) {
            const s: GameState = g.setup(
              Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })),
              seed,
              Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])),
            );
            const before = structuredClone(s);
            const startHand = (x: GameState) => JSON.stringify([(x.data as any).handNo, (x.data as any).round]);
            const hand0 = startHand(s);
            // (HANDS: a session of that many hands, as a real table plays, so habits build up)
            let ended = 0;
            let last = hand0;
            for (let i = 0; i < 6000 * hands; i++) {
              if (startHand(s) !== last) {
                ended++;
                last = startHand(s);
              }
              const over = ['roundOver', 'handOver', 'gameOver'].includes(s.phase);
              if (wholeGame ? s.phase === 'gameOver' : s.phase === 'gameOver' || ended >= hands || (over && ended + 1 >= hands)) break;
              const sys = g.system?.(s);
              if (sys) {
                sys.run(s);
                continue;
              }
              let seat = -1;
              let a = null;
              for (const p of s.players) {
                s.options.botLevel = smart.includes(p.seat) ? level : base;
                const v = botView(g, s, p.seat);
                const t = performance.now();
                const b = g.bot!(v.view, p.seat);
                if (smart.includes(p.seat)) {
                  ms += performance.now() - t;
                  moves++;
                }
                if (b) {
                  a = resolveAction(s, p.seat, v.unfill(b));
                  seat = p.seat;
                  break;
                }
              }
              if (!a) break;
              g.apply(s, seat, a);
            }
            const others = s.players.map((p) => p.seat).filter((x) => !smart.includes(x));
            const avg = (xs: number[]) => xs.map((x) => result(before, s, x)).reduce((a, b) => a + b, 0) / xs.length;
            diff += avg(smart) - avg(others);
          }
          diffs.push(diff / (n === 3 ? 3 : 2));
        }
        const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
        const per = hands > 1 ? `a session of ${hands} hands` : 'a deal';
        process.stderr.write(
          `${id} ${level} v ${base}: ${mean.toFixed(2)} ± ${(sd / Math.sqrt(diffs.length)).toFixed(2)} ${per} (${deals} deals, ${(ms / Math.max(1, moves)).toFixed(1)} ms a move)\n`,
        );
      }
    }
  },
  7_200_000,
);
