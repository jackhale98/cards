import { redact } from '../../engine/redact';
import { nightPoints, standingsOf } from '../../engine/state';
import type { Action, GameModule, GameState } from '../../engine/types';
import type { ExportFormat } from '../exports/formats';
import type { HandFormat } from '../exports/types';
import { GameRecord, toCsv } from '../gameRecord';
import type { Frame, Lobby, LobbySeat } from '../protocol';
import { END_PHASES, REPLAY_HANDS, REPLAY_STEPS, REPLAY_TOTAL } from './limits';
import { finalScores, SCORE_HANDS, totalsOf } from './records';

/**
 * The game as it went: the last few hands, every moment of each as the host saw it (for replays,
 * each moment redacted for whoever asks), and the whole game move by move (saved as a spreadsheet
 * or a game's standard record).
 */
export class Hands {
  /** `total`: the most moments kept across the replay hands. */
  constructor(private readonly total = REPLAY_TOTAL) {}
  /** Finished hands of this game, oldest first. */
  private done: GameState[][] = [];
  /** The hand being played now, so far. */
  private recording: GameState[] | null = null;
  private game = new GameRecord();

  /** A new game (followed in these standard formats too), or none. */
  reset(formats?: Partial<Record<ExportFormat, HandFormat<unknown>>>) {
    this.done = [];
    this.recording = null;
    this.game = new GameRecord(formats);
  }

  /** How many finished hands there are to replay. */
  get count() {
    return this.done.length;
  }

  /** `s` is the last moment of the latest finished hand: the hand on the table has just ended. */
  justEnded(s: GameState) {
    return this.done.at(-1)?.at(-1) === s;
  }

  /**
   * Keep this moment. A hand ends in one of the end phases every family uses (or when the game
   * shows a result banner); the next starts with the next deal. Real-time games are a blur: not
   * kept. The states are the host's own (each move makes a new one), so keeping them costs no
   * copying. True when a hand has just ended.
   */
  record(m: GameModule, s: GameState, move: { seat: number; action: Action } | undefined): boolean {
    if (m.realtime) return false;
    const ended = END_PHASES.has(s.phase) || !!m.status(s, 0).banner;
    this.game.note(
      s,
      ended,
      () => {
        // (the result as someone watching sees it: no "you")
        try {
          return m.status(s, -1).banner?.lines ?? [];
        } catch {
          return [];
        }
      },
      move,
    );
    if (!ended) {
      this.recording ??= [];
      if (this.recording.length < REPLAY_STEPS && this.recording.at(-1) !== s) this.recording.push(s);
      return false;
    }
    if (!this.recording) return false;
    this.recording.push(s);
    this.done.push(this.recording);
    if (this.done.length > REPLAY_HANDS) this.done.shift();
    while (this.done.length > 1 && this.done.reduce((n, h) => n + h.length, 0) > this.total) this.done.shift();
    this.recording = null;
    return true;
  }

  /**
   * A moment of a finished hand, as `seat` saw it then: their own cards, and everyone else's only
   * if they were shown. `hand` counts back from the latest (0); `step` is clamped to the hand.
   */
  frame(m: GameModule, seat: number, hand: number, step: number): Frame | null {
    const hands = this.done.length;
    if (!hands || !Number.isInteger(hand) || !Number.isInteger(step)) return null;
    const h = Math.max(0, Math.min(hands - 1, hand));
    const frames = this.done[hands - 1 - h];
    const at = Math.max(0, Math.min(frames.length - 1, step));
    const s = frames[at];
    return { hand: h, hands, step: at, steps: frames.length, state: redact(m, s, seat), status: m.status(s, seat) };
  }

  /** The game so far as a file, for `seat`: the spreadsheet (only their own cards), or a standard record. */
  file(s: GameState, seat: number, format: ExportFormat, table: string): string | null {
    const names = s.players.map((p) => p.name);
    if (format === 'csv') return toCsv(this.game, seat, names);
    return this.game.write(format, seat, { names, table });
  }
}

/** Add everyone's total now to the game's score history (at the deal, and as each hand ends). */
export function noteScores(lobby: Lobby, m: GameModule, s: GameState, atDeal = false) {
  const t = totalsOf(m, s, atDeal);
  if (!t) return;
  const h = lobby.scores;
  if (!h || h.names.join('|') !== t.names.join('|')) lobby.scores = { names: t.names, totals: [t.totals] };
  else {
    h.totals.push(t.totals);
    // (the deal and the latest hands: a long poker night stays small)
    if (h.totals.length > SCORE_HANDS + 1) h.totals.splice(1, 1);
  }
}

/** Add a game that has just finished to tonight's tally (once; a rematch starts a new one). */
export function tally(lobby: Lobby, m: GameModule, s: GameState, players: LobbySeat[]) {
  if (s.phase !== 'gameOver') {
    s.tallied = false;
    return;
  }
  if (s.tallied || !s.winner?.length) return;
  s.tallied = true;
  const places = standingsOf(m, s);
  lobby.night ??= { games: [] };
  lobby.night.games.push({
    game: m.config.id,
    name: m.config.name,
    at: Date.now(),
    results: players.map((seat, i) => ({ id: seat.id, name: seat.name, place: places[i], points: nightPoints(places[i], places) })),
    final: finalScores(m, s),
  });
}
