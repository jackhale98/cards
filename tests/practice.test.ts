import { describe, expect, it } from 'vitest';
import type { TrickData } from '../src/engine/families/trick';
import { callName } from '../src/engine/families/trick/systems/auction';
import { gradeCall } from '../src/engine/families/trick/systems/grade';
import { handOf } from '../src/engine/families/trick/systems/hands';
import { hand, ids } from '../src/engine/state';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['bridge'] as GameModule<TrickData>;
type S = GameState<TrickData>;

/** Ann (seat 0) with three bots, practising `topic` (the lobby's "Practice bidding"). */
function table(topic: number, seed = 1, system = 1): S {
  return g.setup([{ name: 'Ann' }, ...['B', 'C', 'D'].map((name) => ({ name, bot: true }))], seed, { practice: topic, system }) as S;
}
/** The bots call until it's Ann's turn. */
function toAnn(s: S) {
  for (let i = 0; i < 8 && s.phase === 'call' && s.turn !== 0; i++) g.apply(s, s.turn!, g.bot!(s, s.turn!)!);
  expect(s.turn).toBe(0);
}
/** The call the system's rules give Ann's hand now. */
function bookCall(s: S): string {
  const calls = s.data.calls!;
  return gradeCall('sayc', calls, 0, [false, false], handOf(ids(hand(s, 0))), 'P').book;
}
const act = (name: string) => (name === 'P' ? { type: 'decline' } : { type: 'call', amount: (Number(name[0]) - 1) * 5 + 'CDHSN'.indexOf(name[1]) });

describe('bridge practice', () => {
  it('deals each topic: Ann opens, or answers partner’s opening of the topic with the next player passing', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const open = table(1, seed);
      expect(open.dealer).toBe(0);
      expect(open.turn).toBe(0);
      for (const [topic, openings] of [
        [2, ['1C', '1D']],
        [3, ['1H', '1S']],
        [4, ['1N', '2N']],
        [5, ['2C', '2D', '2H', '2S']],
      ] as const) {
        const s = table(topic, seed);
        expect(s.dealer).toBe(2);
        toAnn(s);
        const [partner, next] = s.data.calls!;
        expect(openings).toContain(callName(partner.call));
        expect(next.call).toBe('P');
      }
    }
  });

  it('grades Ann’s first call in a note only she sees, and keeps a tally', () => {
    const s = table(3, 4);
    toAnn(s);
    const book = bookCall(s);
    g.apply(s, 0, act(book) as never);
    const note = s.data.practice!.notes[0]!;
    expect(note.tone).toBe('good');
    expect(note.title).toMatch(/by the book/);
    expect(g.status(s, 0).coach).toEqual(note);
    expect(g.status(s, 0).hint).toBe('Practice: 1 of 1 by the book');
    // nobody else sees it: not in their view of the game, nor in their status
    for (const viewer of [1, 2, 3, -1]) {
      expect(g.redactData!(s, viewer).practice!.notes.every((x) => x == null)).toBe(true);
      expect(g.status(s, viewer).coach).toBeUndefined();
    }
  });

  it('a call off the book can be tried again while the auction lasts; the try again isn’t counted', () => {
    const s = table(1, 3);
    expect(s.turn).toBe(0);
    const book = bookCall(s);
    const wrong = book === '1C' ? '1D' : '1C';
    g.apply(s, 0, act(wrong) as never);
    expect(s.data.practice!.notes[0]!.tone).not.toBe('good');
    expect(g.actions(s, 0).map((a) => a.type)).toContain('practiceRetry');
    // (the bots call on after it)
    for (let i = 0; i < 3 && s.phase === 'call' && s.turn !== 0; i++) g.apply(s, s.turn!, g.bot!(s, s.turn!)!);
    expect(s.phase).toBe('call');
    g.apply(s, 0, { type: 'practiceRetry' });
    expect(s.data.calls).toEqual([]);
    expect(s.turn).toBe(0);
    g.apply(s, 0, act(book) as never);
    expect(s.data.practice!.notes[0]!.tone).toBe('good');
    expect(s.data.practice!.tally[0]).toEqual({ book: 0, graded: 1 });
  });

  it('only a person’s first call of the deal is graded; a new practice deal starts the next one', () => {
    const s = table(1, 5);
    g.apply(s, 0, act(bookCall(s)) as never);
    const note = s.data.practice!.notes[0];
    // the auction goes on: Ann's later calls aren't graded (the bots' judgment, past the first round)
    while (s.phase === 'call') g.apply(s, s.turn!, s.turn === 0 ? { type: 'decline' } : g.bot!(s, s.turn!)!);
    expect(s.data.practice!.notes[0]).toBe(note);
    g.apply(s, 0, { type: 'practiceNew' });
    expect(s.phase).toBe('call');
    expect(s.data.calls).toEqual([]);
    expect(s.data.practice!.notes[0]).toBeNull();
    expect(s.data.practice!.tally[0].graded).toBe(1);
  });

  it('with the bots bidding Natural, there’s no system to grade by: the note says so', () => {
    const s = table(1, 2, 0);
    g.apply(s, 0, { type: 'decline' });
    expect(s.data.practice!.notes[0]!.title).toMatch(/SAYC or two over one/);
  });

  it('off, a bridge table deals as ever: no practice', () => {
    const s = table(0, 1);
    expect(s.data.practice).toBeUndefined();
    expect(g.actions(s, 0).some((a) => a.type.startsWith('practice'))).toBe(false);
  });
});
