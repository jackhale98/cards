import { bidOf, type Call } from '../contracts';
import { bidNo, callName, callOf, contextFor, handInfo, levelOf, stopped, strainOf, SUIT_AT, SUIT_NAME, type Ctx, type HandInfo } from './auction';
import { anyHand, mulberry, samplePartner, type Hand, type Picture } from './hands';
import { bestContract, evContested, evDeclare, evDefend, impsAgainst, isGame, oddsFor, type Odds } from './place';
import { appliesAt, callFor, fits, narrow, r, saysFor, type Rule, type System } from './rules';
import { RULES } from './sayc';

/**
 * A bot bidding a written system (SAYC or two over one): the first rule its hand fits; where the
 * rules run out, the contract it judges best from what partner has shown (see place.ts), with
 * Blackwood on the way to a slam; and against opponents who come in, overcalls, takeout and
 * negative doubles, then bidding on or defending by what each is expected to score.
 */

const word = (x: string) => SUIT_NAME[x];
const SUITS = ['S', 'H', 'D', 'C'];

/** The cheapest bid in `strain` above the last bid. */
function cheapest(c: Ctx, strain: string): string | null {
  for (let b = c.lastBid + 1; b < 35; b++) if (callName(b)[1] === strain) return callName(b);
  return null;
}
const lastTheirs = (c: Ctx) => {
  const t = c.theirBids.at(-1);
  return t && !c.lastByUs ? t : null;
};
/** Calls made since our side's last call were all passes by them (the auction waited on us). */
const quietSince = (c: Ctx, seat: number) => {
  const at = c.calls.map((x) => x.seat).lastIndexOf(seat);
  return at >= 0 && c.calls.slice(at + 1).every((x) => x.call === 'P');
};

// ---- the other side opened ----------------------------------------------------------------

const theirSuit = (c: Ctx) => {
  const t = lastTheirs(c);
  return t && strainOf(t) !== 'N' && levelOf(t) <= 3 ? strainOf(t) : null;
};
const firstAction = (c: Ctx) => c.opened === 'them' && c.seq === '' && !!lastTheirs(c);
/** Every suit the other side has bid (after 1♣ – pass – 1♥, both clubs and hearts are theirs). */
const theirSuits = (c: Ctx) => c.theirBids.map(strainOf).filter((x) => x !== 'N');
/** They've bid one suit only: what a cue bid, the unusual 2NT or a 1NT overcall are built on. */
const oneSuit = (c: Ctx) => firstAction(c) && !!theirSuit(c) && theirSuits(c).length === 1;

/** Their one-level opening is about to be passed out: we're in the balancing seat. */
const balancing = (c: Ctx) =>
  firstAction(c) && !!theirSuit(c) && levelOf(lastTheirs(c)!) === 1 && c.calls.length >= 3 && c.calls.at(-1)!.call === 'P' && c.calls.at(-2)!.call === 'P';
/** The suits a two-suited jump to 2NT shows over their opening: the two cheapest they haven't bid. */
const unusual = (t: string) => ['C', 'D', 'H'].filter((x) => x !== t).slice(0, 2);
/** The suits a cue bid of their suit (Michaels) shows: both majors over a minor, else the other major and a minor. */
const michaels = (t: string) => (t === 'C' || t === 'D' ? ['S', 'H'] : [t === 'S' ? 'H' : 'S']);
const minor5 = (h: HandInfo) => h.L.C >= 5 || h.L.D >= 5;
/** Two of the top four honours, or three of the top five: a suit worth bidding on little. */
const decentSuit = (h: HandInfo, x: string) => {
  const s = h.hand[SUIT_AT[x]];
  return s.filter((v) => v >= 11).length >= 2 || s.filter((v) => v >= 10).length >= 3;
};

const competitive: Rule[] = [
  // in the balancing seat, a little lighter: partner is marked with some values
  r(balancing, '1N', { hcp: [11, 14], balanced: true }, 'balancing: 11–14 points, balanced, a stopper in their suit', {
    also: (h, c) => stopped(h, theirSuit(c)!),
  }),
  r(balancing, 'X', { hcp: [8, 37] }, 'balancing takeout: short in their suit (or 15+)', {
    also: (h, c) => {
      const t = theirSuit(c)!;
      return h.hcp >= 15 || (h.L[t] <= 2 && SUITS.every((y) => y === t || h.L[y] >= 3));
    },
  }),
  ...SUITS.map((x) =>
    r(
      (c) => balancing(c) && theirSuit(c) !== x && !!cheapest(c, x) && levelOf(cheapest(c, x)!) <= 2,
      (c) => cheapest(c, x),
      { hcp: [6, 14], [x]: [5, 13] },
      (c) => `balancing: five or more ${word(x)}, ${levelOf(cheapest(c, x)!) === 1 ? '6–14' : '9–14'} points`,
      {
        also: (h, c) =>
          (levelOf(cheapest(c, x)!) === 1 || h.hcp >= 9) &&
          SUITS.every((y) => y === x || y === theirSuit(c) || h.L[y] < h.L[x] || (h.L[y] === h.L[x] && SUITS.indexOf(y) > SUITS.indexOf(x))),
      },
    ),
  ),
  // two-suiters: the unusual 2NT and Michaels, five-five (strong hands start with a double or an overcall)
  r(
    (c) => oneSuit(c) && levelOf(lastTheirs(c)!) === 1,
    '2N',
    { hcp: [7, 12] },
    (c) => `unusual 2NT: five or more ${word(unusual(theirSuit(c)!)[0])} and ${word(unusual(theirSuit(c)!)[1])}`,
    { also: (h, c) => unusual(theirSuit(c)!).every((x) => h.L[x] >= 5) },
  ),
  r(
    (c) => oneSuit(c) && levelOf(lastTheirs(c)!) === 1,
    (c) => `2${theirSuit(c)}`,
    { hcp: [7, 12] },
    (c) => {
      const t = theirSuit(c)!;
      return t === 'C' || t === 'D' ? 'Michaels: five or more of both majors' : `Michaels: five or more ${word(michaels(t)[0])} and a five-card minor`;
    },
    { also: (h, c) => michaels(theirSuit(c)!).every((x) => h.L[x] >= 5) && (michaels(theirSuit(c)!).length === 2 || minor5(h)) },
  ),
  r((c) => oneSuit(c) && levelOf(lastTheirs(c)!) === 1, '1N', { hcp: [15, 18], balanced: true }, '15–18 points, balanced, a stopper in their suit', {
    also: (h, c) => stopped(h, theirSuit(c)!),
  }),
  // a weak jump overcall: a decent six-card suit and not much else, a level higher than needed
  ...SUITS.map((x) => {
    const jump = (c: Ctx) => {
      const b = cheapest(c, x);
      return b && levelOf(b) <= 2 ? `${levelOf(b) + 1}${x}` : null;
    };
    return r(
      (c) => firstAction(c) && !!theirSuit(c) && !theirSuits(c).includes(x) && levelOf(lastTheirs(c)!) === 1,
      jump,
      { hcp: [5, 10], [x]: [6, 7] },
      `weak jump overcall: six or more ${word(x)}, 5–10 points`,
      { also: (h) => decentSuit(h, x) },
    );
  }),
  // a five-card suit, the longest (higher first between equals); at the two level a good one or six
  // cards (over 1NT, six), since it may be doubled
  ...SUITS.map((x) =>
    r(
      (c) => firstAction(c) && !theirSuits(c).includes(x) && !!cheapest(c, x) && levelOf(cheapest(c, x)!) <= 2,
      (c) => cheapest(c, x),
      { hcp: [8, 16], [x]: [5, 13] },
      (c) => `overcall: five or more ${word(x)}, ${levelOf(cheapest(c, x)!) === 1 ? '8–16' : '10–16'} points`,
      {
        also: (h, c) =>
          (levelOf(cheapest(c, x)!) === 1 || (h.hcp >= 10 && (h.L[x] >= 6 || (!!theirSuit(c) && decentSuit(h, x))))) &&
          SUITS.every((y) => y === x || theirSuits(c).includes(y) || h.L[y] < h.L[x] || (h.L[y] === h.L[x] && SUITS.indexOf(y) > SUITS.indexOf(x))),
      },
    ),
  ),
  // (over two suits of theirs, short in both and support for the other two)
  r(
    (c) => firstAction(c) && !!theirSuit(c) && c.doubled === 0,
    'X',
    { hcp: [12, 37] },
    (c) => (theirSuits(c).length > 1 ? 'takeout: the two unbid suits' : 'takeout: short in their suit, support for the others (or 17+)'),
    {
      also: (h, c) => {
        const t = theirSuits(c);
        return (h.hcp >= 17 && t.length === 1) || (t.every((x) => h.L[x] <= 2) && SUITS.every((y) => t.includes(y) || h.L[y] >= (t.length > 1 ? 4 : 3)));
      },
    },
  ),
  r((c) => firstAction(c), 'P', {}, ''),
  // answering partner's takeout double (the other side passed): the longest other suit, a jump with 9–11
  ...SUITS.flatMap((x) => {
    const at = (c: Ctx) => c.seq === 'X' && !c.lastByUs && quietSince(c, c.partner) && !!theirSuit(c) && theirSuit(c) !== x;
    const longest = (h: HandInfo, c: Ctx) =>
      SUITS.every(
        (y) =>
          y === x ||
          y === theirSuit(c) ||
          h.L[y] < h.L[x] ||
          (h.L[y] === h.L[x] && (SUITS.indexOf(y) > SUITS.indexOf(x) || (y !== 'H' && y !== 'S' && (x === 'H' || x === 'S')))),
      );
    const jump = (c: Ctx) => {
      const b = cheapest(c, x);
      return b && levelOf(b) < 4 ? `${levelOf(b) + 1}${x}` : null;
    };
    return [
      r(at, jump, { hcp: [9, 11], [x]: [4, 13] }, `four or more ${word(x)}, 9–11 points`, { also: longest }),
      r(at, (c) => cheapest(c, x), { hcp: [0, 8], [x]: [3, 13] }, `four or more ${word(x)} (or the longest), 0–8 points`, { also: longest }),
    ];
  }),
  // answering a takeout double with game values: a cue bid of their suit, forcing
  r(
    (c) => c.seq === 'X' && !c.lastByUs && quietSince(c, c.partner) && !!theirSuit(c),
    (c) => cheapest(c, theirSuit(c)!),
    { hcp: [12, 37] },
    'cue bid: game values, tell me more',
    { forcing: 'round' },
  ),
  // over their overcall of our opening: a negative double (four of an unbid major), or raises
  r(
    (c) =>
      /^1[CDHS]$/.test(c.seq) &&
      c.contested &&
      !!lastTheirs(c) &&
      strainOf(lastTheirs(c)!) !== 'N' &&
      c.lastBid <= bidNo('2S') &&
      c.doubled === 0 &&
      c.calls.at(-1)?.call !== 'P',
    'X',
    { hcp: [6, 37] },
    (c) => `negative double: four or more of the unbid major${unbidMajors(c).length > 1 ? 's' : ''}`,
    { also: (h, c) => unbidMajors(c).length > 0 && unbidMajors(c).every((x) => h.L[x] >= 4) && (c.lastBid < 5 || h.hcp >= 8) },
  ),
];

/** The majors nobody has bid yet. */
const unbidMajors = (c: Ctx) => ['H', 'S'].filter((x) => !c.theirBids.some((b) => strainOf(b) === x) && !c.seq.split(' ').some((b) => strainOf(b ?? '') === x));

// ---- Blackwood ------------------------------------------------------------------------------

/** Partner's last call was 4NT asking for aces (not a raise of no trumps). */
function blackwoodAsked(c: Ctx): boolean {
  const ours = c.seq.split(' ');
  if (ours.at(-1) !== '4N' || c.lastBid !== bidNo('4N') || !c.lastByUs) return false;
  return isBlackwood(ours.slice(0, -1));
}
/**
 * 4NT after these calls of ours asks for aces; straight after a no-trump bid it's a raise, asking for
 * the top of the range, and so it is after our no-trump opening until a suit is agreed (1NT – 2♣ –
 * 2♥ – 4NT: no fit found, so the same question).
 */
const isBlackwood = (before: string[]) =>
  !!before.length && strainOf(before.at(-1)!) !== 'N' && !(['1N', '2N'].includes(before[0]) && !agreedSuit(before, true));
/**
 * The suit our side has agreed (the last one both partners have bid), else the last suit bid: the
 * trumps Roman Key Card Blackwood counts the king and queen of.
 */
export function agreedSuit(ours: string[], both = false): string | null {
  const suits = ours.map((b) => (b.length === 2 && b[1] !== 'N' ? b[1] : null));
  for (let i = suits.length - 1; i >= 0; i--) if (suits[i] && suits.some((x, j) => x === suits[i] && j % 2 !== i % 2)) return suits[i];
  return both ? null : (suits.filter(Boolean).at(-1) ?? null);
}
/** Key cards: the four aces and the king of trumps. */
const keyCards = (h: HandInfo, trump: string | null) => h.aces + (trump && h.hand[SUIT_AT[trump]].includes(13) ? 1 : 0);
const trumpQueen = (h: HandInfo, trump: string | null) => !!trump && h.hand[SUIT_AT[trump]].includes(12);
const trumpOf = (c: Ctx) => agreedSuit(c.seq.split(' ').slice(0, -1));

/** The answers, and what each says: how many aces (SAYC), or key cards and the queen of trumps (two over one, 1430). */
const ANSWERS: Record<System, { counts: number[]; queen?: boolean }[]> = {
  sayc: [{ counts: [0, 4] }, { counts: [1] }, { counts: [2] }, { counts: [3] }],
  twoOverOne: [{ counts: [1, 4] }, { counts: [0, 3] }, { counts: [2], queen: false }, { counts: [2], queen: true }],
};
const ACES = ['0 or 4', '1', '2', '3'];
const blackwood: Rule[] = [
  ...['5C', '5D', '5H', '5S'].map((call, n) =>
    r(blackwoodAsked, call, {}, `${ACES[n]} ace${n === 1 ? '' : 's'}`, { only: 'sayc', also: (h) => h.aces % 4 === n }),
  ),
  ...['5C', '5D', '5H', '5S'].map((call, n) => {
    const a = ANSWERS.twoOverOne[n];
    return r(
      blackwoodAsked,
      call,
      {},
      (c) =>
        `${a.counts.join(' or ')} key cards${a.queen == null ? '' : a.queen ? ', with' : ', without'}${a.queen == null ? '' : ` the queen of ${word(trumpOf(c) ?? 'S')}`}`,
      { only: 'twoOverOne', also: (h, c) => a.counts.includes(keyCards(h, trumpOf(c))) && (a.queen == null || a.queen === trumpQueen(h, trumpOf(c))) },
    );
  }),
];

/** Partner asked for the queen of trumps (the next step after our 5♣ or 5♦ answer): the trumps, or null. */
function queenAsked(c: Ctx): string | null {
  const ours = c.seq.split(' ');
  if (ours.at(-3) !== '4N' || !['5C', '5D'].includes(ours.at(-2)!) || !c.lastByUs || c.lastBid !== bidNo(ours.at(-1)!)) return null;
  const trump = agreedSuit(ours.slice(0, -3));
  if (!trump) return null;
  let ask = bidNo(ours.at(-2)!) + 1;
  while (ask % 5 === 'CDHSN'.indexOf(trump)) ask++;
  return callName(ask) === ours.at(-1) ? trump : null;
}
const queenAnswers: Rule[] = [
  r(
    (c) => !!queenAsked(c),
    (c) => `6${queenAsked(c)}`,
    {},
    (c) => `the queen of ${word(queenAsked(c)!)}`,
    { only: 'twoOverOne', also: (h, c) => trumpQueen(h, queenAsked(c)) },
  ),
  r(
    (c) => !!queenAsked(c),
    (c) => `5${queenAsked(c)}`,
    {},
    (c) => `not the queen of ${word(queenAsked(c)!)}`,
    { only: 'twoOverOne' },
  ),
];

/** Gerber: 4♣ straight over partner's 1NT or 2NT asks for aces (4NT there asks for the top of the range). */
const gerberAsked = (c: Ctx) => /^[12]N 4C$/.test(c.seq) && c.lastByUs && c.lastBid === bidNo('4C');
const gerber: Rule[] = ['4D', '4H', '4S', '4N'].map((call, n) =>
  r(gerberAsked, call, {}, `${ACES[n]} ace${n === 1 ? '' : 's'} (answering Gerber)`, { also: (h) => h.aces % 4 === n }),
);

const ALL: Rule[] = [...RULES, ...competitive, ...blackwood, ...queenAnswers, ...gerber];

// ---- reading partner ---------------------------------------------------------------------------

export interface Reading {
  /** What partner's calls have shown. */
  pic: Picture;
  /** Partner's last call was one we may not pass (a forcing bid, the other side quiet). */
  forced: boolean;
  /** Our side has agreed to bid game. */
  gameForced: boolean;
  /** Partner's last call simply said where to play (no rule): leave it unless clearly wrong. */
  placed: boolean;
  /** Partner's answer to Blackwood: the aces (or key cards) it may show, and the queen of trumps if it says. */
  aces: { counts: number[]; queen?: boolean } | null;
  /** Each call's meaning by the system ('' for the other side's and plain passes). */
  notes: string[];
  /** The fewest high-card points the other side's calls have promised between them, and cards in each suit. */
  theirs: number;
  theirCards: number[];
}

/** The rules that could have made `call` here. */
const rulesFor = (system: System, c: Ctx, name: string) => ALL.filter((x) => appliesAt(x, c, system) && callFor(x, c) === name);

/** For each of those, the rules ahead of it that the bidder would have taken instead (a legal call, a different one). */
function ahead(system: System, c: Ctx, name: string): { rules: Rule[]; before: Rule[][] } {
  const live = ALL.filter((x) => appliesAt(x, c, system));
  const rules: Rule[] = [];
  const before: Rule[][] = [];
  live.forEach((x, i) => {
    if (callFor(x, c) !== name) return;
    rules.push(x);
    before.push(
      live.slice(0, i).filter((y) => {
        const other = callFor(y, c);
        return !!other && other !== name && legal(c, callOf(other));
      }),
    );
  });
  return { rules, before };
}

export function readAuction(system: System, calls: { seat: number; call: Call }[], me: number, vul: [boolean, boolean]): Reading {
  const partner = (me + 2) % 4;
  let pic = anyHand();
  let forced = false;
  let gameForced = false;
  let placed = false;
  let aces: Reading['aces'] = null;
  const notes: string[] = [];
  const theirMin: Record<number, number> = {};
  const theirLen: Record<number, number[]> = {};
  calls.forEach((x, i) => {
    const ours = x.seat === me || x.seat === partner;
    if (!ours) {
      if (x.call !== 'P') forced = false;
      // (what the other side's calls promise, read by the same rules: the points partner can't have)
      if (typeof x.call === 'number' || x.call === 'X') {
        const them = contextFor(calls.slice(0, i), x.seat, [vul[1], vul[0]]);
        const rules = rulesFor(system, them, callName(x.call));
        const least = Math.min(...rules.map((rule) => rule.need.hcp?.[0] ?? 0));
        if (Number.isFinite(least)) theirMin[x.seat] = Math.max(theirMin[x.seat] ?? 0, least);
        SUITS.forEach((y, k) => {
          const n = Math.min(...rules.map((rule) => rule.need[y as 'S']?.[0] ?? 0));
          if (Number.isFinite(n)) theirLen[x.seat] = theirLen[x.seat] ?? [0, 0, 0, 0];
          if (Number.isFinite(n)) theirLen[x.seat][k] = Math.max(theirLen[x.seat][k], n);
        });
      }
      notes.push('');
      return;
    }
    const c = contextFor(calls.slice(0, i), x.seat, vul);
    const name = callName(x.call);
    const { rules: matching, before } = ahead(system, c, name);
    const rule = matching[0];
    if (rule) notes.push(saysFor(rule, c));
    else if (typeof x.call === 'number' && name === '4N' && isBlackwood(c.seq ? c.seq.split(' ') : []))
      notes.push(system === 'twoOverOne' ? 'Roman Key Card Blackwood: asks for key cards (the aces and the king of trumps)' : 'Blackwood: asks for aces');
    else if (typeof x.call === 'number' && name === '4N' && c.seq) notes.push('asks partner to bid slam with the top of their range');
    else if (name === '4C' && /^[12]N$/.test(c.seq) && !c.contested) notes.push('Gerber: asks for aces');
    else notes.push(typeof x.call === 'number' ? 'to play' : x.call === 'X' ? 'for penalties' : '');
    if (x.seat === partner) {
      if (matching.length) pic = narrow(pic, matching, c, before);
      forced = !!rule?.forcing;
      if (rule?.forcing === 'game') gameForced = true;
      // (no rule: it says where to play; nor does a game bid that forces nothing)
      placed = typeof x.call === 'number' && name !== '4N' && (!rule || (!rule.forcing && isGame(x.call)));
      if (rule && blackwood.includes(rule)) aces = ANSWERS[system][blackwood.indexOf(rule) % 4];
      if (rule && gerber.includes(rule)) aces = ANSWERS.sayc[gerber.indexOf(rule)];
    } else {
      if (rule?.forcing === 'game') gameForced = true;
      forced = false;
    }
  });
  const theirCards = [0, 1, 2, 3].map((k) => Object.values(theirLen).reduce((n, l) => n + l[k], 0));
  return { pic, forced, gameForced, placed, aces, notes, theirs: Object.values(theirMin).reduce((a, b) => a + b, 0), theirCards };
}

/** What the last call meant, for the log. */
export function explainLast(system: System, calls: { seat: number; call: Call }[], vul: [boolean, boolean]): string {
  if (!calls.length) return '';
  return readAuction(system, calls, calls.at(-1)!.seat, vul).notes.at(-1) ?? '';
}

// ---- the bot's call ----------------------------------------------------------------------------

const SAMPLES = 40;

export function systemCall(system: System, calls: { seat: number; call: Call }[], me: number, vul: [boolean, boolean], hand: Hand): Call {
  const c = contextFor(calls, me, vul);
  const h = handInfo(hand);
  // a rule that fits
  for (const rule of ALL) {
    if (!appliesAt(rule, c, system) || !fits(rule, h, c)) continue;
    const name = callFor(rule, c);
    if (!name) continue;
    const call = callOf(name);
    if (legal(c, call)) return call;
  }
  const read = readAuction(system, calls, me, vul);
  // partner holds what the other side and this hand don't
  const room = Math.max(0, 40 - h.hcp - read.theirs);
  if (read.pic.hcp[1] > room) read.pic = { ...read.pic, hcp: [Math.min(read.pic.hcp[0], room), room] };
  const maxLen = read.pic.maxLen.map((m, k) => Math.max(read.pic.minLen[k], Math.min(m, 13 - h.len[k] - read.theirCards[k])));
  read.pic = { ...read.pic, maxLen };
  const rand = mulberry(hand.flat().reduce((n, v, i) => (n * 31 + v * (i + 1)) | 0, calls.length + 11));
  let cached: Odds | null = null;
  // (only partner's picture as read is kept: a narrowed one is worked out each time)
  const odds = (pic = read.pic) =>
    pic !== read.pic ? oddsFor(hand, samplePartner(hand, pic, SAMPLES, rand)) : (cached ??= oddsFor(hand, samplePartner(hand, pic, SAMPLES, rand)));
  const ours = c.lastByUs ? c.lastBid : null;
  const [vulUs] = vul;

  // after partner's answer to our Blackwood: missing two aces (key cards), stop at five; one, bid
  // six (unless the queen of trumps is missing too); none, look at seven
  const seq = c.seq.split(' ');
  // (2: partner just answered; 4: partner answered, we asked for the queen, and partner said)
  const queenAsk = system === 'twoOverOne' && seq.at(-4) === '4N' && ['5C', '5D'].includes(seq.at(-3)!);
  // (Gerber: partner answered our 4♣ over their no trumps, with aces alone)
  const gerberAnswered = seq.length === 3 && /^[12]N$/.test(seq[0]) && seq[1] === '4C';
  const asked = read.aces != null ? (seq.at(-2) === '4N' || gerberAnswered ? 2 : queenAsk ? 4 : 0) : 0;
  if (asked) {
    const rkc = system === 'twoOverOne' && !gerberAnswered;
    const before = seq.slice(0, -asked);
    // (the suit partner counted the king and queen of)
    const trump = rkc ? agreedSuit(before) : null;
    const answer = read.aces!;
    const reply = asked === 4 ? levelOf(seq.at(-1)!) === 6 : null;
    const queenOf = (x: Hand, suit: string | null) => !!suit && x[SUIT_AT[suit]].includes(12);
    // the hands partner can hold, given the answer (and what they said about the queen)
    const pic: Picture = {
      ...read.pic,
      test: (x) =>
        (read.pic.test?.(x) ?? true) &&
        answer.counts.includes(keyCards(handInfo(x), trump)) &&
        (answer.queen == null || queenOf(x, trump) === answer.queen) &&
        (reply == null || queenOf(x, trump) === reply),
    };
    const hands = samplePartner(hand, pic, 24, rand);
    // (the suit both have bid, or where the side plays best)
    const strain = agreedSuit(before, true) ?? bestStrain(odds(pic), vulUs);
    const suit = strain === 'N' ? null : strain;
    const at = (level: number) => (level - 1) * 5 + 'CDHSN'.indexOf(strain);
    const stay = (b: number): Call => (b > c.lastBid ? b : 'P');
    // on each, the key cards missing in the strain we'd play (aces, at no trumps or in SAYC),
    // and whether the queen of trumps is missing too
    const kc = (x: HandInfo) => (rkc ? keyCards(x, suit) : x.aces);
    const tally = hands.map((x) => {
      const missing = (rkc && suit ? 5 : 4) - kc(h) - kc(handInfo(x));
      const queen = !rkc || !suit || trumpQueen(h, suit) || queenOf(x, suit);
      return { missing, queen };
    });
    const share = (f: (t: { missing: number; queen: boolean }) => boolean) => (tally.length ? tally.filter(f).length / tally.length : 0);
    const unsafe = share((t) => t.missing >= 2 || (t.missing === 1 && !t.queen));
    const queenUnknown = suit === trump && reply == null && answer.queen == null && !trumpQueen(h, suit);
    // the queen of trumps could go either way: ask for her, with the next step that isn't trumps
    // (while five of trumps is still there to stop in)
    if (rkc && asked === 2 && queenUnknown && share((t) => t.missing <= 1) > 0.5 && unsafe > 0.2 && unsafe < 0.8) {
      let ask = c.lastBid + 1;
      while (ask % 5 === 'CDHSN'.indexOf(trump!)) ask++;
      if (ask < at(5)) return ask;
    }
    // too much missing: stop at five (in no trumps when five of the suit is already past)
    if (!tally.length || unsafe > 0.5) return at(5) >= c.lastBid ? stay(at(5)) : stay(bidNo('5N'));
    // a grand only when nothing is missing and all thirteen tricks look likely (a near thing is a big loss when it fails)
    const o = odds(pic);
    const k = 'SHDCN'.indexOf(strain);
    const thirteen = o.reduce((n, x) => n + x[k][13], 0) / Math.max(1, o.length);
    const grand = share((t) => t.missing === 0 && t.queen) > 0.9 && thirteen >= 0.7;
    return stay(at(grand ? 7 : 6));
  }

  if (c.contested) return compete(odds(), c, ours, vulUs, vul[1]);

  // partner asked for aces and has the answer: their call is the last word
  const theirs = c.calls.filter((x) => x.seat === c.partner && typeof x.call === 'number').map((x) => callName(x.call));
  if (theirs.slice(0, -1).includes('4N') && read.placed) return 'P';
  // (each bot overrules partner's choice of contract once at most)
  const overruled = c.calls.filter(
    (x, i) =>
      x.seat === me &&
      typeof x.call === 'number' &&
      // (a raise below game to agree trumps on the way to a slam isn't a choice of contract)
      isGame(x.call) &&
      !ALL.some(
        (rule) =>
          appliesAt(rule, contextFor(c.calls.slice(0, i), me, vul), system) && callFor(rule, contextFor(c.calls.slice(0, i), me, vul)) === callName(x.call),
      ),
  ).length;

  // where to play, from what partner has shown
  const forcing = read.forced || (read.gameForced && (ours == null || !isGame(ours)));
  const skip = (b: number) => b === bidNo('4N') || (read.gameForced && !isGame(b));
  const choice = bestContract(odds(), vulUs, { above: c.lastBid, keep: forcing ? null : ours, skip });
  if (choice.call === 'P') return forcing ? (bestContract(odds(), vulUs, { above: c.lastBid, skip }).call as Call) : 'P';
  // partner just said where to play: leave it unless this is clearly better, in IMPs (and never a slam they chose)
  if (read.placed && ours != null && (overruled >= 1 || bidOf(ours).level >= 6 || impsAgainst(odds(), choice.call, ours, vulUs) < 1.5)) return 'P';
  // a slam in a suit not yet agreed: agree it first, below game, while partner can't pass (forced
  // to game), as a good player shows the fit before asking for aces
  if (bidOf(choice.call).level >= 6 && read.gameForced && !c.contested) {
    const strain = callName(choice.call)[1];
    const agree = strain !== 'N' && agreedSuit(c.seq.split(' '), true) !== strain ? cheapest(c, strain) : null;
    if (agree && !isGame(bidNo(agree))) return bidNo(agree);
  }
  // straight over partner's no trumps, ask for aces with Gerber (4NT would ask for the top of the range)
  if (bidOf(choice.call).level >= 6 && /^[12]N$/.test(c.seq) && !c.contested && c.lastBid < bidNo('4C')) return bidNo('4C');
  // a slam: ask for aces on the way (unless 4NT is past, or would be a raise of no trumps)
  if (bidOf(choice.call).level >= 6 && c.lastBid < bidNo('4N') && !c.seq.includes('4N') && isBlackwood(c.seq.split(' '))) return bidNo('4N');
  return choice.call;
}

/** The strain the side's best contract is in. */
function bestStrain(odds: Odds, vul: boolean): string {
  const choice = bestContract(odds, vul, { above: bidNo('5C') - 1, top: bidNo('7N') });
  return choice.call === 'P' ? 'N' : callName(choice.call)[1];
}

/** Bid on, double or defend, by what each is expected to score. */
function compete(odds: Odds, c: Ctx, ours: number | null, vul: boolean, theirVul: boolean): Call {
  if (c.lastBid < 0) {
    const choice = bestContract(odds, vul, { above: -1 });
    return choice.call;
  }
  let pass = ours != null ? evDeclare(odds, ours, vul, c.doubled) : evDefend(odds, c.lastBid, theirVul, c.doubled);
  let call: Call = 'P';
  if (ours == null && c.doubled === 0 && bidOf(c.lastBid).level >= 3) {
    const x = evDefend(odds, c.lastBid, theirVul, 1);
    if (x > pass + 150) {
      pass = x;
      call = 'X';
    }
  }
  // doubled: one run to another contract at most, never a chase up the levels
  if (ours != null && c.doubled) {
    const ran = c.calls.some((x, i) => x.ours && typeof x.call === 'number' && c.calls.slice(0, i).some((y) => !y.ours && y.call === 'X'));
    if (ran) return call;
  }
  // (the five level is where a misjudged sacrifice costs most: bid there only when clearly better)
  const margin = (b: number) => 30 + (bidOf(b).level >= 5 ? 120 : 0);
  // (each bid valued as the other side would let it play: doubled when it fails)
  let best: Call = call;
  let bestEv = pass;
  // (no slams in a fight for the contract: there's no room to find out enough)
  for (let b = c.lastBid + 1; b < bidNo('6C'); b++) {
    if (b === bidNo('4N')) continue;
    const ev = evContested(odds, b, vul);
    if (ev > pass + margin(b) && ev > bestEv) {
      best = b;
      bestEv = ev;
    }
  }
  return best;
}

/** The rules that apply at this point of the auction for `me`, in the order the bidder tries them (for grading a person's call). */
export function rulesHere(system: System, calls: { seat: number; call: Call }[], me: number, vul: [boolean, boolean]): { c: Ctx; rules: Rule[] } {
  const c = contextFor(calls, me, vul);
  return { c, rules: ALL.filter((x) => appliesAt(x, c, system)) };
}

export function legal(c: Ctx, call: Call): boolean {
  if (typeof call === 'number') return call > c.lastBid && call < 35;
  if (call === 'X') return c.lastBid >= 0 && !c.lastByUs && c.doubled === 0;
  if (call === 'XX') return c.lastByUs && c.doubled === 1;
  return true;
}
