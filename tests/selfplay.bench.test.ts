import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { familyRules, type Action, type GameModule, type GameState } from '../src/engine/types';
import { phh } from '../src/net/exports/phh';
import { pbn } from '../src/net/exports/pbn';
import { EVERYONE, type HandFormat } from '../src/net/exports/types';
import { GameRecord } from '../src/net/gameRecord';
import { GAMES } from './games';

/**
 * Bots playing each other at chosen levels, written out as PBN (bridge) and PHH (Hold'em) with
 * every card shown, for tools/check_records.py to check with programs that aren't ours: endplay
 * (bridge's double-dummy solver) and PokerKit. See tools/README.md.
 *
 *   SELFPLAY=1 DEALS=12 HANDS=200 npx vitest run tests/selfplay.bench.test.ts
 *
 * Each deal is played at every pairing of levels (0 Easy, 1 Normal, 2 Hard), so a level's results
 * can be compared on the same cards.
 */
const OUT = process.env.OUT ?? 'records';
const LEVELS = [0, 1, 2];
const END = new Set(['handOver', 'roundOver', 'gameOver']);

interface Played {
  record: GameRecord;
  /** Each seat's chips at the end (poker). */
  chips: number[];
}

/**
 * One game from `seed`, each seat's bot at its own level, for `hands` hands (or to the end).
 * Recorded as the host records a game.
 */
function play(
  g: GameModule,
  names: string[],
  seed: number,
  levels: number[],
  hands: number,
  options: Record<string, number | boolean>,
  formats: Record<string, HandFormat<unknown>>,
): Played {
  const defaults = Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default]));
  let s: GameState = g.setup(
    names.map((name) => ({ name, bot: true })),
    seed,
    { ...defaults, ...options },
  );
  const record = new GameRecord(formats);
  const ended = (x: GameState) => END.has(x.phase) || !!g.status(x, 0).banner;
  record.note(s, ended(s), () => []);
  let done = 0;
  let wasEnded = ended(s);
  const commit = (next: GameState, move?: { seat: number; action: Action }) => {
    s = next;
    const e = ended(s);
    record.note(s, e, () => [], move);
    if (e && !wasEnded) done++;
    wasEnded = e;
  };
  for (let i = 0; i < 200_000 && done < hands && s.phase !== 'gameOver'; i++) {
    const sys = g.system?.(s);
    if (sys) {
      const next = structuredClone(s);
      sys.run(next);
      commit(next);
      continue;
    }
    let move: { seat: number; action: Action } | null = null;
    for (const p of s.players) {
      s.options.botLevel = levels[p.seat];
      const a = g.bot!(s, p.seat);
      if (a) {
        move = { seat: p.seat, action: a };
        break;
      }
    }
    // between hands: deal the next one
    if (!move) {
      const seat = s.players.find((p) => g.actions(s, p.seat).some((a) => a.type === 'next'))?.seat;
      if (seat == null) break;
      move = { seat, action: { type: 'next' } };
    }
    const next = structuredClone(s);
    g.apply(next, move.seat, move.action);
    commit(next, move);
  }
  return { record, chips: s.players.map((p) => p.chips) };
}

const pairs = LEVELS.flatMap((a) => LEVELS.map((b) => [a, b]));

it.skipIf(!process.env.SELFPLAY)(
  'bots play each other, written out for checking',
  () => {
    mkdirSync(OUT, { recursive: true });
    const deals = Number(process.env.DEALS ?? 12);
    const hands = Number(process.env.HANDS ?? 200);
    const games = (process.env.GAMES ?? 'bridge,holdem').split(',');

    // bridge: North-South at one level, East-West at another, the same deals for every pairing
    if (games.includes('bridge')) {
      const g = GAMES.bridge;
      for (const [ns, ew] of pairs) {
        const out: string[] = [];
        for (let seed = 1; seed <= deals; seed++) {
          const { record } = play(g, ['North', 'East', 'South', 'West'], seed, [ns, ew, ns, ew], 1, {}, { pbn: pbn as HandFormat<unknown> });
          out.push(record.write('pbn', EVERYONE, { names: ['North', 'East', 'South', 'West'], table: 'SELF' })!);
        }
        // (one file: the header once, then the deals)
        const body = out.map((f, i) => (i ? f.replace(/^% PBN 2\.1\r\n% EXPORT\r\n\r\n/, '') : f.replace(/\r\n$/, ''))).join('\r\n\r\n');
        writeFileSync(`${OUT}/bridge-ns${ns}-ew${ew}.pbn`, body + '\r\n');
        process.stderr.write(`bridge NS ${ns} v EW ${ew}: ${deals} deals\n`);
      }
    }

    // Hold'em heads-up: one hand from each seed, then the same cards with the seats swapped
    if (games.includes('holdem')) {
      const g = GAMES.holdem;
      const format = phh(familyRules(g.config, 'poker')) as HandFormat<unknown>;
      const results: Record<string, number[]> = {};
      for (const [a, b] of pairs) {
        if (a >= b) continue;
        const files: string[] = [];
        const net: number[] = [];
        for (let seed = 1; seed <= hands; seed++)
          for (const levels of [
            [a, b],
            [b, a],
          ]) {
            const names = levels.map((l, i) => `L${l}-${i}`);
            const { record, chips } = play(g, names, seed, levels, 1, {}, { phh: format });
            files.push(record.write('phh', EVERYONE, { names, table: 'SELF' })!);
            const start = Number(g.config.chips?.start ?? 1000);
            // (chips won by the level-`b` bot, in big blinds)
            net.push((chips[levels.indexOf(b)] - start) / Number(g.config.chips?.bigBlind ?? 10));
          }
        writeFileSync(`${OUT}/holdem-hu-${a}v${b}.phh`, renumber(files));
        results[`${b} v ${a}`] = net;
        const mean = net.reduce((x, y) => x + y, 0) / net.length;
        const sd = Math.sqrt(net.reduce((x, y) => x + (y - mean) ** 2, 0) / net.length) / Math.sqrt(net.length);
        process.stderr.write(`holdem heads-up, level ${b} against ${a}: ${(mean * 100).toFixed(0)} bb/100 hands (± ${(sd * 100).toFixed(0)})\n`);
      }
      writeFileSync(`${OUT}/holdem-hu.json`, JSON.stringify(results));
      // a full table of short stacks, for all-ins and side pots
      const files: string[] = [];
      for (let seed = 1; seed <= Math.max(1, Math.round(deals / 2)); seed++) {
        const names = ['A', 'B', 'C', 'D', 'E', 'F'];
        const { record } = play(g, names, seed, [0, 1, 2, 0, 1, 2], 400, { stack: 200 }, { phh: format });
        files.push(record.write('phh', EVERYONE, { names, table: 'SELF' })!);
      }
      writeFileSync(`${OUT}/holdem-6max.phh`, renumber(files));
    }
  },
  6 * 3_600_000,
);

/** Several PHH files as one, its hands numbered [1], [2]… */
function renumber(files: string[]): string {
  let n = 0;
  return (
    files
      .filter(Boolean)
      .join('\n\n')
      .replace(/^\[\d+\]$/gm, () => `[${++n}]`) + '\n'
  );
}
