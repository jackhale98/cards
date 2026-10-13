import { parseCard, rankLabel, SUIT_NAME } from '../engine/cards';
import type { GameState, LogEntry } from '../engine/types';

/**
 * The record of a whole game, for saving as a spreadsheet: every hand's moves (the table's log,
 * which only ever names cards everyone has seen), each player's cards at the deal, and the result.
 * Kept by the host as plain text, so even a long game costs little. Each player's copy holds
 * only their own cards (see `toCsv`).
 */
export interface RecordedHand {
  /** Each seat's cards at the deal (the host's copy: `toCsv` gives a player only theirs). */
  dealt: string[][];
  moves: { seat?: number; text: string }[];
  result: string[];
}

/** Most moves kept for one game (a long night of rummy is a few thousand). */
const MAX_MOVES = 20_000;

export class GameRecord {
  readonly hands: RecordedHand[] = [];
  private open: RecordedHand | null = null;
  /** The last log line taken, so each line is taken once (the log only keeps the latest few). */
  private last: string | null = null;
  private moves = 0;

  /**
   * After each change at the table: take the new log lines, and note a hand starting (its deal)
   * or ending (`ended`, with the result lines).
   */
  note(s: GameState, ended: boolean, result: () => string[]) {
    if (!this.open && !ended) {
      this.open = { dealt: s.players.map((p) => (s.zones[`hand:${p.seat}`]?.cards ?? []).map((c) => c.id)), moves: [], result: [] };
      this.hands.push(this.open);
    }
    const key = (e: LogEntry) => `${e.t}|${e.text}`;
    let from = 0;
    for (let i = s.log.length - 1; this.last !== null && i >= 0; i--) {
      if (key(s.log[i]) === this.last) {
        from = i + 1;
        break;
      }
    }
    const fresh = s.log.slice(from);
    if (fresh.length) this.last = key(fresh[fresh.length - 1]);
    const hand = this.open ?? this.hands[this.hands.length - 1];
    if (hand)
      for (const e of fresh) {
        if (this.moves >= MAX_MOVES) break;
        hand.moves.push({ seat: e.seat, text: e.text });
        this.moves++;
      }
    if (ended && this.open) {
      this.open.result = result();
      this.open = null;
    }
  }
}

/**
 * Cards in plain letters, as card records (hand histories, bridge's PBN) write them, so a
 * spreadsheet can search and sort them and any font shows them: "AS", "10H", "QD", a joker "Joker".
 */
export function cardCode(id: string): string {
  const c = parseCard(id);
  return c.suit === 'X' ? 'Joker' : `${rankLabel(c.rank)}${c.suit}`;
}

const LETTER: Record<string, string> = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

/**
 * The table's words, with suit symbols in letters: a card or a bid ("10♦", "1 ♠") reads "10D",
 * "1S"; a suit on its own ("♥ broken") is spelled out ("Hearts broken").
 */
export function plainText(text: string): string {
  return text
    .replace(/JK★/g, 'Joker')
    .replace(/\b(10|[1-9AKQJ]) ?([♠♥♦♣])/g, (_, rank: string, suit: string) => rank + LETTER[suit])
    .replace(/[♠♥♦♣]/g, (suit) => {
      const name = SUIT_NAME[LETTER[suit] as keyof typeof SUIT_NAME];
      return name[0].toUpperCase() + name.slice(1);
    })
    .replace(/★/g, '*');
}

/**
 * One spreadsheet cell. Text that a spreadsheet would run as a formula (a player named
 * "=HYPERLINK(…)") is kept as text; commas, quotes and line breaks are quoted.
 */
function cell(v: string | number): string {
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * The game as CSV, one row a move, for the player in `seat` (-1: someone watching): a Deal row
 * starting each hand (with that player's own cards), the moves, then the result.
 */
export function toCsv(record: GameRecord, seat: number, names: string[]): string {
  const rows: (string | number)[][] = [['Hand', 'Move', 'Player', 'What happened', 'Your cards']];
  record.hands.forEach((h, i) => {
    const mine = seat >= 0 ? (h.dealt[seat] ?? []).map(cardCode).join(' ') : '';
    rows.push([i + 1, '', '', 'Deal', mine]);
    h.moves.forEach((m, j) => rows.push([i + 1, j + 1, m.seat != null ? (names[m.seat] ?? '') : '', plainText(m.text), '']));
    for (const line of h.result) rows.push([i + 1, '', '', `Result: ${plainText(line)}`, '']);
  });
  // (cards and suits are plain letters; the byte-order mark tells Excel the file is UTF-8, for
  // names with accents and the like)
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
