import { rulesFor } from '../games';
import type { Action, GameConfig, GameState } from '../engine/types';
import { pickWith } from './pick';

/** A bot's move: which bot, and what it does. */
export interface Pick {
  seat: number;
  action: Action;
}

/** A bot's answer: its move, null (no bot has anything to do), or `'failed'` (a bot threw). */
export type Thought = Pick | null | 'failed';

/**
 * Where bots think. The host asks for the next move of the first of `seats` (bots, in seat order)
 * that has one. The answer can come back at once (`inlineBrain`, in tests and as a fallback) or
 * later (`workerBrain`: a background thread, so a bot thinking hard never makes the host's phone
 * stutter). A bot that fails is reported through `onError` and answers `'failed'`: the host then
 * finds a plain legal move for it, so the table never waits on a broken bot.
 */
export interface Brain {
  /** `views`: each seat's own view of the game (botView.ts), the only game a bot gets to see. */
  think(game: string, views: Record<number, GameState>, seats: number[]): Thought | Promise<Thought>;
  close(): void;
  onError: (e: unknown, game: string, phase: string) => void;
}

/** First bot in `seats` with a move, worked out here and now. */
export function pickNow(game: string, views: Record<number, GameState>, seats: number[]): Pick | null {
  const m = rulesFor(game);
  return m ? pickWith(m, views, seats) : null;
}

/** Bots think on the host's own thread (tests, and browsers without workers). */
export function inlineBrain(): Brain {
  const brain: Brain = {
    think(game, views, seats) {
      try {
        return pickNow(game, views, seats);
      } catch (e) {
        brain.onError(e, game, views[seats[0]]?.phase ?? '');
        return 'failed';
      }
    },
    close() {},
    onError: () => {},
  };
  return brain;
}

/**
 * One brain for several tables (a tournament director hosting many). A worker brain answers one
 * question at a time and lets a newer question replace one still waiting, which is right for one
 * table (it has moved on) but would drop another table's question for good: that table's bots
 * would never move again. Here each table keeps its own newest question, and the tables take
 * turns at the brain.
 */
export function shareBrain(inner: Brain): { table(id: string): Brain; close(): void } {
  type Ask = { game: string; views: Record<number, GameState>; seats: number[]; resolve: (p: Thought) => void };
  // (a Map keeps the order tables first asked in: a newer question keeps its table's place)
  const waiting = new Map<string, Ask>();
  const tables = new Map<string, Brain>();
  let asking: string | null = null;
  inner.onError = (e, game, phase) => (asking != null ? tables.get(asking)?.onError(e, game, phase) : undefined);
  const next = () => {
    if (asking != null) return;
    const first = waiting.entries().next();
    if (first.done) return;
    const [id, ask] = first.value;
    waiting.delete(id);
    asking = id;
    const answer = (p: Thought) => {
      asking = null;
      ask.resolve(p);
      next();
    };
    try {
      Promise.resolve(inner.think(ask.game, ask.views, ask.seats)).then(answer, () => answer('failed'));
    } catch (e) {
      tables.get(id)?.onError(e, ask.game, ask.views[ask.seats[0]]?.phase ?? '');
      answer('failed');
    }
  };
  return {
    table(id) {
      const brain: Brain = {
        think: (game, views, seats) =>
          new Promise<Thought>((resolve) => {
            // (this table's older question is out of date: answered "nothing", as a worker would)
            waiting.get(id)?.resolve(null);
            waiting.set(id, { game, views, seats, resolve });
            next();
          }),
        close() {
          waiting.get(id)?.resolve(null);
          waiting.delete(id);
          tables.delete(id);
        },
        onError: () => {},
      };
      tables.set(id, brain);
      return brain;
    },
    close() {
      for (const ask of waiting.values()) ask.resolve(null);
      waiting.clear();
      inner.close();
    },
  };
}

/**
 * Messages to and from the bot worker (botWorker.ts). The game's own settings come along (the
 * worker builds its rules from them), so the worker needn't download every game's file.
 */
export type BrainRequest = { id: number; game: string; config: GameConfig; views: Record<number, GameState>; seats: number[] };
export type BrainReply = { id: number; pick: Pick | null } | { id: number; error: string };

/**
 * Bots think in a Web Worker. If the worker can't start (or dies), they quietly carry on thinking
 * on the main thread instead: slower to feel, but the game never stalls.
 */
export function workerBrain(): Brain {
  const fallback = inlineBrain();
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  let next = 0;
  const waiting = new Map<number, { resolve: (p: Thought) => void; req: BrainRequest }>();
  /**
   * One question at a time: a newer one waits for the worker to finish the one it's on, and
   * replaces any other waiting (the table has moved on: the host would ignore that answer anyway).
   */
  let busy = false;
  let queued: { resolve: (p: Thought) => void; req: BrainRequest } | null = null;
  const post = (w: { resolve: (p: Thought) => void; req: BrainRequest }) => {
    busy = true;
    waiting.set(w.req.id, w);
    try {
      worker!.postMessage(w.req);
    } catch {
      giveUp();
    }
  };
  const done = () => {
    busy = false;
    const q = queued;
    queued = null;
    if (q && worker) post(q);
  };
  const giveUp = () => {
    worker?.terminate();
    worker = null;
    busy = false;
    // whatever was asked meanwhile gets answered here instead
    for (const { resolve, req } of [...waiting.values(), ...(queued ? [queued] : [])]) resolve(fallback.think(req.game, req.views, req.seats) as Thought);
    waiting.clear();
    queued = null;
  };
  if (worker) {
    worker.onmessage = (e: MessageEvent<BrainReply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      done();
      if ('error' in e.data) {
        brain.onError(new Error(e.data.error), w.req.game, w.req.views[w.req.seats[0]]?.phase ?? '');
        // (once more here: the worker may have failed to load the rules, which this thread has)
        w.resolve(fallback.think(w.req.game, w.req.views, w.req.seats) as Thought);
      } else w.resolve(e.data.pick);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      giveUp();
    };
  }
  const brain: Brain = {
    think(game, views, seats) {
      const m = rulesFor(game);
      if (!worker || !m) return fallback.think(game, views, seats);
      const req: BrainRequest = { id: ++next, game, config: m.config, views, seats };
      return new Promise((resolve) => {
        if (!busy) return post({ resolve, req });
        // (the one this replaces is answered "nothing": it's out of date)
        queued?.resolve(null);
        queued = { resolve, req };
      });
    },
    close() {
      worker?.terminate();
      worker = null;
      waiting.clear();
      queued = null;
    },
    onError: () => {},
  };
  fallback.onError = (e, game, phase) => brain.onError(e, game, phase);
  return brain;
}
