import { bidOf, type Call } from '../contracts';
import { bidNo, callName, callOf, contextFor, handInfo, levelOf, stopped, strainOf, SUIT_NAME, type Ctx, type HandInfo } from './auction';
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

const competitive: Rule[] = [
  r(
    (c) => firstAction(c) && !!theirSuit(c) && levelOf(lastTheirs(c)!) === 1,
    '1N',
    { hcp: [15, 18], balanced: true },
    '15–18 points, balanced, a stopper in their suit',
    {
      also: (h, c) => stopped(h, theirSuit(c)!),
    },
  ),
  // a five-card suit, the longest (higher first between equals)
  ...SUITS.map((x) =>
    r(
      (c) => firstAction(c) && theirSuit(c) !== x && !!cheapest(c, x) && levelOf(cheapest(c, x)!) <= 2,
      (c) => cheapest(c, x),
      { hcp: [8, 16], [x]: [5, 13] },
      (c) => `overcall: five or more ${word(x)}, ${levelOf(cheapest(c, x)!) === 1 ? '8–16' : '10–16'} points`,
      {
        also: (h, c) =>
          (levelOf(cheapest(c, x)!) === 1 || h.hcp >= 10) &&
          SUITS.every((y) => y === x || y === theirSuit(c) || h.L[y] < h.L[x] || (h.L[y] === h.L[x] && SUITS.indexOf(y) > SUITS.indexOf(x))),
      },
    ),
  ),
  r((c) => firstAction(c) && !!theirSuit(c) && c.doubled === 0, 'X', { hcp: [12, 37] }, 'takeout: short in their suit, support for the others (or 17+)', {
    also: (h, c) => {
      const t = theirSuit(c)!;
      return h.hcp >= 17 || (h.L[t] <= 2 && SUITS.every((y) => y === t || h.L[y] >= 3));
    },
  }),
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
  // over their overcall of our opening: a negative double (four of an unbid major), or raises
  r(
    (c) => /^1[CDHS]$/.test(c.seq) && c.contested && !!lastTheirs(c) && c.lastBid <= bidNo('2S') && c.doubled === 0 && c.calls.at(-1)?.call !== 'P',
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
/** 4NT after these calls of ours asks for aces; straight after a no-trump bid it's a raise, asking for the top of the range. */
const isBlackwood = (before: string[]) => !!before.length && strainOf(before.at(-1)!) !== 'N';
const ACES = ['0 or 4', '1', '2', '3'];
const blackwood: Rule[] = ['5C', '5D', '5H', '5S'].map((call, n) =>
  r(blackwoodAsked, call, {}, `${ACES[n]} ace${n === 1 ? '' : 's'}`, { also: (h) => h.aces % 4 === n }),
);

const ALL: Rule[] = [...RULES, ...competitive, ...blackwood];

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
  /** The aces partner showed in answer to Blackwood. */
  aces: number | null;
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
  let aces: number | null = null;
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
    else if (typeof x.call === 'number' && name === '4N') notes.push('Blackwood: asks for aces');
    else notes.push(typeof x.call === 'number' ? 'to play' : x.call === 'X' ? 'for penalties' : '');
    if (x.seat === partner) {
      if (matching.length) pic = narrow(pic, matching, c, before);
      forced = !!rule?.forcing;
      if (rule?.forcing === 'game') gameForced = true;
      // (no rule: it says where to play; nor does a game bid that forces nothing)
      placed = typeof x.call === 'number' && name !== '4N' && (!rule || (!rule.forcing && isGame(x.call)));
      if (rule && blackwood.includes(rule)) aces = blackwood.indexOf(rule);
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
  const odds = (pic = read.pic) => (pic === read.pic && cached ? cached : (cached = oddsFor(hand, samplePartner(hand, pic, SAMPLES, rand))));
  const ours = c.lastByUs ? c.lastBid : null;
  const [vulUs] = vul;

  // after partner's answer to our Blackwood: missing two aces, stop at five; one, bid six; none, look at seven
  if (read.aces != null && c.seq.split(' ').at(-2) === '4N') {
    const theirs = read.aces === 0 && read.pic.hcp[0] >= 13 ? 4 : read.aces;
    const missing = 4 - h.aces - theirs;
    const pic: Picture = { ...read.pic, test: (x) => (read.pic.test?.(x) ?? true) && x.filter((s) => s[0] === 14).length === theirs };
    const strain = bestStrain(odds(pic), vulUs);
    const at = (level: number) => (level - 1) * 5 + 'CDHSN'.indexOf(strain);
    if (missing >= 2) return at(5) > c.lastBid ? at(5) : 'P';
    if (missing === 1) return at(6);
    // a grand only when all thirteen tricks look likely (a near thing is a big loss when it fails)
    const o = odds(pic);
    const k = 'SHDCN'.indexOf(strain);
    const thirteen = o.reduce((n, x) => n + x[k][13], 0) / Math.max(1, o.length);
    return thirteen >= 0.7 ? at(7) : at(6);
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
  // (each bid valued as the other side would let it play: doubled when it fails)
  let best: Call = call;
  let bestEv = pass + 30;
  // (no slams in a fight for the contract: there's no room to find out enough)
  for (let b = c.lastBid + 1; b < bidNo('6C'); b++) {
    if (b === bidNo('4N')) continue;
    const ev = evContested(odds, b, vul);
    if (ev > bestEv) {
      best = b;
      bestEv = ev;
    }
  }
  return best;
}

function legal(c: Ctx, call: Call): boolean {
  if (typeof call === 'number') return call > c.lastBid && call < 35;
  if (call === 'X') return c.lastBid >= 0 && !c.lastByUs && c.doubled === 0;
  if (call === 'XX') return c.lastByUs && c.doubled === 1;
  return true;
}
