/** The host's limits and timings: how often it checks on everyone, backs up, keeps replays. */

/** How often the host checks on everyone (a timer: nothing is sent unless someone needs a ping). */
export const HEARTBEAT_MS = 3000;
/**
 * A connection we haven't heard from for this long gets a ping (its moves and answers show it's
 * there): in practice one every 9 seconds. Each ping and answer costs a phone's data and wakes its
 * radio; over a game night of hours they would outnumber the game's own messages.
 */
export const PING_AFTER_MS = 7000;
/** Round-trip times are refreshed at least this often, even for a connection that's talking anyway. */
export const RTT_EVERY_MS = 30_000;
/** A peer silent for this long is treated as gone (it keeps its seat and can come back): two pings unanswered. */
export const DEAD_AFTER_MS = 20_000;
export const UNDO = '__undo';
/** With take-backs on, bots and automatic steps wait this much longer after a person's move (time to take it back). */
export const TAKE_BACK_MS = 1500;
/** Anyone at the table can mute (amount 0) or unmute the table screens: a Chromecast has no menu of its own. */
export const SCREEN_SOUND = '__screenSound';
/** Anyone at the table can let a bot play for a player who has dropped (`seat`: their game seat) until they're back. */
export const STAND_IN = '__standIn';
/**
 * Host handoff: two players hold a sealed backup (one is enough to take over; two in case one has
 * gone too). It's sent when a trick or hand ends, and otherwise at most this often: a game night
 * lasts hours, and every backup costs the holders' data.
 */
export const BACKUP_EVERY_MS = 30000;
/** Backups after a trick or a hand wait this long, so a burst of moves makes one backup. */
export const BACKUP_SOON_MS = 1000;
export const BACKUP_HOLDERS = 2;
export const BOT_NAMES = ['Ada', 'Bix', 'Cleo', 'Dash', 'Echo', 'Fizz', 'Gus', 'Hux', 'Ivy'];
/** A connection's hellos are handled at most this often; a burst is folded into its latest. */
export const HELLO_GAP_MS = 400;
/** How many different seats one connection may ask for in a minute (a client keeps one id). */
export const IDENTITIES_PER_MINUTE = 3;
/** Finished hands kept for replay, and the most moments kept of one hand. */
export const REPLAY_HANDS = 5;
/** The phases a hand ends in, across the families. */
export const END_PHASES = new Set(['handOver', 'roundOver', 'gameOver']);
export const REPLAY_STEPS = 600;
/** Most moments kept across all the replay hands (each is a whole game state: memory adds up). */
export const REPLAY_TOTAL = 1200;
/** Replay frames one connection may ask for a second (stepping, or playing a hand back). */
export const FRAMES_PER_SECOND = 20;
/** Most people at one table (more than any game seats: the rest sit out and rotate in). */
export const TABLE_MAX = 16;
