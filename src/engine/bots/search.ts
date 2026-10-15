import { RuleError, type Action, type GameState } from '../types';

/**
 * A general card-game bot: Monte Carlo sampling over the cards it can't see.
 *
 * For each move it could make, the bot imagines many deals of the unseen cards that fit what it
 * knows (a `determinize`d copy of the game), plays each one out to the end of the hand with the
 * family's quick heuristic bots (`rollout`), and keeps the move that scores best on average. All
 * the game knowledge comes from the family's own rules engine — the search knows nothing about
 * any particular game — so partnership play, ducking, saving trumps and so on fall out of the
 * results instead of being written by hand.
 *
 * Strength is just how many imagined deals it plays, with a hard time cap so a slow phone never
 * thinks for long; moves with only one option cost nothing.
 */
export interface SearchGame<D> {
  /** A copy of `s` with the cards `seat` can't see dealt afresh, consistent with what it knows. */
  determinize(s: GameState<D>, seat: number): GameState<D>;
  /** The moves to compare. */
  candidates(s: GameState<D>, seat: number): Action[];
  /** Apply `seat`'s move to a copy. */
  apply(s: GameState<D>, seat: number, a: Action): void;
  /** Play on with the quick heuristics until the hand is over (in place). */
  rollout(s: GameState<D>): void;
  /** How good the finished hand `after` is for `seat`'s side, compared with `before` (higher is better). */
  score(before: GameState<D>, after: GameState<D>, seat: number): number;
}

export interface SearchBudget {
  /** Imagined deals per decision. */
  samples: number;
  /** Stop after this many milliseconds, whatever the count. */
  ms: number;
}

/** Bot skill levels (the `botLevel` option, which the lobby sets to Normal): 0 = the quick heuristics alone. */
export const BOT_LEVELS: (SearchBudget | null)[] = [null, { samples: 24, ms: 40 }, { samples: 120, ms: 160 }];
export const botLevel = (options: Record<string, number | boolean>) => Math.max(0, Math.min(2, Number(options.botLevel ?? 0) || 0));
export const botBudget = (options: Record<string, number | boolean>) => BOT_LEVELS[botLevel(options)] ?? null;

/** Under the test runner: fixed sample counts, no clock (a busy machine can't change an answer). */
export const TESTING = import.meta.env?.MODE === 'test';

/**
 * Easy bots play like beginners: their rules of thumb, with a slip now and then (a legal move
 * picked at random). Only at a table set to Easy (games built without the setting, as in tests,
 * play the rules of thumb straight).
 */
export const EASY_SLIPS = 0.2;

/** The Easy bot's move: `quick`, or now and then any one of `moves`. */
export function easyMove(options: Record<string, number | boolean>, moves: Action[], quick: Action | null): Action | null {
  if (options.botLevel === 0 && moves.length > 1 && Math.random() < EASY_SLIPS) return moves[Math.floor(Math.random() * moves.length)];
  return quick;
}

/**
 * Whether to draw another sample: up to `max`, at least `min`, until `stop` (a time) passes. In
 * tests the clock is left out (exactly `max`), so a busy machine can't change a bot's answer.
 */
export function moreSamples(runs: number, max: number, min: number, stop: number): boolean {
  return runs < max && (TESTING || runs < min || now() < stop);
}

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * How sure the search must be before it overrides the quick bot's move: the better move's lead,
 * deal for deal, in standard errors. A few imagined deals are noisy, and the move that did best
 * on them is often just the luckiest; the quick bots' rules are sound, so they stand unless the
 * search clearly beats them. More deals (Hard) make it surer, so it overrides more often.
 */
const CONFIDENCE = 1.5;

/** The same move? (Cards in any order.) */
const sameMove = (a: Action, b: Action) =>
  a.type === b.type && (a.amount ?? null) === (b.amount ?? null) && [...(a.cards ?? [])].sort().join() === [...(b.cards ?? [])].sort().join();

/**
 * The best move by sampling, or null if there's nothing to decide. With `quick` (the quick bot's
 * move), the search keeps to it unless another move is clearly better (see CONFIDENCE).
 */
export function searchMove<D>(game: SearchGame<D>, s: GameState<D>, seat: number, budget: SearchBudget, quick?: Action | null): Action | null {
  const moves = game.candidates(s, seat);
  if (moves.length <= 1) return moves[0] ?? null;
  const total = moves.map(() => 0);
  // each move's score on each imagined deal (they all play the same deals, so they compare pair by pair)
  const scores: number[][] = moves.map(() => []);
  let runs = 0;
  const stop = now() + budget.ms;
  // (in tests, a set number of deals rather than a time limit, so a busy machine can't change the
  // answer: about what a phone manages in that time)
  const samples = TESTING ? Math.min(budget.samples, Math.ceil(budget.ms / 4)) : budget.samples;
  while (runs < samples && (TESTING || runs === 0 || now() < stop)) {
    const deal = game.determinize(s, seat);
    moves.forEach((m, i) => {
      const sim = structuredClone(deal);
      try {
        game.apply(sim, seat, m);
        game.rollout(sim);
      } catch (e) {
        // a playout the rules stopped (an imagined deal no real one could lead to): score it as it
        // stands. Anything else is a bug in a bot or the rules: loud in tests, shrugged off at a table.
        if (!(e instanceof RuleError) && TESTING) throw e;
      }
      const v = game.score(s, sim, seat);
      total[i] += v;
      scores[i].push(v);
    });
    runs++;
  }
  let best = 0;
  for (let i = 1; i < moves.length; i++) if (total[i] > total[best]) best = i;
  const usual = quick ? moves.findIndex((m) => sameMove(m, quick)) : -1;
  if (usual < 0 || usual === best || runs < 2) return moves[best];
  const diff = scores[best].map((v, k) => v - scores[usual][k]);
  const mean = diff.reduce((a, b) => a + b, 0) / runs;
  const sd = Math.sqrt(diff.reduce((a, b) => a + (b - mean) ** 2, 0) / (runs - 1));
  return mean > CONFIDENCE * (sd / Math.sqrt(runs)) ? moves[best] : moves[usual];
}

/** Shuffle in place (Math.random: the search's private dice, not the game's). */
export function shuffled<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/**
 * Deal `pool` into `slots` (each wanting `count` cards and refusing cards `forbid` rejects), filling
 * the most constrained first. Falls back to ignoring the constraints if they can't all be met.
 */
export function dealConstrained(pool: string[], slots: { count: number; forbid?: (card: string) => boolean }[]): string[][] {
  for (let attempt = 0; attempt < 20; attempt++) {
    const left = shuffled([...pool]);
    const out: string[][] = slots.map(() => []);
    const order = slots.map((_, i) => i).sort((a, b) => Number(!!slots[b].forbid) - Number(!!slots[a].forbid));
    let ok = true;
    for (const i of order) {
      const { count, forbid } = slots[i];
      for (let k = 0; k < count; k++) {
        const j = left.findIndex((c) => !forbid?.(c));
        if (j < 0) {
          ok = false;
          break;
        }
        out[i].push(left.splice(j, 1)[0]);
      }
      if (!ok) break;
    }
    if (ok) return out;
  }
  const left = shuffled([...pool]);
  return slots.map((sl) => left.splice(0, sl.count));
}

// ---- helpers for writing a SearchGame -----------------------------------------------------

/**
 * A private copy of `s` to imagine with: no log (cheaper to copy), and every seat played by the
 * quick bots (so an imagined person never waits for input, or misses a "last card!" call).
 */
export function fork<D>(s: GameState<D>): GameState<D> {
  const c = structuredClone({ ...s, log: [] });
  for (const p of c.players) p.bot = true;
  return c;
}

/**
 * Deal the cards in `slots`' zones afresh among them, in place: each zone keeps its size, its
 * `fixed` cards (known to be there) stay put, and it takes no card its `forbid` rejects.
 */
export function dealUnseen(s: GameState<any>, slots: { zone: string; fixed?: string[]; forbid?: (card: string) => boolean }[]) {
  const live = slots.filter((sl) => s.zones[sl.zone]?.cards.length);
  const idsOf = (z: string) => s.zones[z].cards.map((c) => c.id);
  const fixedIn = (sl: (typeof live)[number]) => (sl.fixed ?? []).filter((x) => idsOf(sl.zone).includes(x));
  const pool = live.flatMap((sl) => idsOf(sl.zone).filter((x) => !fixedIn(sl).includes(x)));
  const want = live.map((sl) => ({ count: s.zones[sl.zone].cards.length - fixedIn(sl).length, forbid: sl.forbid }));
  const dealt = dealConstrained(pool, want);
  live.forEach((sl, k) => (s.zones[sl.zone].cards = [...fixedIn(sl), ...dealt[k]].map((id) => ({ id }))));
}

/** Play `s` on with `quick` (and the game's own automatic steps) until `done`, in place. */
export function playOut<D>(
  m: { system?(s: GameState<D>): { run(s: GameState<D>): void } | null; apply(s: GameState<D>, seat: number, a: Action): void },
  quick: (s: GameState<D>, seat: number) => Action | null,
  s: GameState<D>,
  done: (s: GameState<D>) => boolean,
  max = 600,
) {
  for (let i = 0; i < max && !done(s); i++) {
    const sys = m.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    // whoever's turn it is first, then anyone else with something to do
    const first = s.turn != null ? quick(s, s.turn) : null;
    const seat = first ? s.turn! : s.players.findIndex((p) => quick(s, p.seat));
    if (seat < 0) return;
    m.apply(s, seat, first ?? quick(s, seat)!);
  }
}

/** Points for `seat` against the average of everyone else (`lowWins`: fewer is better). */
export function edge(scoresBefore: number[], scoresAfter: number[], mine: number, lowWins = false) {
  const delta = scoresAfter.map((x, i) => x - scoresBefore[i]);
  const others = delta.filter((_, i) => i !== mine);
  const v = delta[mine] - others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
  return lowWins ? -v : v;
}
