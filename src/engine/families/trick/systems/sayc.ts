import { dummyPoints, lengthPoints, levelOf, stopped, SUIT_AT, SUIT_NAME, SYMBOL, type Ctx, type HandInfo } from './auction';
import { r, type Rule } from './rules';

/**
 * Standard American Yellow Card (the ACBL's), and two over one game force, which differs in a
 * few places (marked `only`): a two-level new suit over 1♥/1♠ (or over 1♦, 2♣) promises game
 * values, so it forces to game; and 1NT over a major is forcing for a round and holds up to 12.
 *
 * Rules are tried in order: the first that fits the hand is the bid. Where none fits, the bot
 * places the contract from what partner has shown (see bidder.ts).
 */

const M = ['H', 'S'] as const;
const word = (x: string) => SUIT_NAME[x];
const sym = (x: string) => SYMBOL[x];
/** Opening points: 12+, or 10–11 with the two longest suits making twenty (the Rule of 20). */
const opens = (h: HandInfo) => h.hcp >= 12 || (h.hcp >= 10 && h.hcp + h.len.slice().sort((a, b) => b - a)[0] + h.len.slice().sort((a, b) => b - a)[1] >= 20);
const fourMajor = (h: HandInfo) => h.L.S === 4 || h.L.H === 4;
/** The side suit (not trumps) a game try asks for help in: three cards or more, two losers or more (the most; lower suits first). */
function helpWanted(h: HandInfo, trump: string): string | null {
  const losers = (x: string) => Math.min(3, h.L[x]) - h.hand[SUIT_AT[x]].slice(0, 3).filter((v) => v >= 12).length;
  return ['C', 'D', 'H', 'S'].filter((x) => x !== trump && h.L[x] >= 3 && losers(x) >= 2).sort((a, b) => losers(b) - losers(a))[0] ?? null;
}
/** Two of the top three honours. */
const goodSuit = (h: HandInfo, x: string) => h.hand[SUIT_AT[x]].filter((v) => v >= 12).length >= 2;

// ---- openings ---------------------------------------------------------------------------

const openings: Rule[] = [
  r('', '2C', { hcp: [22, 37] }, '22+ points (strong, artificial, forcing)', { forcing: 'round' }),
  r('', '2N', { hcp: [20, 21], balanced: true }, '20–21 points, balanced'),
  r('', '1N', { hcp: [15, 17], balanced: true }, '15–17 points, balanced'),
  // pre-empts: a long suit and not much else
  ...M.map((x) => r('', `4${x}`, { hcp: [5, 10], [x]: [8, 13] }, `pre-empt: eight or more ${word(x)}`)),
  ...(['S', 'H', 'D', 'C'] as const).map((x) => r('', `3${x}`, { hcp: [5, 10], [x]: [7, 13] }, `pre-empt: seven or more ${word(x)}, 5–10 points`)),
  ...(['S', 'H', 'D'] as const).map((x) =>
    r('', `2${x}`, { hcp: [5, 10], [x]: [6, 6] }, `weak two: six ${word(x)}, 5–10 points`, {
      also: (h) => (x === 'S' ? h.L.H < 4 : x === 'H' ? h.L.S < 4 : true),
    }),
  ),
  // one of a suit: a five-card major (spades with five of each), else the longer minor
  r('', '1S', { hcp: [10, 21], S: [5, 13] }, '12–21 points, five or more spades', { also: (h) => opens(h) && h.L.S >= h.L.H }),
  r('', '1H', { hcp: [10, 21], H: [5, 13] }, '12–21 points, five or more hearts', { also: (h) => opens(h) && h.L.H > h.L.S }),
  r('', '1D', { hcp: [10, 21], D: [3, 13], S: [0, 4], H: [0, 4] }, '12–21 points, usually four or more diamonds', {
    also: (h) => opens(h) && (h.L.D > h.L.C || (h.L.D === h.L.C && h.L.D >= 4)),
  }),
  r('', '1C', { hcp: [10, 21], C: [3, 13], S: [0, 4], H: [0, 4] }, '12–21 points, three or more clubs', {
    also: (h) => opens(h) && (h.L.C > h.L.D || (h.L.C === h.L.D && h.L.C <= 3)),
  }),
  r('', 'P', { hcp: [0, 21] }, ''),
];

// ---- responses to one of a major ---------------------------------------------------------

function majorResponses(x: 'H' | 'S'): Rule[] {
  const o = `1${x}`;
  const dp = (h: HandInfo) => dummyPoints(h, x);
  return [
    r(o, '2N', { hcp: [11, 37], [x]: [4, 13] }, `Jacoby 2NT: four or more ${word(x)}, game forcing`, { forcing: 'game', also: (h) => dp(h) >= 13 }),
    r(o, `4${x}`, { hcp: [0, 9], [x]: [5, 13] }, `five or more ${word(x)}, weak (to play)`, { also: (h) => dp(h) <= 10 }),
    r(o, `3${x}`, { hcp: [8, 12], [x]: [3, 13] }, `limit raise: three or more ${word(x)}, 10–12 points`, { also: (h) => dp(h) >= 10 && dp(h) <= 12 }),
    r(o, `2${x}`, { hcp: [4, 10], [x]: [3, 13] }, `raise: three or more ${word(x)}, 6–10 points`, { also: (h) => dp(h) >= 6 && dp(h) <= 10 }),
    ...(x === 'H' ? [r(o, '1S', { hcp: [6, 37], S: [4, 13] }, 'four or more spades, 6+ points (forcing)', { forcing: 'round' })] : []),
    r(o, '3N', { hcp: [15, 17], balanced: true, [x]: [0, 2] }, '15–17 points, balanced', { also: (h) => h.L.S < 4 || x === 'S' }),
    // two over one: SAYC 10+ (forcing a round); two-over-one, 13+ and forcing to game
    ...twoOverOne(o, x === 'S' ? ['H', 'D', 'C'] : ['D', 'C']),
    r(o, '1N', { hcp: [6, 10] }, '6–10 points (not forcing)', { only: 'sayc' }),
    r(o, '1N', { hcp: [6, 12] }, '6–12 points (forcing for a round)', { only: 'twoOverOne', forcing: 'round' }),
    r(o, 'P', { hcp: [0, 5] }, ''),
  ];
}

/** A new suit at the two level: 10+ in SAYC (5+ for hearts, 4+ for a minor), 13+ and game forcing in two over one. */
function twoOverOne(o: string, suits: string[]): Rule[] {
  // (the longest; between equals, the cheaper)
  const longest = (h: HandInfo) => suits.reduce((b, x) => (h.L[x] > h.L[b] || (h.L[x] === h.L[b] && 'CDHS'.indexOf(x) < 'CDHS'.indexOf(b)) ? x : b));
  return suits.flatMap((x) => {
    const min = x === 'H' ? 5 : 4;
    return [
      r(o, `2${x}`, { hcp: [10, 37], [x]: [min, 13] }, `${min} or more ${word(x)}, 10+ points (forcing)`, {
        only: 'sayc',
        forcing: 'round',
        also: (h) => longest(h) === x,
      }),
      r(o, `2${x}`, { hcp: [13, 37], [x]: [min, 13] }, `${min} or more ${word(x)}, game forcing`, {
        only: 'twoOverOne',
        forcing: 'game',
        also: (h) => longest(h) === x,
      }),
    ];
  });
}

// ---- responses to one of a minor -------------------------------------------------------------

function minorResponses(m: 'C' | 'D'): Rule[] {
  const o = `1${m}`;
  return [
    ...(m === 'C'
      ? [
          r(o, '1D', { hcp: [11, 37], D: [5, 13] }, 'four or more diamonds, 6+ points (forcing)', {
            forcing: 'round',
            also: (h) => h.L.D > h.L.S && h.L.D > h.L.H,
          }),
        ]
      : []),
    r(o, '1H', { hcp: [6, 37], H: [4, 13] }, 'four or more hearts, 6+ points (forcing)', {
      forcing: 'round',
      also: (h) => h.L.H > h.L.S || (h.L.H === 4 && h.L.S === 4),
    }),
    r(o, '1S', { hcp: [6, 37], S: [4, 13] }, 'four or more spades, 6+ points (forcing)', { forcing: 'round' }),
    ...(m === 'C' ? [r(o, '1D', { hcp: [6, 37], D: [4, 13], S: [0, 3], H: [0, 3] }, 'four or more diamonds, 6+ points (forcing)', { forcing: 'round' })] : []),
    r(o, '3N', { hcp: [16, 17], balanced: true, S: [0, 3], H: [0, 3] }, '16–17 points, balanced, no four-card major'),
    r(o, '2N', { hcp: [13, 15], balanced: true, S: [0, 3], H: [0, 3] }, '13–15 points, balanced, no four-card major (game forcing)', { forcing: 'game' }),
    r(
      o,
      `3${m}`,
      { hcp: [10, 12], [m]: [m === 'C' ? 5 : 4, 13], S: [0, 3], H: [0, 3] },
      `limit raise: ${m === 'C' ? 'five' : 'four'} or more ${word(m)}, 10–12 points`,
    ),
    ...(m === 'D' ? twoOverOne(o, ['C']) : []),
    r(
      o,
      `2${m}`,
      { hcp: [6, 10], [m]: [m === 'C' ? 5 : 4, 13], S: [0, 3], H: [0, 3] },
      `raise: ${m === 'C' ? 'five' : 'four'} or more ${word(m)}, 6–10 points`,
    ),
    r(o, '1N', { hcp: [6, 10], S: [0, 3], H: [0, 3] }, '6–10 points, no four-card major'),
    r(o, 'P', { hcp: [0, 5] }, ''),
  ];
}

// ---- 1NT and 2NT: Stayman and transfers --------------------------------------------------

function notrump(o: '1N' | '2N'): Rule[] {
  const two = o === '1N';
  const lv = two ? 2 : 3;
  // (over 2NT everything is a level higher, and game needs less)
  const inv: [number, number] = two ? [8, 9] : [0, 0];
  const game: [number, number] = two ? [10, 15] : [4, 10];
  const weak: [number, number] = two ? [0, 7] : [0, 3];
  const T = (a: string) => `${o} ${a}`;
  const bidAt = (l: number, x: string) => `${l}${x}`;
  const rules: Rule[] = [
    // transfers: five or more hearts (2♦ / 3♦) or spades (2♥ / 3♥), any strength
    r(o, bidAt(lv, 'D'), { H: [5, 13] }, 'transfer: five or more hearts', { forcing: 'round', also: (h) => h.L.H >= h.L.S }),
    r(o, bidAt(lv, 'H'), { S: [5, 13] }, 'transfer: five or more spades', { forcing: 'round' }),
    r(o, bidAt(lv, 'C'), { hcp: [two ? 8 : 4, 37] }, 'Stayman: asks for a four-card major', { forcing: 'round', also: fourMajor }),
    ...(two
      ? [
          r(o, '2S', { hcp: [0, 7] }, 'asks for 3♣: a weak hand with a long minor', { forcing: 'round', also: (h) => h.L.C >= 6 || h.L.D >= 6 }),
          r(o, '6N', { hcp: [18, 19], S: [0, 3], H: [0, 3] }, '18–19 points: slam'),
          r(o, '4N', { hcp: [16, 17], S: [0, 3], H: [0, 3] }, '16–17 points: slam if you have the top of your range'),
        ]
      : []),
    ...(two
      ? []
      : [
          r(o, '6N', { hcp: [13, 15], S: [0, 3], H: [0, 3] }, '13–15 points: slam'),
          r(o, '4N', { hcp: [11, 12], S: [0, 3], H: [0, 3] }, '11–12 points: slam if you have the top of your range'),
        ]),
    r(o, '3N', { hcp: game, S: [0, 4], H: [0, 4] }, 'to play'),
    // (answering 4NT: slam at the top of the range, or with a five-card suit to make up a point)
    r(T('4N'), '6N', { hcp: two ? [17, 17] : [21, 21] }, 'the top of the range: slam'),
    r(T('4N'), '6N', { hcp: two ? [16, 16] : [20, 20] }, 'a five-card suit: slam', { also: (h) => h.len.some((n) => n >= 5) }),
    r(T('4N'), 'P', {}, 'the bottom of the range'),
    ...(two ? [r(o, '2N', { hcp: inv, S: [0, 3], H: [0, 3] }, 'invites 3NT')] : []),
    r(o, 'P', { hcp: weak }, ''),
    // answering Stayman
    r(T(bidAt(lv, 'C')), bidAt(lv, 'H'), { H: [4, 5] }, 'four hearts (perhaps four spades too)'),
    r(T(bidAt(lv, 'C')), bidAt(lv, 'S'), { S: [4, 5], H: [0, 3] }, 'four spades, not four hearts'),
    r(T(bidAt(lv, 'C')), bidAt(lv, 'D'), { S: [0, 3], H: [0, 3] }, 'no four-card major'),
    // completing a transfer
    r(T(bidAt(lv, 'D')), bidAt(lv, 'H'), {}, 'completes the transfer'),
    r(T(bidAt(lv, 'H')), bidAt(lv, 'S'), {}, 'completes the transfer'),
    ...(two
      ? [
          r(T('2S'), '3C', {}, 'as asked'),
          r(T('2S 3C'), 'P', { C: [6, 13] }, 'to play'),
          r(T('2S 3C'), '3D', { D: [6, 13] }, 'to play'),
          r(T('2S 3C 3D'), 'P', {}, ''),
        ]
      : []),
  ];
  // after Stayman's answer
  const after = T(bidAt(lv, 'C'));
  for (const ans of ['D', 'H', 'S']) {
    const at = `${after} ${bidAt(lv, ans)}`;
    if (ans !== 'D')
      rules.push(
        r(at, `4${ans}`, { hcp: game, [ans]: [4, 13] }, `four ${word(ans)}: game`),
        ...(two ? [r(at, `3${ans}`, { hcp: inv, [ans]: [4, 13] }, `four ${word(ans)}, invites game`)] : []),
      );
    // no fit: notrumps (having shown the other major)
    rules.push(r(at, '3N', { hcp: game }, 'to play (no fit in the major)'));
    if (two) rules.push(r(at, '2N', { hcp: inv }, 'invites 3NT'));
    // opener: accept or not; with the other major, play it
    if (two) {
      rules.push(
        r(`${at} 2N`, ans === 'H' ? '4S' : '3N', { hcp: [16, 17] }, ans === 'H' ? 'four spades too, top of the range' : 'top of the range', {
          also: (h) => ans !== 'H' || h.L.S >= 4,
        }),
        ...(ans === 'H'
          ? [
              r(`${at} 2N`, '3S', { hcp: [15, 15], S: [4, 4] }, 'four spades too, bottom of the range'),
              r(`${at} 2N`, '3N', { hcp: [16, 17] }, 'top of the range'),
            ]
          : []),
        r(`${at} 2N`, 'P', {}, ''),
      );
      if (ans !== 'D') rules.push(r(`${at} 3${ans}`, `4${ans}`, { hcp: [16, 17] }, 'top of the range'), r(`${at} 3${ans}`, 'P', {}, ''));
    }
    if (ans === 'H') rules.push(r(`${at} 3N`, '4S', { S: [4, 5] }, 'four spades too: the fit you have'));
    rules.push(r(`${at} 3N`, 'P', {}, ''));
  }
  // after a transfer
  for (const x of ['H', 'S'] as const) {
    const at = T(`${bidAt(lv, x === 'H' ? 'D' : 'H')} ${bidAt(lv, x)}`);
    rules.push(
      r(at, `4${x}`, { hcp: game, [x]: [6, 13] }, `six or more ${word(x)}: game`),
      r(at, '3N', { hcp: game, [x]: [5, 5] }, `five ${word(x)}, game: 3NT or 4${sym(x)}`),
      ...(two
        ? [
            r(at, `3${x}`, { hcp: inv, [x]: [6, 13] }, `six or more ${word(x)}, invites game`),
            r(at, '2N', { hcp: inv, [x]: [5, 5] }, `five ${word(x)}, invites game`),
            r(`${at} 2N`, `4${x}`, { hcp: [16, 17], [x]: [3, 5] }, `three or more ${word(x)}, top of the range`),
            r(`${at} 2N`, '3N', { hcp: [16, 17] }, 'top of the range, two cards in the suit'),
            r(`${at} 2N`, `3${x}`, { [x]: [3, 5] }, 'bottom of the range, three or more in the suit'),
            r(`${at} 2N`, 'P', {}, ''),
            r(`${at} 3${x}`, `4${x}`, { hcp: [16, 17] }, 'top of the range'),
            r(`${at} 3${x}`, 'P', {}, ''),
          ]
        : []),
      r(`${at} 3N`, `4${x}`, { [x]: [3, 5] }, `three or more ${word(x)}: the fit`),
      r(`${at} 3N`, 'P', {}, ''),
      r(at, 'P', { hcp: weak }, 'to play'),
    );
  }
  return rules;
}

// ---- 2♣ (strong) -------------------------------------------------------------------------

const strongClub: Rule[] = [
  ...(['S', 'H'] as const).map((x) =>
    r('2C', `2${x}`, { hcp: [8, 37], [x]: [5, 13] }, `five or more ${word(x)}, 8+ points (game forcing)`, { forcing: 'game' }),
  ),
  ...(['C', 'D'] as const).map((x) =>
    r('2C', `3${x}`, { hcp: [8, 37], [x]: [5, 13] }, `five or more ${word(x)}, 8+ points (game forcing)`, { forcing: 'game' }),
  ),
  r('2C', '2N', { hcp: [8, 37], balanced: true }, '8+ points, balanced (game forcing)', { forcing: 'game' }),
  r('2C', '2D', {}, 'waiting: anything without a good five-card suit', { forcing: 'round' }),
  r('2C 2D', '2N', { hcp: [22, 24], balanced: true }, '22–24 points, balanced'),
  r('2C 2D', '3N', { hcp: [25, 27], balanced: true }, '25–27 points, balanced'),
  ...(['S', 'H'] as const).map((x) => r('2C 2D', `2${x}`, { [x]: [5, 13] }, `five or more ${word(x)} (game forcing)`, { forcing: 'game' })),
  ...(['C', 'D'] as const).map((x) => r('2C 2D', `3${x}`, { [x]: [5, 13] }, `five or more ${word(x)} (game forcing)`, { forcing: 'game' })),
];

// ---- opener's rebid ----------------------------------------------------------------------

/** After 1x – 1y (a new suit at the one level, forcing). */
function rebidOverOne(open: string, resp: string): Rule[] {
  const at = `1${open} 1${resp}`;
  const rank = 'CDHS';
  const above = (a: string, b: string) => rank.indexOf(a) > rank.indexOf(b);
  const rules: Rule[] = [];
  const dp = (h: HandInfo) => dummyPoints(h, resp);
  const respMajor = resp === 'H' || resp === 'S';
  // raise partner's major (or diamonds) with four
  if (resp !== 'N') {
    rules.push(
      r(at, `4${resp}`, { hcp: [16, 21], [resp]: [4, 13] }, `four ${word(resp)}, 19–21 points`, { also: (h) => respMajor && dp(h) >= 19 }),
      r(at, `3${resp}`, { hcp: [14, 18], [resp]: [4, 13] }, `four ${word(resp)}, 16–18 points (invites game)`, { also: (h) => dp(h) >= 16 && dp(h) <= 18 }),
      r(at, `2${resp}`, { hcp: [10, 15], [resp]: [4, 13] }, `four ${word(resp)}, 12–15 points`, { also: (h) => dp(h) <= 15 }),
    );
  }
  // a four-card major at the one level, up the line
  for (const x of ['H', 'S'])
    if (above(x, resp) && x !== open)
      rules.push(r(at, `1${x}`, { hcp: [10, 18], [x]: [4, 4] }, `four ${word(x)}, 12–18 points`, { also: (h) => x === 'S' || h.L.S < 4 || h.L.H >= 4 }));
  rules.push(
    r(at, '1N', { hcp: [12, 14], balanced: true }, '12–14 points, balanced'),
    r(at, '2N', { hcp: [18, 19], balanced: true }, '18–19 points, balanced'),
    r(at, `3${open}`, { hcp: [15, 18], [open]: [6, 13] }, `six or more ${word(open)}, 16–18 points (invites game)`, { also: (h) => lengthPoints(h) >= 16 }),
  );
  // a second suit: lower than the first at the two level (12–18), or a reverse (17+)
  for (const x of ['C', 'D', 'H', 'S']) {
    if (x === open || x === resp) continue;
    const level = above(x, resp) ? 1 : 2;
    if (level === 1) continue; // (one-level new suits: above)
    if (above(x, open))
      rules.push(
        r(at, `2${x}`, { hcp: [17, 21], [x]: [4, 13] }, `reverse: four or more ${word(x)}, longer ${word(open)}, 17+ points (forcing)`, {
          forcing: 'round',
          also: (h) => h.L[open] > h.L[x],
        }),
      );
    else rules.push(r(at, `2${x}`, { hcp: [10, 18], [x]: [4, 13] }, `four or more ${word(x)}, 12–18 points`));
  }
  rules.push(
    r(at, `2${open}`, { hcp: [10, 15], [open]: [6, 13] }, `six or more ${word(open)}, 12–15 points`),
    // (a minimum with nothing better: the suit again)
    r(at, `2${open}`, { hcp: [10, 15], [open]: [5, 13] }, `five or more ${word(open)}, a minimum`),
  );
  return rules;
}

/** After 1M – 1NT. */
function rebidOverNT(open: 'H' | 'S'): Rule[] {
  const at = `1${open} 1N`;
  const rules: Rule[] = [
    r(at, `4${open}`, { hcp: [17, 21], [open]: [6, 13] }, `six or more ${word(open)}, enough for game`, { also: (h) => lengthPoints(h) >= 20 }),
    r(at, `3${open}`, { hcp: [15, 18], [open]: [6, 13] }, `six or more ${word(open)}, 16–18 points (invites game)`),
    r(at, '2N', { hcp: [18, 19], balanced: true }, '18–19 points, balanced (invites 3NT)'),
    r(at, 'P', { hcp: [12, 14], balanced: true }, 'a balanced minimum', { only: 'sayc' }),
    r(at, `2${open}`, { hcp: [10, 15], [open]: [6, 13] }, `six or more ${word(open)}, 12–15 points`),
  ];
  // (a second major first, then the longer minor)
  if (open === 'S') rules.push(r(at, '2H', { hcp: [10, 18], H: [4, 13] }, 'four or more hearts'));
  rules.push(
    r(at, '2D', { hcp: [10, 18], D: [3, 13] }, 'three or more diamonds', { also: (h) => h.L.D > h.L.C || (h.L.D === h.L.C && h.L.D >= 4) }),
    r(at, '2C', { hcp: [10, 18], C: [3, 13] }, 'three or more clubs'),
  );
  if (open === 'H') rules.push(r(at, '2S', { hcp: [17, 21], S: [4, 4] }, 'reverse: four spades, 17+ points'));
  rules.push(r(at, `2${open}`, { hcp: [10, 21] }, `five ${word(open)}, nothing else to show`));
  return rules;
}

/** After a raise of a major, and the answers to a game try. */
function afterRaise(x: 'H' | 'S'): Rule[] {
  const lp = (h: HandInfo) => lengthPoints(h);
  return [
    r(`1${x} 2${x}`, `4${x}`, { hcp: [16, 21] }, `enough for game`, { also: (h) => lp(h) >= 19 }),
    // a help-suit game try: 16–18 and a side suit with two losers or more; partner bids game with
    // help there (a top honour, or two cards or fewer) or the top of the raise
    ...(['S', 'H', 'D', 'C'] as const)
      .filter((y) => y !== x)
      .flatMap((y) => {
        const at = `1${x} 2${x}`;
        const call = `${'CDHS'.indexOf(y) > 'CDHS'.indexOf(x) ? 2 : 3}${y}`;
        return [
          r(at, call, { hcp: [14, 18], [y]: [3, 13] }, `a game try: help wanted in ${word(y)} (16–18 points)`, {
            forcing: 'round',
            also: (h) => lp(h) >= 16 && lp(h) <= 18 && helpWanted(h, x) === y,
          }),
          r(`${at} ${call}`, `4${x}`, {}, `accepts: help in ${word(y)}, or the top of the raise`, {
            also: (h) => dummyPoints(h, x) >= 9 || (dummyPoints(h, x) >= 7 && (h.L[y] <= 2 || h.hand[SUIT_AT[y]][0] >= 13)),
          }),
          r(`${at} ${call}`, `3${x}`, {}, 'declines the game try'),
          r(`${at} ${call} 3${x}`, 'P', {}, ''),
        ];
      }),
    r(`1${x} 2${x}`, `3${x}`, { hcp: [14, 18] }, `16–18 points: game if you're at the top of your raise`, { also: (h) => lp(h) >= 16 }),
    r(`1${x} 2${x}`, 'P', {}, ''),
    r(`1${x} 2${x} 3${x}`, `4${x}`, { hcp: [8, 10] }, 'top of the raise'),
    r(`1${x} 2${x} 3${x}`, 'P', {}, ''),
    r(`1${x} 3${x}`, `4${x}`, { hcp: [13, 21] }, 'accepts the invitation', { also: (h) => lp(h) >= 14 }),
    r(`1${x} 3${x}`, 'P', {}, ''),
    r(`1${x} 4${x}`, 'P', {}, ''),
    // Jacoby 2NT: a minimum goes straight to game; with more, opener shows a short suit first,
    // then a good second suit, then strength
    r(`1${x} 2N`, `4${x}`, { hcp: [10, 14] }, 'a minimum: no interest in slam'),
    ...(['S', 'H', 'D', 'C'] as const)
      .filter((y) => y !== x)
      .map((y) => r(`1${x} 2N`, `3${y}`, { hcp: [15, 21], [y]: [0, 1] }, `a singleton or void in ${word(y)}, 15+ points`, { forcing: 'game' })),
    ...(['S', 'H', 'D', 'C'] as const)
      .filter((y) => y !== x)
      .map((y) =>
        r(`1${x} 2N`, `4${y}`, { hcp: [15, 21], [y]: [5, 13] }, `a second suit: five or more good ${word(y)}, 15+ points`, {
          also: (h) => goodSuit(h, y),
        }),
      ),
    r(`1${x} 2N`, `3${x}`, { hcp: [18, 21] }, '18+ points, no short suit: interest in slam', { forcing: 'game' }),
    r(`1${x} 2N`, '3N', { hcp: [15, 17] }, '15–17 points, no short suit', { forcing: 'game' }),
  ];
}

/** After a minor raise, and 1m – 1NT. */
function afterMinor(m: 'C' | 'D'): Rule[] {
  return [
    r(`1${m} 2${m}`, '3N', { hcp: [18, 19], balanced: true }, '18–19 points, balanced'),
    r(`1${m} 2${m}`, 'P', { hcp: [10, 17] }, ''),
    r(`1${m} 3${m}`, '3N', { hcp: [14, 21] }, 'to play', {
      also: (h) => ['S', 'H', 'D', 'C'].filter((x) => x !== m).every((x) => stopped(h, x) || h.L[x] >= 4),
    }),
    r(`1${m} 3${m}`, `5${m}`, { hcp: [15, 21] }, 'to play'),
    r(`1${m} 3${m}`, 'P', {}, ''),
    r(`1${m} 1N`, '3N', { hcp: [18, 21], balanced: true }, 'to play'),
    r(`1${m} 1N`, '2N', { hcp: [16, 17], balanced: true }, 'invites 3NT'),
    r(`1${m} 1N`, 'P', { hcp: [10, 15], balanced: true }, ''),
    r(`1${m} 2N`, '3N', { hcp: [10, 15] }, 'to play'),
  ];
}

/** Responder's second call after opener's 1NT rebid (12–14 balanced). */
function afterRebidNT(): Rule[] {
  const out: Rule[] = [];
  for (const [o, s] of [
    ['C', 'D'],
    ['C', 'H'],
    ['C', 'S'],
    ['D', 'H'],
    ['D', 'S'],
    ['H', 'S'],
  ]) {
    const at = `1${o} 1${s} 1N`;
    // new minor forcing: with five of the major and 11+, ask whether opener has three of it (or,
    // after spades, four hearts)
    if (s === 'H' || s === 'S') {
      const nm = o === 'C' ? 'D' : 'C';
      const ask = `${at} 2${nm}`;
      out.push(
        r(at, `2${nm}`, { hcp: [11, 18], [s]: [5, 13] }, `new minor forcing: five ${word(s)}, 11+ points, asks for three`, { forcing: 'round' }),
        r(ask, `2${s}`, { [s]: [3, 3] }, `three ${word(s)}`),
        ...(s === 'S' ? [r(ask, '2H', { H: [4, 4] }, 'four hearts, not three spades')] : []),
        r(ask, '2N', {}, `not three ${word(s)}`),
        // (then responder places it: game, or an invitation opener takes with 14)
        r(`${ask} 2${s}`, `4${s}`, { hcp: [13, 18] }, 'game in the fit'),
        r(`${ask} 2${s}`, `3${s}`, { hcp: [11, 12] }, 'invites game in the fit'),
        r(`${ask} 2${s} 3${s}`, `4${s}`, { hcp: [14, 14] }, 'the top of the range'),
        r(`${ask} 2${s} 3${s}`, 'P', {}, ''),
        r(`${ask} 2N`, '3N', { hcp: [13, 18] }, 'to play'),
        r(`${ask} 2N`, `3${s}`, { hcp: [11, 18], [s]: [6, 13] }, `six ${word(s)}, invites game`),
        r(`${ask} 2N`, 'P', { hcp: [11, 12] }, ''),
        ...(s === 'S' ? [r(`${ask} 2H`, '3N', { hcp: [13, 18] }, 'to play'), r(`${ask} 2H`, '2N', { hcp: [11, 12] }, 'invites 3NT')] : []),
      );
    }
    out.push(
      r(at, '3N', { hcp: [13, 18] }, 'to play'),
      r(at, '2N', { hcp: [11, 12] }, 'invites 3NT'),
      r(at, `2${s}`, { hcp: [0, 10], [s]: [6, 13] }, `six or more ${word(s)}, to play`),
      r(at, 'P', { hcp: [0, 10] }, ''),
    );
  }
  return out;
}

/** Opener after 1x – 2y (a two-over-one response). */
function rebidOverTwo(open: string, resp: string): Rule[] {
  const at = `1${open} 2${resp}`;
  const major = open === 'H' || open === 'S';
  const respMajor = resp === 'H' || resp === 'S';
  return [
    // support: three for a major (which showed five), four for a minor
    r(at, `3${resp}`, { hcp: [10, 21], [resp]: [respMajor ? 3 : 4, 13] }, `support: ${respMajor ? 'three' : 'four'} or more ${word(resp)}`),
    r(at, `2${open}`, { hcp: [10, 21], [open]: [6, 13] }, `six or more ${word(open)}`),
    ...(major && open === 'H' ? [r(at, '2S', { hcp: [10, 21], S: [4, 4] }, 'four spades')] : []),
    r(at, '2N', { hcp: [12, 14], balanced: true }, '12–14 points, balanced'),
    r(at, '3N', { hcp: [15, 18], balanced: true }, '15–18 points, balanced'),
    ...['C', 'D']
      .filter((x) => x !== open && x !== resp)
      .map((x) => r(at, `${'CDHS'.indexOf(x) > 'CDHS'.indexOf(resp) ? 2 : 3}${x}`, { hcp: [10, 21], [x]: [4, 13] }, `four or more ${word(x)}`)),
    r(at, `2${open}`, { hcp: [10, 21] }, `${major ? 'five' : 'four'} or more ${word(open)}, nothing else to show`),
  ];
}

/**
 * Two over one, responder's second call when opener rebids the major (forced to game already):
 * with a fit, game at once says there's nothing more (fast arrival); three of the major, below
 * game, says there may be a slam.
 */
function fastArrival(x: 'H' | 'S'): Rule[] {
  return ['S', 'H', 'D', 'C']
    .filter((y) => y !== x && 'CDHS'.indexOf(y) < 'CDHS'.indexOf(x))
    .flatMap((y) => {
      const at = `1${x} 2${y} 2${x}`;
      return [
        r(at, `3${x}`, { hcp: [16, 37], [x]: [3, 13] }, `a fit, 16+ points: interest in slam`, { only: 'twoOverOne', forcing: 'game' }),
        r(at, `4${x}`, { hcp: [13, 15], [x]: [3, 13] }, `a fit, 13–15 points: no interest in slam`, { only: 'twoOverOne' }),
      ];
    });
}

/** Responder's second call, after opener's rebid in a one-level auction. */
function responderRebid(open: string, resp: string): Rule[] {
  const out: Rule[] = [];
  const rank = 'CDHS';
  const respMajor = resp === 'H' || resp === 'S';
  const dp = (x: string) => (h: HandInfo) => dummyPoints(h, x);
  // opener raised: game, invite, or rest
  out.push(
    r(`1${open} 1${resp} 2${resp}`, respMajor ? `4${resp}` : '3N', { hcp: [11, 37] }, respMajor ? 'to play' : 'to play', { also: (h) => dp(resp)(h) >= 13 }),
    r(`1${open} 1${resp} 2${resp}`, `3${resp}`, { hcp: [9, 12] }, 'invites game', { also: (h) => dp(resp)(h) >= 11 }),
    r(`1${open} 1${resp} 2${resp}`, 'P', {}, ''),
    r(`1${open} 1${resp} 3${resp}`, respMajor ? `4${resp}` : '3N', { hcp: [8, 37] }, 'accepts'),
    r(`1${open} 1${resp} 3${resp}`, 'P', {}, ''),
    r(`1${open} 1${resp} 2N`, respMajor ? `4${resp}` : '3N', { hcp: [6, 37], [resp]: respMajor ? [6, 13] : [0, 13] }, 'to play'),
    r(`1${open} 1${resp} 2N`, '3N', { hcp: [6, 37] }, 'to play'),
    r(`1${open} 1${resp} 2N`, 'P', {}, ''),
  );
  // opener rebid the suit (six or more, 12–15)
  const own = `1${open} 1${resp} 2${open}`;
  out.push(
    ...(respMajor ? [r(own, `4${resp}`, { hcp: [13, 37], [resp]: [6, 13] }, `six or more ${word(resp)}: game`)] : []),
    r(own, '3N', { hcp: [13, 18] }, 'to play'),
    r(own, `3${open}`, { hcp: [10, 12], [open]: [2, 13] }, `invites game in ${word(open)}`),
    r(own, '2N', { hcp: [11, 12] }, 'invites 3NT'),
    r(own, `${rank.indexOf(resp) > rank.indexOf(open) ? 2 : 3}${resp}`, { hcp: [6, 10], [resp]: [6, 13] }, `six or more ${word(resp)}, to play`),
    r(own, 'P', {}, ''),
  );
  // opener showed a new suit (z): support it, prefer the first, or no trumps
  for (const z of ['C', 'D', 'H', 'S']) {
    if (z === open || z === resp) continue;
    const zLevel = rank.indexOf(z) > rank.indexOf(resp) ? 1 : 2;
    const at = `1${open} 1${resp} ${zLevel}${z}`;
    const zMajor = z === 'H' || z === 'S';
    const pref = rank.indexOf(open) > rank.indexOf(z) || zLevel === 1 ? 2 : 3;
    // the fourth suit: bid without a stopper in it, it asks opener for one (and forces to game)
    const fourth = [...rank].find((x) => x !== open && x !== resp && x !== z)!;
    const fsf = `${rank.indexOf(fourth) > rank.indexOf(z) ? zLevel : zLevel + 1}${fourth}`;
    const held = (h: HandInfo) => stopped(h, fourth);
    out.push(
      ...(zMajor ? [r(at, `4${z}`, { hcp: [11, 37], [z]: [4, 13] }, `four or more ${word(z)}: game`, { also: (h) => dp(z)(h) >= 13 })] : []),
      ...(respMajor ? [r(at, `4${resp}`, { hcp: [13, 37], [resp]: [6, 13] }, `six or more ${word(resp)}: game`)] : []),
      r(at, '3N', { hcp: [13, 18] }, `to play: a stopper in ${word(fourth)}`, { also: held }),
      ...(levelOf(fsf) >= 2 && levelOf(fsf) <= 3
        ? [
            r(at, fsf, { hcp: [12, 37] }, `fourth suit forcing: asks for a stopper in ${word(fourth)} (game forcing)`, { forcing: 'game' }),
            r(`${at} ${fsf}`, `${levelOf(fsf) === 2 ? 2 : 3}N`, {}, `a stopper in ${word(fourth)}`, { also: held }),
            r(
              `${at} ${fsf}`,
              `${rank.indexOf(resp) > rank.indexOf(fourth) ? levelOf(fsf) : levelOf(fsf) + 1}${resp}`,
              { [resp]: [3, 3] },
              `three ${word(resp)}`,
            ),
          ]
        : []),
      ...(zMajor ? [r(at, `3${z}`, { hcp: [10, 12], [z]: [4, 13] }, `four or more ${word(z)}, invites game`)] : []),
      r(at, '2N', { hcp: [11, 12] }, `invites 3NT: a stopper in ${word(fourth)}`, { also: held }),
      r(at, `3${open}`, { hcp: [10, 12], [open]: [4, 13] }, `support for ${word(open)}, invites game`),
      ...(zLevel === 1 || zMajor ? [r(at, `${zLevel + 1}${z}`, { hcp: [6, 10], [z]: [4, 13] }, `four or more ${word(z)}, 6–10 points`)] : []),
      r(at, `${rank.indexOf(resp) > rank.indexOf(z) ? zLevel : zLevel + 1}${resp}`, { hcp: [6, 10], [resp]: [6, 13] }, `six or more ${word(resp)}, to play`),
      r(at, `${pref}${open}`, { hcp: [6, 10], [open]: [3, 13] }, `prefers ${word(open)}`, { also: (h) => h.L[open] >= h.L[z] }),
      ...(zLevel === 1 ? [r(at, '1N', { hcp: [6, 10] }, '6–10 points')] : []),
      r(at, 'P', { hcp: [0, 10] }, ''),
    );
  }
  return out;
}

/** Responder's first call after the other side overcalls our one-level opening. */
const overOvercall: Rule[] = (['C', 'D', 'H', 'S'] as const).flatMap((x) => {
  const at = (c: Ctx) => c.seq === `1${x}` && c.contested && c.calls.at(-1)?.call !== 'P' && !c.lastByUs && c.doubled === 0;
  const cheap = (c: Ctx, step = 0) => {
    for (let b = c.lastBid + 1; b < 35; b++)
      if (b % 5 === 'CDHSN'.indexOf(x)) return b + step * 5 < 35 && b + step * 5 <= 13 ? `${Math.floor((b + step * 5) / 5) + 1}${x}` : null;
    return null;
  };
  const support = x === 'H' || x === 'S' ? 3 : 4;
  return [
    r(at, (c) => cheap(c, 1), { hcp: [9, 12], [x]: [support + 1, 13] }, `support for ${word(x)}, 10–12 points`, {
      also: (h) => dummyPoints(h, x) >= 10 && dummyPoints(h, x) <= 12,
    }),
    r(at, (c) => cheap(c), { hcp: [5, 10], [x]: [support, 13] }, `support for ${word(x)}, 6–10 points`, {
      also: (h) => dummyPoints(h, x) >= 6 && dummyPoints(h, x) <= 10,
    }),
  ];
});

/** The cheapest bid in suit `x` (by name) above the last bid, a level higher with `jump`. */
function cheapIn(c: Ctx, x: string, jump = 0): string | null {
  for (let b = c.lastBid + 1; b < 35; b++)
    if (b % 5 === 'CDHSN'.indexOf(x)) {
      const n = b + jump * 5;
      return n < 35 ? `${Math.floor(n / 5) + 1}${x}` : null;
    }
  return null;
}
/** The other side's suit (their last bid). */
const theirs = (c: Ctx) => {
  const t = c.theirBids.at(-1);
  return t && t[1] !== 'N' ? t[1] : null;
};

/** Opener, after partner's negative double (the other side passing). */
const afterNegative: Rule[] = (() => {
  const at = (c: Ctx) => /^1[CDHS] X$/.test(c.seq) && c.contested && !c.lastByUs && c.calls.at(-1)?.call === 'P';
  const open = (c: Ctx) => c.seq[1];
  const unbid = (c: Ctx) => ['H', 'S'].filter((x) => x !== open(c) && x !== theirs(c));
  const out: Rule[] = [];
  for (const x of ['S', 'H']) {
    const ok = (h: HandInfo, c: Ctx) => unbid(c).includes(x) && (x === 'S' || !unbid(c).includes('S') || h.L.S < 4);
    out.push(
      r(at, (c) => cheapIn(c, x, 1), { hcp: [15, 18], [x]: [4, 13] }, `four or more ${word(x)}, 15–18 points`, { also: ok }),
      r(at, (c) => cheapIn(c, x), { hcp: [10, 14], [x]: [4, 13] }, `four or more ${word(x)}, a minimum`, { also: ok }),
    );
  }
  out.push(
    r(at, (c) => cheapIn(c, 'N'), { hcp: [12, 14], balanced: true }, 'a stopper in their suit, 12–14 points', {
      also: (h, c) => !!theirs(c) && stopped(h, theirs(c)!),
    }),
    r(at, (c) => cheapIn(c, 'N', 1), { hcp: [18, 19], balanced: true }, 'a stopper in their suit, 18–19 points', {
      also: (h, c) => !!theirs(c) && stopped(h, theirs(c)!),
    }),
    ...['C', 'D', 'H', 'S'].map((x) =>
      r(
        (c) => at(c) && open(c) === x,
        (c) => cheapIn(c, x),
        { [x]: [6, 13] },
        `six or more ${word(x)}`,
      ),
    ),
    ...['C', 'D'].map((x) =>
      r(
        (c) => at(c) && open(c) !== x && theirs(c) !== x,
        (c) => cheapIn(c, x),
        { [x]: [4, 13] },
        `four or more ${word(x)}`,
      ),
    ),
    ...['C', 'D', 'H', 'S'].map((x) =>
      r(
        (c) => at(c) && open(c) === x,
        (c) => cheapIn(c, x),
        {},
        `${word(x)} again: nothing else to show`,
      ),
    ),
  );
  return out;
})();

/** Responder, after the other side doubles our one-level opening for takeout. */
const overTakeout: Rule[] = (['C', 'D', 'H', 'S'] as const).flatMap((x) => {
  const at = (c: Ctx) => c.seq === `1${x}` && c.contested && c.calls.at(-1)?.call === 'X' && !c.calls.at(-1)?.ours;
  const support = x === 'H' || x === 'S' ? 3 : 4;
  return [
    r(at, '2N', { hcp: [10, 37], [x]: [support + (x === 'H' || x === 'S' ? 1 : 0), 13] }, `a limit raise or better in ${word(x)}`),
    r(at, 'XX', { hcp: [10, 37] }, '10+ points'),
    r(at, `3${x}`, { hcp: [0, 7], [x]: [support + 1, 13] }, `pre-emptive: ${word(x)}, weak`),
    r(at, `2${x}`, { hcp: [6, 9], [x]: [support, 13] }, `support for ${word(x)}, 6–9 points`),
    ...['D', 'H', 'S']
      .filter((y) => 'CDHS'.indexOf(y) > 'CDHS'.indexOf(x))
      .map((y) => r(at, `1${y}`, { hcp: [6, 9], [y]: [4, 13] }, `four or more ${word(y)}, 6–9 points`)),
    r(at, 'P', {}, ''),
  ];
});

export const RULES: Rule[] = [
  ...openings,
  ...majorResponses('H'),
  ...majorResponses('S'),
  ...minorResponses('C'),
  ...minorResponses('D'),
  ...notrump('1N'),
  ...notrump('2N'),
  ...strongClub,
  ...[
    ['C', 'D'],
    ['C', 'H'],
    ['C', 'S'],
    ['D', 'H'],
    ['D', 'S'],
    ['H', 'S'],
  ].flatMap(([o, s]) => rebidOverOne(o, s)),
  ...rebidOverNT('H'),
  ...rebidOverNT('S'),
  ...afterRaise('H'),
  ...afterRaise('S'),
  ...fastArrival('H'),
  ...fastArrival('S'),
  ...afterMinor('C'),
  ...afterMinor('D'),
  ...afterRebidNT(),
  ...['H', 'S', 'D']
    .flatMap((o) =>
      ['C', 'D', 'H']
        .filter((x) => x !== o && !(o === 'H' && x === 'H'))
        .filter((x) => 'CDHS'.indexOf(x) < 'CDHS'.indexOf(o) || o === 'S')
        .map((x) => [o, x]),
    )
    .flatMap(([o, x]) => rebidOverTwo(o, x)),
  ...[
    ['C', 'D'],
    ['C', 'H'],
    ['C', 'S'],
    ['D', 'H'],
    ['D', 'S'],
    ['H', 'S'],
  ].flatMap(([o, s]) => responderRebid(o, s)),
  ...overOvercall,
  ...afterNegative,
  ...overTakeout,
];
