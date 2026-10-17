import type { LogEntry } from '../../engine/types';
import type { ScoreHistory } from '../../net/protocol';
import type { Sound } from '../sound';

/**
 * What the table says about what just happened: the line under the headline, what a screen
 * reader hears, the sound of a move, the hand's summary. Pure: the table's state in, words out.
 */

/**
 * The latest move, shown under the headline, unless the headline already says it, or the start
 * of it ("Dash wins the pot (1213)" over "Dash wins the pot (1213) with two pair").
 */
export function lastMoveOf(entry: LogEntry | undefined, headline: string | undefined): LogEntry | null {
  const h = headline ?? '';
  if (!entry || h.includes(entry.text)) return null;
  if (h.split(' · ').some((part) => part && entry.text.startsWith(part))) return null;
  return entry;
}

const SUIT_WORDS: Record<string, string> = { '♠': ' spades', '♥': ' hearts', '♦': ' diamonds', '♣': ' clubs' };

/** What a screen reader hears: the latest move, then whether it's your turn (suits as words). */
export function announceText(entry: LogEntry | undefined, yourTurn: boolean): string {
  return [entry?.text, yourTurn ? 'Your turn.' : '']
    .filter(Boolean)
    .join('. ')
    .replace(/[♠♥♦♣]/g, (x) => SUIT_WORDS[x]);
}

/** The sound a move makes, from what the log says happened (none for a move that's only words). */
export function soundFor(e: Pick<LogEntry, 'text' | 'fromZone' | 'toZone'>, chips: boolean): Sound | null {
  const t = e.text.toLowerCase();
  if (/\b(deals?|shuffles?)\b/.test(t)) return 'deal';
  if (chips && /\b(bets?|raises?|calls?|all in|antes?|blinds?|wins?|splits?|doubles?|insures?|pays?)\b/.test(t)) return 'chips';
  if (e.toZone || e.fromZone || /\b(plays?|leads?|discards?|draws?|lays?|melds?|turns? (?:over|up)|slaps?|passes \d)\b/.test(t)) return 'card';
  return null;
}

/**
 * What each player (or team) made or lost in the hand just finished, from the score history
 * ("Ann +40 · Bo −40"): none when nobody's score changed, or when the result already says it
 * (its lines show the totals moving, "→").
 */
export function recapOf(history: ScoreHistory | null, bannerLines: string[] | undefined): string | null {
  if (!history || history.totals.length < 2) return null;
  if (bannerLines?.some((l) => l.includes('→'))) return null;
  const [prev, now] = history.totals.slice(-2);
  const parts = history.names.flatMap((name, j) => {
    const d = now[j] - prev[j];
    return d ? [`${name} ${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}`] : [];
  });
  return parts.length ? parts.join(' · ') : null;
}
