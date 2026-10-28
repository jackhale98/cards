import { buildDeck } from '../../cards';
import { nextRandom, shuffle } from '../../rng';
import { hand, ids, log, moveCards, name } from '../../state';
import { assertRule, type Action, type ActionSpec } from '../../types';
import type { Call } from './contracts';
import { teamOf } from './sides';
import { callName, callOf, handInfo } from './systems/auction';
import { systemCall } from './systems/bidder';
import { biddingSystem } from './systems/choice';
import { callText, gradeCall, type Grade } from './systems/grade';
import { handOf } from './systems/hands';
import type { CoachNote, S, TrickGame } from './types';

/**
 * Bridge practice (the lobby's "Practice"): each deal is dealt for a topic, the openings or the
 * first answers to partner's opening, to the first person at the table (the bots bid around them),
 * and each person's first call of the deal is graded by the system's rules (systems/grade.ts), in
 * a note only they see. A call the book doesn't make can be tried again while the auction lasts;
 * a new practice deal can be had any time. Everything else is an ordinary game of bridge: the deal
 * is bid out and played, and scored.
 */

/** The topics, as the lobby lists them (0: no practice). */
export const TOPICS = ['Off', 'Openings', 'Answering 1♣ or 1♦', 'Answering 1♥ or 1♠', 'Answering 1NT or 2NT', 'Answering 2♣ or a weak two', 'Any of these'];
/** For each answering topic, partner's openings. */
const OPENINGS: Record<number, string[]> = { 2: ['1C', '1D'], 3: ['1H', '1S'], 4: ['1N', '2N'], 5: ['2C', '2D', '2H', '2S'] };
/** How many deals to try for one that fits the topic (each a shuffle and a call or two), before taking the last. */
const TRIES = 4000;

/** The practice topic at this table (0: none). Practice is four at a bridge table, not duplicate. */
export const practiceTopic = (g: TrickGame, s: S) => (g.bridgeBids && s.players.length === 4 && !s.data.boards ? Number(s.options.practice ?? 0) : 0);

/** Deal the next practice hand: the dealer and the cards to fit the topic, from the game's dice. */
export function practiceDeal(g: TrickGame, s: S) {
  const d = s.data;
  const student = Math.max(
    0,
    s.players.findIndex((p) => !p.bot),
  );
  d.practice ??= { student, notes: [], undo: [], tally: s.players.map(() => ({ book: 0, graded: 0 })) };
  d.practice.notes = s.players.map(() => null);
  d.practice.undo = s.players.map(() => null);
  const chosen = practiceTopic(g, s);
  const topic = chosen === 6 ? 1 + Math.floor(nextRandom(s) * 5) : chosen;
  const system = biddingSystem(g, s) ?? 'sayc';
  const partner = (student + 2) % 4;
  s.dealer = topic === 1 ? student : partner;
  const none: [boolean, boolean] = [false, false];
  let hands: string[][] = [];
  for (let k = 0; k < TRIES; k++) {
    const deck = shuffle(buildDeck(g.config.deck), s);
    hands = [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13));
    if (topic === 1) {
      // something to open, or nearly: mostly; now and then a hand to pass
      const h = handInfo(handOf(hands[student]));
      if (h.hcp >= 10 || (h.hcp >= 5 && h.len.some((n) => n >= 6)) || nextRandom(s) < 0.1) break;
      continue;
    }
    // partner opens as the topic says, and the next player passes
    const open = callName(systemCall(system, [], partner, none, handOf(hands[partner])));
    if (!OPENINGS[topic].includes(open)) continue;
    const next = (partner + 1) % 4;
    if (systemCall(system, [{ seat: partner, call: callOf(open) }], next, none, handOf(hands[next])) === 'P') break;
  }
  hands.forEach((cards, seat) => moveCards(s, 'deck', `hand:${seat}`, cards));
}

/** Each person's first call of a practice deal: graded before it's made, the note kept for them alone. */
export function gradePractice(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  const p = d.practice;
  if (!p || s.phase !== 'call' || s.turn !== seat || s.players[seat]?.bot || p.notes[seat] || d.calls!.some((c) => c.seat === seat)) return;
  const call: Call | null =
    a.type === 'call' ? Math.floor(a.amount ?? -1) : a.type === 'decline' ? 'P' : a.type === 'double' ? 'X' : a.type === 'redouble' ? 'XX' : null;
  if (call == null || (typeof call === 'number' && (call < 0 || call > 34))) return;
  const system = biddingSystem(g, s);
  const first = p.undo[seat] == null;
  p.undo[seat] = d.calls!.length;
  if (!system) {
    p.notes[seat] = { tone: 'info', title: 'Practice grades SAYC or two over one', lines: ['Choose one in the lobby’s “Bots bid”.'] };
    return;
  }
  const team = teamOf(g, s, seat);
  const vul = d.vul ?? [false, false];
  const grade = gradeCall(system, d.calls!, seat, [!!vul[team], !!vul[1 - team]], handOf(ids(hand(s, seat))), call);
  p.notes[seat] = noteOf(grade);
  // (the first try at a deal counts; a try again doesn't)
  if (first && grade.verdict !== 'judgment') {
    p.tally[seat].graded++;
    if (grade.verdict === 'book') p.tally[seat].book++;
  }
}

/** The coach's words for a grade. */
export function noteOf(x: Grade): CoachNote {
  const mine = callText(x.call);
  const book = callText(x.book);
  const bookLine = `The book: ${book}${x.bookSays ? `, ${x.bookSays}` : x.book === 'P' ? ', nothing in the system fits this hand' : ''}`;
  switch (x.verdict) {
    case 'book':
      return { tone: 'good', title: `${mine}: by the book`, lines: [x.says || (x.call === 'P' ? 'Nothing in the system fits this hand' : '')].filter(Boolean) };
    case 'allowed':
      return { tone: 'fair', title: `${mine} fits, but the book prefers ${book}`, lines: [`${mine}: ${x.says}`, bookLine] };
    case 'breaks':
      return {
        tone: 'off',
        title: x.call === 'P' ? 'The book doesn’t pass this hand' : `${mine} doesn’t fit this hand`,
        lines: [...(x.says && x.reasons.length ? [`${mine} shows ${x.says}: it needs ${x.reasons.join('; ')}`] : []), bookLine],
      };
    case 'uncovered':
      return { tone: 'info', title: `${mine} isn’t in our system notes here`, lines: [bookLine] };
    case 'judgment':
      return x.call === x.book
        ? { tone: 'info', title: `${mine}: as the bots would bid`, lines: ['No rule covers this call: it’s judgment'] }
        : { tone: 'info', title: 'No rule covers this call: it’s judgment', lines: [`The bots would bid ${book}`] };
  }
}

/** Practice's own moves: try the call again (while the auction lasts), or a new deal. */
export function practiceActions(s: S, seat: number): ActionSpec[] {
  const p = s.data.practice;
  if (!p || seat < 0 || s.players[seat]?.bot) return [];
  const out: ActionSpec[] = [];
  const note = p.notes[seat];
  if (s.phase === 'call' && note && note.tone !== 'good' && p.undo[seat] != null) out.push({ type: 'practiceRetry', label: 'Try again', style: 'quiet' });
  if (s.phase !== 'gameOver') out.push({ type: 'practiceNew', label: 'New practice deal', menu: true });
  return out;
}

/** Take back a graded call (and the bots' calls after it): the auction as it was, to try again. */
export function retryPractice(s: S, seat: number) {
  const p = s.data.practice;
  assertRule(!!p && s.phase === 'call' && !!p.notes[seat] && p.undo[seat] != null, 'Nothing to try again');
  s.data.calls!.length = p!.undo[seat]!;
  p!.notes[seat] = null;
  s.turn = seat;
  log(s, `${name(s, seat)} takes the call back to try again`, seat);
}
