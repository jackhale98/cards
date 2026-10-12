/// <reference lib="webworker" />
/**
 * The bots' thinking, off the main thread (see brain.ts): the host posts the game as it stands and
 * which bots might move; this loads that game's rules (once) and answers with the first bot's move.
 */
import { loadRules } from '../games';
import { pickNow, type BrainReply, type BrainRequest } from './brain';

self.onmessage = async (e: MessageEvent<BrainRequest>) => {
  const { id, game, state, seats } = e.data;
  let reply: BrainReply;
  try {
    await loadRules(game);
    reply = { id, pick: pickNow(game, state, seats) };
  } catch (err) {
    reply = { id, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
