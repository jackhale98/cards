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
  think(game: string, s: GameState, seats: number[]): Thought | Promise<Thought>;
  close(): void;
  onError: (e: unknown, game: string, phase: string) => void;
}

/** First bot in `seats` with a move, worked out here and now. */
export function pickNow(game: string, s: GameState, seats: number[]): Pick | null {
  const m = rulesFor(game);
  return m ? pickWith(m, s, seats) : null;
}

/** Bots think on the host's own thread (tests, and browsers without workers). */
export function inlineBrain(): Brain {
  const brain: Brain = {
    think(game, s, seats) {
      try {
        return pickNow(game, s, seats);
      } catch (e) {
        brain.onError(e, game, s.phase);
        return 'failed';
      }
    },
    close() {},
    onError: () => {},
  };
  return brain;
}

/**
 * Messages to and from the bot worker (botWorker.ts). The game's own settings come along (the
 * worker builds its rules from them), so the worker needn't download every game's file.
 */
export type BrainRequest = { id: number; game: string; config: GameConfig; state: GameState; seats: number[] };
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
    for (const { resolve, req } of [...waiting.values(), ...(queued ? [queued] : [])]) resolve(fallback.think(req.game, req.state, req.seats) as Thought);
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
        brain.onError(new Error(e.data.error), w.req.game, w.req.state.phase);
        // (once more here: the worker may have failed to load the rules, which this thread has)
        w.resolve(fallback.think(w.req.game, w.req.state, w.req.seats) as Thought);
      } else w.resolve(e.data.pick);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      giveUp();
    };
  }
  const brain: Brain = {
    think(game, state, seats) {
      const m = rulesFor(game);
      if (!worker || !m) return fallback.think(game, state, seats);
      const req: BrainRequest = { id: ++next, game, config: m.config, state, seats };
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
