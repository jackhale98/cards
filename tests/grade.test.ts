import { describe, expect, it } from 'vitest';
import { callOf } from '../src/engine/families/trick/systems/auction';
import { handOf } from '../src/engine/families/trick/systems/hands';
import { gradeCall } from '../src/engine/families/trick/systems/grade';
import type { System } from '../src/engine/families/trick/systems/rules';

/** A hand from its PBN ("AKQ2.K32.Q32.432": spades, hearts, diamonds, clubs). */
const hand = (pbn: string) => handOf(pbn.split('.').flatMap((x, k) => [...x].map((r) => `${r}${'SHDC'[k]}`)));
/** Grade `call` by the player in seat `calls.length % 4`, after `calls` (from seat 0, the dealer). */
const grade = (pbn: string, calls: string[], call: string, system: System = 'sayc') =>
  gradeCall(
    system,
    calls.map((c, i) => ({ seat: i % 4, call: callOf(c) })),
    calls.length % 4,
    [false, false],
    hand(pbn),
    callOf(call),
  );

describe('grading a call against the system’s rules', () => {
  it('the book’s call is graded book, with what it means', () => {
    const g = grade('AQ2.KJ3.Q632.K32', [], '1N');
    expect(g.verdict).toBe('book');
    expect(g.says).toBe('15–17 points, balanced');
  });

  it('a call a rule gives, when an earlier rule gives another, is allowed, and the book’s call is named', () => {
    // four spades and four diamonds over 1♣: 1♠ shows four spades, but the book bids up the line
    const g = grade('Q865.JT.J653.A72', ['1C', 'P'], '1S');
    expect(g.verdict).toBe('allowed');
    expect(g.book).toBe('1D');
    expect(g.bookSays).toMatch(/four or more diamonds/);
  });

  it('a call whose rules don’t fit the hand breaks them, and says what’s missing', () => {
    // 1NT with 12 points
    const g = grade('AQ2.KJ3.Q632.932', [], '1N');
    expect(g.verdict).toBe('breaks');
    expect(g.reasons).toContain('15–17 points (you have 12)');
    // a weak two with five hearts
    const w = grade('32.KQJ93.Q632.32', [], '2H');
    expect(w.verdict).toBe('breaks');
    expect(w.reasons.join()).toMatch(/6 or more hearts \(you have 5\)/);
  });

  it('passing a hand the book opens is not allowed, though a pass "fits" anything', () => {
    const g = grade('AQ2.KJ3.Q632.K32', [], 'P');
    expect(g.verdict).toBe('breaks');
    expect(g.book).toBe('1N');
  });

  it('a call no rule gives where rules apply is uncovered, not called wrong', () => {
    // 4♣ straight over 1♥ isn't in our notes (a splinter, in some systems)
    const g = grade('K32.AQ32.KJ32.32', ['1H', 'P'], '4C');
    expect(g.verdict).toBe('uncovered');
    expect(g.book).toBe('2N');
  });

  it('a point no rule covers is judgment: the bots’ call is a suggestion', () => {
    // after 1♠ – 2♣ – 2♠ – 3♠ (SAYC), the opener's next call is the bots' judgment
    const g = grade('AKJ32.K32.Q32.32', ['1S', 'P', '2C', 'P', '2S', 'P', '3S', 'P'], '6S');
    expect(g.verdict).toBe('judgment');
    expect(g.book).not.toBe('6S');
  });
});
