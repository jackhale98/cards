/// <reference lib="webworker" />
/**
 * The bots' thinking, off the main thread (see brain.ts): the host posts the game as it stands,
 * its settings, and which bots might move; this builds that game's rules (once) and answers with
 * the first bot's move. Only the rules family is downloaded here, not the list of games.
 */
import { loadModule } from '../engine/families';
import type { GameModule } from '../engine/types';
import type { BrainReply, BrainRequest } from './brain';
import { pickWith } from './pick';

const modules = new Map<string, Promise<GameModule>>();

self.onmessage = async (e: MessageEvent<BrainRequest>) => {
  const { id, game, config, views, seats } = e.data;
  let reply: BrainReply;
  try {
    let m = modules.get(game);
    if (!m) modules.set(game, (m = loadModule(config)));
    reply = { id, pick: pickWith(await m, views, seats) };
  } catch (err) {
    modules.delete(game);
    reply = { id, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
