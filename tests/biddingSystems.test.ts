import { describe, expect, it } from 'vitest';
import type { TrickData } from '../src/engine/families/trick';
import { callName, handInfo } from '../src/engine/families/trick/systems/auction';
import { explainLast, readAuction, systemCall } from '../src/engine/families/trick/systems/bidder';
import { handOf, mulberry, samplePartner, type Hand } from '../src/engine/families/trick/systems/hands';
import { bestContract, type Odds } from '../src/engine/families/trick/systems/place';
import type { System } from '../src/engine/families/trick/systems/rules';
import type { Call } from '../src/engine/families/trick/contracts';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['bridge'] as GameModule<TrickData>;
/** A hand from its PBN ("AKQ2.K32.Q32.432": spades, hearts, diamonds, clubs) as card ids. */
const cards = (pbn: string) => pbn.split('.').flatMap((x, k) => [...x].map((r) => `${r}${'SHDC'[k]}`));
const hand = (pbn: string): Hand => handOf(cards(pbn));
const NONE: [boolean, boolean] = [false, false];
/** The call a bot holding `pbn` makes after `calls` (names, from seat 0, the dealer). */
function bidFor(system: System, pbn: string, calls: string[]): string {
  const seat = calls.length % 4;
  const history = calls.map((c, i) => ({ seat: i % 4, call: toCall(c) }));
  return callName(systemCall(system, history, seat, NONE, hand(pbn)));
}
function toCall(c: string): Call {
  if (c === 'P' || c === 'X' || c === 'XX') return c;
  return (Number(c[0]) - 1) * 5 + 'CDHSN'.indexOf(c[1]);
}

describe('bidding systems: SAYC and two over one', () => {
  it('opens by the card: 1NT 15–17 balanced, a five-card major, 2♣ with 22+, a weak two, and passes 9 points', () => {
    expect(bidFor('sayc', 'AQ2.KJ3.Q632.K32', [])).toBe('1N');
    expect(bidFor('sayc', 'AQJ32.K3.Q632.K2', [])).toBe('1S');
    expect(bidFor('sayc', 'AKQ2.AK3.AQ6.KQ2', [])).toBe('2C');
    expect(bidFor('sayc', '32.KQJ932.Q63.32', [])).toBe('2H');
    expect(bidFor('sayc', 'Q32.K32.J632.Q32', [])).toBe('P');
    // no five-card major: the longer minor (1♦ with four of each)
    expect(bidFor('sayc', 'AJ32.K3.Q632.KJ2', [])).toBe('1D');
    expect(bidFor('sayc', 'AJ3.K32.Q63.KJ32', [])).toBe('1C');
  });

  it('over 1NT, transfers with five hearts, and Stayman with four spades and game values', () => {
    expect(bidFor('sayc', '32.QJ932.Q63.432', ['1N', 'P'])).toBe('2D');
    expect(bidFor('sayc', 'K632.Q32.KJ3.Q32', ['1N', 'P'])).toBe('2C');
    // the opener completes the transfer and answers Stayman
    expect(bidFor('sayc', 'AQ2.KJ3.Q632.K32', ['1N', 'P', '2D', 'P'])).toBe('2H');
    expect(bidFor('sayc', 'AQ32.KJ3.Q63.K32', ['1N', 'P', '2C', 'P'])).toBe('2S');
    // a fit found: game
    expect(bidFor('sayc', 'K632.Q32.KJ3.Q32', ['1N', 'P', '2C', 'P', '2S', 'P'])).toBe('4S');
  });

  it('raises a major: Jacoby 2NT with four trumps and an opening hand, a limit raise with 10–12', () => {
    expect(bidFor('sayc', 'K632.AQ3.KJ3.Q32', ['1S', 'P'])).toBe('2N');
    expect(bidFor('sayc', 'K632.Q3.KJ32.932', ['1S', 'P'])).toBe('3S');
    expect(bidFor('sayc', 'K632.Q3.J632.932', ['1S', 'P'])).toBe('2S');
  });

  it('a new suit at the two level is 10+ in SAYC but forces to game in two over one', () => {
    const elevenNoFit = '32.KQ3.Q632.AJ32';
    expect(bidFor('sayc', elevenNoFit, ['1S', 'P'])).toBe('2C');
    expect(bidFor('twoOverOne', elevenNoFit, ['1S', 'P'])).toBe('1N');
    expect(bidFor('twoOverOne', '32.KQ3.A632.AJ32', ['1S', 'P'])).toBe('2C');
  });

  it('answers Jacoby 2NT: a short suit first, then 15–17 with 3NT, a minimum with game', () => {
    const jacoby = ['1S', 'P', '2N', 'P'];
    expect(bidFor('sayc', 'AKJ32.4.KQ32.Q32', jacoby)).toBe('3H');
    expect(bidFor('sayc', 'AQ432.KQ2.Q32.K2', jacoby)).toBe('3N');
    expect(bidFor('sayc', 'AQ432.K32.Q32.K2', jacoby)).toBe('4S');
  });

  it('4NT straight after no trumps asks for the top of the range; 21 accepts over 2NT', () => {
    expect(bidFor('sayc', 'K32.Q32.KJ32.Q32', ['2N', 'P'])).toBe('4N');
    expect(bidFor('sayc', 'AK2.AQ2.KQ32.QJ2', ['2N', 'P', '4N', 'P'])).toBe('6N');
    expect(bidFor('sayc', 'AK2.AQ2.KQ32.J32', ['2N', 'P', '4N', 'P'])).toBe('P');
  });

  it('answers Blackwood with aces in SAYC, and key cards and the queen of trumps in two over one', () => {
    // one ace, and the king of the agreed spades: two key cards, without the queen
    const auction = ['1S', 'P', '2N', 'P', '3S', 'P', '4N', 'P'];
    expect(bidFor('sayc', 'AKJ32.K4.KQ3.Q32', auction)).toBe('5D');
    expect(bidFor('twoOverOne', 'AKJ32.K4.KQ3.Q32', auction)).toBe('5H');
    expect(bidFor('twoOverOne', 'AKQ32.K4.KJ3.Q32', auction)).toBe('5S');
  });

  it('two over one: one key card missing and the queen unknown, asks for her, and bids the slam when partner has her', () => {
    // hearts agreed; partner shows one key card (5♣), so one is missing
    const auction = ['1H', 'P', '2C', 'P', '3H', 'P', '4N', 'P', '5C', 'P'];
    const asker = '7.K874.A32.AKQJ2';
    expect(bidFor('twoOverOne', asker, auction)).toBe('5D');
    // the opener answers: with the queen, six; without, five
    expect(bidFor('twoOverOne', 'K2.AQ953.K64.954', [...auction, '5D', 'P'])).toBe('6H');
    expect(bidFor('twoOverOne', 'K2.AJ953.KQ4.954', [...auction, '5D', 'P'])).toBe('5H');
    expect(bidFor('twoOverOne', asker, [...auction, '5D', 'P', '6H', 'P'])).toBe('P');
    expect(bidFor('twoOverOne', asker, [...auction, '5D', 'P', '5H', 'P'])).toBe('P');
  });

  it('makes a help-suit game try, and partner accepts with help there', () => {
    expect(bidFor('sayc', 'AKJ32.K4.Q32.A32', ['1S', 'P', '2S', 'P'])).toBe('3C');
    expect(bidFor('sayc', 'Q654.J32.32.K654', ['1S', 'P', '2S', 'P', '3C', 'P'])).toBe('4S');
    expect(bidFor('sayc', 'Q654.K32.54.J432', ['1S', 'P', '2S', 'P', '3C', 'P'])).toBe('3S');
  });

  it('checks back for a fit with new minor forcing, and asks for a stopper with the fourth suit', () => {
    expect(bidFor('sayc', 'K2.AQ932.Q32.432', ['1D', 'P', '1H', 'P', '1N', 'P'])).toBe('2C');
    expect(bidFor('sayc', 'A32.K32.KQ32.Q32', ['1D', 'P', '1H', 'P', '1N', 'P', '2C', 'P'])).toBe('2H');
    // game values and no heart stopper: 2♥ asks for one rather than guess 3NT
    expect(bidFor('sayc', 'AQ32.432.KQ2.K32', ['1D', 'P', '1S', 'P', '2C', 'P'])).toBe('2H');
  });

  it('shows two-suiters over their opening (Michaels, the unusual 2NT), and balances lighter', () => {
    expect(bidFor('sayc', 'KQ932.2.32.AJ932', ['1H'])).toBe('2H');
    expect(bidFor('sayc', '2.32.KQ932.AJ932', ['1S'])).toBe('2N');
    // nine points, short in hearts: a pass in the direct seat, a double when it would be passed out
    expect(bidFor('sayc', 'K32.32.KJ32.Q432', ['1H'])).toBe('P');
    expect(bidFor('sayc', 'K32.32.KJ32.Q432', ['1H', 'P', 'P'])).toBe('X');
  });

  it('two over one: with a fit, game at once is a minimum (fast arrival), three of the major a slam try', () => {
    const auction = ['1S', 'P', '2C', 'P', '2S', 'P'];
    expect(bidFor('twoOverOne', 'Q32.K2.A32.KQ432', auction)).toBe('4S');
    expect(bidFor('twoOverOne', 'Q32.K2.AK2.KQ432', auction)).toBe('3S');
  });

  it('reads partner: after 1NT, the hands it imagines are balanced with 15–17', () => {
    const read = readAuction(
      'sayc',
      [
        { seat: 0, call: toCall('1N') },
        { seat: 1, call: 'P' },
      ],
      2,
      NONE,
    );
    const mine = hand('32.QJ932.Q63.432');
    const partners = samplePartner(mine, read.pic, 30, mulberry(1));
    expect(partners.length).toBeGreaterThan(20);
    for (const p of partners) {
      const info = handInfo(p);
      expect(info.balanced).toBe(true);
      expect(info.hcp).toBeGreaterThanOrEqual(15);
      expect(info.hcp).toBeLessThanOrEqual(17);
    }
  });

  it('judges a slam as at a teams match: a one-in-three slam loses to the game', () => {
    // every partner hand the same: spades make 10, 11 or 12 tricks (20%, 45%, 35%)
    const spades = Array.from({ length: 14 }, (_, t) => (t === 10 ? 0.2 : t === 11 ? 0.45 : t === 12 ? 0.35 : 0));
    const nothing = Array.from({ length: 14 }, (_, t) => (t === 6 ? 1 : 0));
    const odds: Odds = Array.from({ length: 10 }, () => [spades, nothing, nothing, nothing, nothing]);
    expect(callName(bestContract(odds, false, { above: -1 }).call as number)).toBe('4S');
  });

  it('explains a bot’s calls in the log, not a person’s, from the auction alone', () => {
    const s = g.setup([{ name: 'Ann' }, ...['B', 'C', 'D'].map((name) => ({ name, bot: true }))], 3, { system: 1 }) as GameState<TrickData>;
    s.dealer = 1;
    s.turn = 1;
    s.zones['hand:1'].cards = cards('AQ2.KJ3.Q632.K32').map((id) => ({ id }));
    g.apply(s, 1, g.bot!(s, 1)!);
    expect(s.log.at(-1)!.text).toMatch(/^B bids 1.NT \(15–17 points, balanced\)$/);
    g.apply(s, 2, { type: 'decline' });
    g.apply(s, 3, { type: 'decline' });
    g.apply(s, 0, { type: 'call', amount: toCall('2C') as number });
    expect(s.log.at(-1)!.text).toMatch(/^Ann bids 2.♣$/);
  });

  it('Natural keeps the plain bidder (no explanations)', () => {
    const s = g.setup(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
      3,
      { system: 0 },
    ) as GameState<TrickData>;
    s.turn = s.dealer;
    s.zones[`hand:${s.dealer}`].cards = cards('AQ2.KJ3.Q632.K32').map((id) => ({ id }));
    g.apply(s, s.dealer, g.bot!(s, s.dealer)!);
    expect(s.log.at(-1)!.text).not.toContain('(');
  });

  for (const [system, n] of [
    [1, 'SAYC'],
    [2, 'two over one'],
  ] as const)
    it(`${n}: every auction ends in a legal contract (or all pass), with every bot call explained or a plain pass`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const s = g.setup(
          ['A', 'B', 'C', 'D'].map((name) => ({ name, bot: true })),
          seed,
          { system },
        ) as GameState<TrickData>;
        const start = s.log.length;
        let calls = 0;
        while (s.phase === 'call' && calls < 60) {
          g.apply(s, s.turn!, g.bot!(s, s.turn!)!);
          calls++;
        }
        expect(calls).toBeLessThan(60);
        for (const e of s.log.slice(start)) if (/ bids /.test(e.text)) expect(e.text).toMatch(/\(.+\)$/);
      }
    });
});

/** What the last of `calls` (names, from seat 0, the dealer) means in the system. */
const meaningOf = (system: System, calls: string[]) =>
  explainLast(
    system,
    calls.map((c, i) => ({ seat: i % 4, call: toCall(c) })),
    NONE,
  );

describe('bidding systems: by the book (the calls EPBot and the SAYC booklet make)', () => {
  it('opens a weak two only with six cards of a decent suit, no four-card major on the side, and too little to open one', () => {
    expect(bidFor('sayc', 'Q2.KQJ932.963.32', [])).toBe('2H');
    // eleven points and six cards make twenty with the next suit: one of a suit
    expect(bidFor('sayc', 'Q2.KQJ932.K63.32', [])).toBe('1H');
    // five hearts, a poor suit, a side major: not a weak two
    expect(bidFor('sayc', '5.AQJ42.T4.87532', [])).toBe('P');
    expect(bidFor('sayc', '32.T98764.KQ3.32', [])).toBe('P');
    expect(bidFor('sayc', 'J543.8.KQT653.63', [])).toBe('P');
  });

  it('answers a weak two: 2NT asks for a feature (SAYC) or the strength and suit (Ogust, two over one)', () => {
    const asked = ['2S', 'P', '2N', 'P'];
    expect(bidFor('sayc', 'KQJ932.A32.32.32', asked)).toBe('3H');
    expect(bidFor('sayc', 'KQT932.32.432.32', asked)).toBe('3S');
    expect(bidFor('twoOverOne', 'KQJ932.A32.32.32', asked)).toBe('3S');
    expect(bidFor('twoOverOne', 'KQT932.32.432.32', asked)).toBe('3D');
    // a fit and game values: game; four trumps and nothing more: three, to keep them out; three, pass
    expect(bidFor('sayc', 'A32.AK32.KQ32.32', ['2S', 'P'])).toBe('4S');
    expect(bidFor('sayc', 'A432.J32.5432.32', ['2S', 'P'])).toBe('3S');
    expect(bidFor('sayc', 'A32.J32.5432.432', ['2S', 'P'])).toBe('P');
  });

  it('over 1♣, bids four-card suits up the line: 1♦ with four diamonds and four spades', () => {
    expect(bidFor('sayc', 'Q865.JT.J653.A72', ['1C', 'P'])).toBe('1D');
    expect(bidFor('sayc', 'Q8652.J.J653.A72', ['1C', 'P'])).toBe('1S');
    // and the opener shows a four-card major before raising diamonds
    expect(bidFor('sayc', '.KJ32.KQ32.AQ543', ['1C', 'P', '1D', 'P'])).toBe('1H');
  });

  it('makes a limit raise with three trumps only when light: with 11 high-card points, a new suit first', () => {
    expect(bidFor('sayc', 'AQ3.QT3.87.KT532', ['1S', 'P'])).toBe('2C');
    expect(bidFor('sayc', 'QT3.AT4.84.K8753', ['1S', 'P'])).toBe('3S');
  });

  it('over their overcall, a four-card major goes into a negative double before 1NT', () => {
    expect(bidFor('sayc', 'Q84.K874.Q76.K54', ['1C', '1S'])).toBe('X');
  });

  it('rebids 1NT with a minimum and a five-card minor, rather than the minor again', () => {
    expect(bidFor('sayc', 'A.973.KQT5.Q9763', ['1C', 'P', '1S', 'P'])).toBe('1N');
  });

  it('over 1NT, Texas: 4♦ with six hearts and game values, and the opener completes it', () => {
    expect(bidFor('sayc', 'A7.AJT852.Q54.93', ['1N', 'P'])).toBe('4D');
    expect(bidFor('sayc', 'AQ2.KJ3.Q632.K32', ['1N', 'P', '4D', 'P'])).toBe('4H');
  });

  it('after Jacoby 2NT, a minimum with a short suit shows it rather than jump to game', () => {
    expect(bidFor('sayc', 'AQJ32.K3.Q632.2', ['1S', 'P', '2N', 'P'])).toBe('3C');
  });

  it('with 17+ and four spades over 1♥ – 1NT, reverses rather than bid a three-card minor', () => {
    expect(bidFor('sayc', 'AKJ2.AQJ32.K32.2', ['1H', 'P', '1N', 'P'])).toBe('2S');
  });

  it('never passes a reverse: it forces for a round', () => {
    expect(bidFor('sayc', 'KJ32.32.Q2.85432', ['1D', 'P', '1S', 'P', '2H', 'P'])).not.toBe('P');
  });

  it('answers the fourth suit with support for responder’s major first; it forces a round in SAYC, to game in two over one', () => {
    expect(bidFor('sayc', 'AQ32.K32.KJ32.A2', ['1D', 'P', '1H', 'P', '1S', 'P', '2C', 'P'])).toBe('2H');
    expect(meaningOf('sayc', ['1D', 'P', '1H', 'P', '1S', 'P', '2C'])).toMatch(/\(forcing\)$/);
    expect(meaningOf('twoOverOne', ['1D', 'P', '1H', 'P', '1S', 'P', '2C'])).toMatch(/game forcing/);
  });

  it('4NT after 1NT and Stayman with no fit asks for the top of the range, not for aces', () => {
    expect(meaningOf('sayc', ['1N', 'P', '2C', 'P', '2H', 'P', '4N'])).toMatch(/top of their range/);
    // with a suit agreed it's Blackwood
    expect(meaningOf('sayc', ['1N', 'P', '2D', 'P', '2H', 'P', '3H', 'P', '4N'])).toMatch(/Blackwood/);
  });

  it('over their overcall: a cue bid is the limit raise, the jump raise is weak, and a double of 1NT is not negative', () => {
    expect(bidFor('sayc', 'K632.Q3.KJ32.932', ['1S', '2C'])).toBe('3C');
    expect(bidFor('sayc', 'K6532.3.J8732.93', ['1S', '2C'])).toBe('3S');
    expect(bidFor('sayc', 'KJ32.32.Q432.J32', ['1H', '1N'])).not.toBe('X');
  });

  it('after 1♣ – pass – 1♥, the unusual 2NT is not for the opener’s clubs', () => {
    expect(bidFor('sayc', 'K2.32.KQJ32.QJ432', ['1C', 'P', '1H'])).not.toBe('2N');
  });

  it('overcalls: a weak jump with a decent six-card suit; at the two level only a good suit (over 1NT, six cards)', () => {
    expect(bidFor('sayc', 'KQT975.32.J32.32', ['1C'])).toBe('2S');
    expect(bidFor('sayc', 'A2.32.K8632.KJ32', ['1S'])).toBe('P');
    expect(bidFor('sayc', 'K2.AJ932.Q32.Q32', ['1N'])).toBe('P');
  });

  it('when their overcall comes back round, the opener short in their suit reopens with a double', () => {
    expect(bidFor('sayc', 'AKJ32.4.KQ32.Q32', ['1S', '2H', 'P', 'P'])).toBe('X');
    // and with 16+, redoubles their double in the passout seat
    expect(bidFor('sayc', 'AQ2.K3.KQJ632.K2', ['1D', 'P', 'P', 'X'])).toBe('XX');
  });

  it('two over one: a passed hand’s two-level suit is natural and not forcing', () => {
    expect(bidFor('twoOverOne', '32.KQ3.32.AJ8632', ['P', 'P', '1S', 'P'])).toBe('2C');
    expect(bidFor('twoOverOne', '32.KQ3.32.AJ8632', ['1S', 'P'])).toBe('1N');
  });
});
