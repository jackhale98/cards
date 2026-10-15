import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { familyRules, type Action, type GameModule, type GameState } from '../src/engine/types';
import type { TrickData } from '../src/engine/families/trick';
import { phh } from '../src/net/exports/phh';
import { pbn } from '../src/net/exports/pbn';
import { EVERYONE, type HandFormat } from '../src/net/exports/types';
import { GameRecord } from '../src/net/gameRecord';
import { GAMES } from './games';
import { buildDeck } from '../src/engine/cards';
import { bestWithHole } from '../src/engine/lib/pokerEval';

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
  /** Poker heads-up: the moment both were all in with board cards still to come, if they were. */
  allIn: GameState | null;
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
  let allIn: GameState | null = null;
  const commit = (next: GameState, move?: { seat: number; action: Action }) => {
    s = next;
    const d = s.data as { b?: { folded: boolean[]; allIn: boolean[]; out: boolean[]; committed: number[] } };
    if (!allIn && d.b && s.zones.board && s.zones.board.cards.length < 5) {
      const b = d.b;
      const live = s.players.filter((p) => !b.out[p.seat] && !b.folded[p.seat]).map((p) => p.seat);
      const shoved = live.filter((x) => b.allIn[x]);
      const top = Math.max(0, ...shoved.map((x) => b.committed[x]));
      // (and called: whoever isn't all in has matched it)
      if (live.length === 2 && shoved.length && live.every((x) => b.allIn[x] || b.committed[x] >= top)) allIn = structuredClone(s);
    }
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
  return { record, chips: s.players.map((p) => p.chips), allIn };
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

    // bridge, bidding only (BIDDING=deals): every bot bids, nobody plays; each deal's hands and the
    // contract reached go to bridge-bidding.jsonl, for the checks to score against double dummy
    if (process.env.BIDDING) {
      const g = GAMES.bridge;
      const lines: string[] = [];
      const seats = 'NESW';
      for (let seed = 1 + Number(process.env.SEED0 ?? 0); seed <= Number(process.env.BIDDING) + Number(process.env.SEED0 ?? 0); seed++) {
        const s = g.setup(
          ['North', 'East', 'South', 'West'].map((name) => ({ name, bot: true })),
          seed,
          // (SYSTEM=0 natural, 1 SAYC, 2 two over one: the lobby's "Bots bid")
          { botLevel: 1, system: Number(process.env.SYSTEM ?? 1) },
        ) as GameState<TrickData>;
        // (every dealer and every vulnerability in turn, as a long match would have them)
        s.dealer = seed % 4;
        s.turn = s.dealer;
        s.data.vul = [
          [false, false],
          [true, false],
          [false, true],
          [true, true],
        ][Math.floor(seed / 4) % 4];
        const hands = s.players.map((p) => s.zones[`hand:${p.seat}`].cards.map((c) => c.id));
        const pbnHand = (ids: string[]) =>
          ['S', 'H', 'D', 'C']
            .map((x) =>
              ids
                .filter((c) => c[1] === x)
                .map((c) => c[0])
                .sort((a, b) => 'AKQJT98765432'.indexOf(a) - 'AKQJT98765432'.indexOf(b))
                .join(''),
            )
            .join('.');
        const deal = `N:${hands.map(pbnHand).join(' ')}`;
        const dealer = seats[s.dealer];
        const vul = [...(s.data.vul ?? [false, false])];
        let calls: (number | string)[] = [];
        for (let i = 0; i < 400 && s.phase === 'call'; i++) {
          calls = (s.data.calls ?? []).map((c) => c.call);
          const seat = s.turn!;
          g.apply(s, seat, g.bot!(s, seat)!);
          // (passed out: the same deal isn't bid again, a new one is dealt)
          if ((s.data.calls ?? []).length === 0) break;
        }
        const c = s.phase === 'play' ? s.data.bridge : null;
        if (c) calls = (s.data.calls ?? []).map((x) => x.call);
        else calls = [...calls, 'P'];
        lines.push(
          JSON.stringify({
            seed,
            deal,
            dealer,
            vul,
            calls,
            contract: c ? { level: c.level, strain: c.strain, dbl: c.dbl, declarer: seats[s.data.maker!] } : null,
          }),
        );
      }
      writeFileSync(`${OUT}/bridge-bidding.jsonl`, lines.join('\n') + '\n');
      process.stderr.write(`bridge bidding: ${lines.length} deals\n`);
    }

    // Hold'em heads-up: one hand from each seed, then the same cards with the seats swapped
    if (games.includes('holdem')) {
      const g = GAMES.holdem;
      const format = phh(familyRules(g.config, 'poker')) as HandFormat<unknown>;
      const results: Record<string, number[]> = {};
      for (const [a, b] of pairs) {
        if (a >= b || (process.env.PAIRS && !process.env.PAIRS.split(',').includes(`${a}-${b}`))) continue;
        const files: string[] = [];
        const net: number[] = [];
        for (let seed = 1 + Number(process.env.SEED0 ?? 0); seed <= hands + Number(process.env.SEED0 ?? 0); seed++)
          for (const levels of [
            [a, b],
            [b, a],
          ]) {
            const names = levels.map((l, i) => `L${l}-${i}`);
            const { record, chips, allIn } = play(g, names, seed, levels, 1, {}, { phh: format });
            files.push(record.write('phh', EVERYONE, { names, table: 'SELF' })!);
            const start = Number(g.config.chips?.start ?? 1000);
            // chips won by the level-`b` bot, in big blinds; all in with cards to come, its fair
            // share of the pot (its chance of winning it) rather than how the last cards fell
            const seat = levels.indexOf(b);
            const won = allIn ? allInShare(allIn, seat) : chips[seat] - start;
            net.push(won / Number(g.config.chips?.bigBlind ?? 10));
          }
        writeFileSync(`${OUT}/holdem-hu-${a}v${b}.phh`, renumber(files));
        results[`${b} v ${a}`] = net;
        const mean = net.reduce((x, y) => x + y, 0) / net.length;
        const sd = Math.sqrt(net.reduce((x, y) => x + (y - mean) ** 2, 0) / net.length) / Math.sqrt(net.length);
        process.stderr.write(`holdem heads-up, level ${b} against ${a}: ${(mean * 100).toFixed(0)} bb/100 hands (± ${(sd * 100).toFixed(0)})\n`);
      }
      writeFileSync(`${OUT}/holdem-hu.json`, JSON.stringify(results));
      if (process.env.PAIRS) return;
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

/**
 * Heads-up, both all in (or one all in and called) with board cards to come: `seat`'s expected
 * winnings, over every way the rest of the board could fall (or 3000 of them, before the flop).
 */
function allInShare(s: GameState, seat: number): number {
  const d = s.data as { b: { committed: number[] } };
  const other = 1 - seat;
  const matched = Math.min(d.b.committed[seat], d.b.committed[other]);
  const board = s.zones.board.cards.map((c) => c.id);
  const holes = [seat, other].map((x) => s.zones[`hand:${x}`].cards.map((c) => c.id));
  const seen = new Set([...board, ...holes.flat()]);
  const rest = buildDeck({}).filter((c) => !seen.has(c));
  const need = 5 - board.length;
  let eq = 0;
  let runs = 0;
  const score = (full: string[]) => {
    const [me, them] = holes.map((h) => bestWithHole(h, full, 0).score);
    eq += me > them ? 1 : me === them ? 0.5 : 0;
    runs++;
  };
  if (need <= 2) {
    for (let i = 0; i < rest.length; i++)
      if (need === 1) score([...board, rest[i]]);
      else for (let j = i + 1; j < rest.length; j++) score([...board, rest[i], rest[j]]);
  } else
    for (let k = 0; k < 3000; k++) {
      const pick = new Set<string>();
      while (pick.size < need) pick.add(rest[Math.floor(Math.random() * rest.length)]);
      score([...board, ...pick]);
    }
  // (what each put in beyond what the other matched comes back)
  return (eq / runs) * 2 * matched - matched;
}

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
