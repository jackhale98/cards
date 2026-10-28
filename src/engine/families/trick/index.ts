import { createState, log, name, nextSeat, placesFromScores } from '../../state';
import { ownOnly } from '../../redact';
import { botBudget, botLevel, easyMove, searchMove } from '../../bots/search';
import { loadDds } from '../../bots/dds';
import { assertRule, type GameConfig, type GameModule } from '../../types';
import { trickActions } from './actions';
import { applyBid, applyBid500, applyBury, applyCall, applyDecline, applyDouble, applyName, applyOrder } from './bidding';
import { hardQuick, quickBot, quickTricks, trickSearch } from './bots';
import { applyCallPartner, applyDefend, applyNominate, callable, checkBoards, dealBoards, startRound } from './deal';
import { applyBlind, applyBlindGive, applyPass } from './exchange';
import { collectTrick, leadJoker, playCard } from './play';
import { endRound, finishDuplicate, impTotals, waitingForOthers } from './scoring';
import { controller, teamOf, teamsFor } from './sides';
import { trickStatus } from './status';
import { applyPitchBid } from './pitch';
import { gradePractice, practiceActions, retryPractice } from './practice';
import { duplicateBridge, trickGame, type TrickData } from './types';
import { setbackBid, setbackCard } from './setbackHard';
import { dd500Bid, ddBid, ddBudget, ddCard, ddEuchreCall, ddGame } from './ddPlay';

/**
 * The trick-taking family (Hearts, Spades, Oh Hell, Euchre, 500, Bridge, Whist…), split by stage:
 *
 * - `types.ts`     the rules from game.json (`TrickRules`, documented there), the state, and `TrickGame`
 * - `sides.ts`     partnerships, who sits out, who plays for the dummy
 * - `deal.ts`      dealing, trumps, who bids and leads, the questions before the first lead
 * - `exchange.ts`  passing cards (Hearts) and the blind nil swap (Spades)
 * - `bidding.ts`   the bidding styles: tricks, euchre, 500's auction, bridge
 * - `play.ts`      what each card counts as, what may be played, winning tricks
 * - `scoring.ts`   scoring a hand and the end of the game
 * - `actions.ts`, `status.ts`  the moves on offer and what each player sees
 * - `bots.ts`      the quick bot and the search bot; `contracts.ts` 500 and bridge contracts
 *
 * Every part is a plain function of the game (`g`, read once from game.json) and the state.
 */
export type { TrickData, TrickRules } from './types';
export * from './contracts';

/** How long Hard Setback thinks over a card, at most (its deals are solved, so it needs fewer). */
const SETBACK_MS = 1000;
/** Hard's bid for exact tricks: once a hand, so it may think a while (settled bids stop early). */
const BID_BUDGET = { samples: 160, ms: 800 };
/**
 * Easy's lookahead in the games that need one (a few imagined deals), and how often it slips; in
 * Setback, how often its rules slip. Each tuned so Normal wins about two games in three.
 */
const EASY_LOOK = { samples: 6, ms: 10 };
const EASY_LOOK_SLIPS = 0.1;
const EASY_PITCH_SLIPS = 0.1;

export function trickTakingFamily(config: GameConfig): GameModule<TrickData> {
  const g = trickGame(config);

  const module: GameModule<TrickData> = {
    config,
    botLevels: true,

    setup(players, seed, options, table) {
      const s = createState<TrickData>(config, players, seed, options, {
        round: 0,
        handSize: 0,
        passDir: null,
        passes: [],
        received: [],
        trump: null,
        broken: false,
        bids: [],
        tricks: [],
        points: [],
        scores: teamsFor(g, players.length).map(() => 0),
        bags: teamsFor(g, players.length).map(() => 0),
        trickNo: 0,
        result: null,
      });
      s.dealer = players.length - 1;
      // duplicate bridge: the boards to play, given (the same as at other tables), or dealt here
      if (g.bridgeBids && duplicateBridge(s)) {
        if (table?.boards?.length) checkBoards(g, table.boards);
        s.data.boards = table?.boards?.length ? structuredClone(table.boards) : dealBoards(g, s, Number(s.options.deals ?? g.R.end.deals ?? 4));
        s.data.results = [];
        s.data.others = [];
        // (compared with other tables: a tournament's, or in a room, the other table its host keeps)
        s.data.compared = !!table?.compared;
      }
      startRound(g, s);
      return s;
    },

    actions: (s, seat) => [...trickActions(g, s, seat), ...practiceActions(s, seat)],

    apply(s, seat, a) {
      const d = s.data;
      // (practice: a person's first call of the deal is graded as it's made)
      if (d.practice) gradePractice(g, s, seat, a);
      switch (a.type) {
        case 'practiceRetry':
          return retryPractice(s, seat);
        case 'practiceNew':
          assertRule(!!d.practice && s.phase !== 'gameOver', 'Not a practice game');
          log(s, `${name(s, seat)} asks for a new practice deal`, seat);
          return startRound(g, s);
        case 'pass':
          return applyPass(g, s, seat, a);
        case 'unpass':
          assertRule(s.phase === 'pass', 'Too late');
          d.passes[seat] = null;
          return;
        case 'bid':
          return applyBid(g, s, seat, a);
        case 'order':
        case 'orderAlone':
          return applyOrder(g, s, seat, a);
        case 'name':
        case 'nameAlone':
          return applyName(g, s, seat, a);
        case 'misere':
        case 'openMisere':
        case 'bid500':
          return applyBid500(g, s, seat, a);
        case 'call':
          return applyCall(g, s, seat, a);
        case 'double':
        case 'redouble':
          return applyDouble(g, s, seat, a);
        case 'pitchBid':
          return applyPitchBid(g, s, seat, a);
        case 'decline':
          return s.phase === 'pitch' ? applyPitchBid(g, s, seat, a) : applyDecline(g, s, seat);
        case 'bury':
          return applyBury(g, s, seat, a);
        case 'play':
          return playCard(g, s, seat, a);
        case 'leadJoker':
          return leadJoker(g, s, seat, a);
        case 'callCard':
        case 'callAlone':
          return applyCallPartner(g, s, seat, a);
        case 'nominate':
          return applyNominate(g, s, seat, a);
        case 'defendAlone':
        case 'stayIn':
          return applyDefend(g, s, seat, a);
        case 'blindNil':
        case 'look':
          return applyBlind(g, s, seat, a);
        case 'blindGive':
          return applyBlindGive(g, s, seat, a);
        case 'moonAdd':
        case 'moonSub':
          assertRule(s.phase === 'moon' && s.turn === seat, 'Not your turn');
          d.moon = a.type === 'moonSub' ? 'sub' : 'add';
          return endRound(g, s);
        case 'next':
          assertRule(s.phase === 'roundOver', 'Round not over');
          assertRule(!waitingForOthers(s), 'Waiting for the other table');
          d.round++;
          s.dealer = nextSeat(s, s.dealer);
          startRound(g, s);
          return;
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.round = 0;
          d.scores = d.scores.map(() => 0);
          d.bags = d.bags.map(() => 0);
          s.winner = undefined;
          // (duplicate: fresh boards, dealt here; the comparison was with the last game's)
          if (d.boards) Object.assign(d, { boards: dealBoards(g, s, d.boards.length), results: [], others: [] });
          startRound(g, s);
          return;
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    system(s) {
      if (s.phase !== 'trickEnd') return null;
      return { delay: 1200, run: (s) => collectTrick(g, s) };
    },

    bot(s, seat) {
      // Hard bots in the partnership games: the solver is fetched the first time one is asked
      // anything (in the bidding, so it's there by the first card; until then, cards are searched
      // as at Normal). Only where bots think, then: never for Easy or Normal, nor a table with no bots.
      if (botLevel(s.options) === 2 && ddGame(g, s.players.length)) void loadDds();
      // five-handed 500: call the best card not held (the top trump, or an ace in no trumps)
      if (s.phase === 'callPartner' && s.turn === seat) {
        const best = callable(g, s)[0];
        return best ? { type: 'callCard', amount: g.deckCards.indexOf(best) } : { type: 'callAlone' };
      }
      // Hard, bidding for tricks (Spades): the side's tricks, from deals solved double dummy
      if (s.phase === 'bid' && s.turn === seat && botLevel(s.options) === 2) {
        const bid = ddBid(g, s, seat, (cards) => quickTricks(cards, s.data.trump));
        if (bid != null) {
          // (the dealer's hook: the bids may not add up to the tricks there are)
          const others = s.data.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
          const hooked = g.trickBids?.hook && seat === s.dealer && others + bid === s.data.handSize;
          return { type: 'bid', amount: hooked ? (bid > 0 ? bid - 1 : bid + 1) : bid };
        }
      }
      // Hard, bidding exact tricks (Oh Hell): each bid it may make played out on imagined deals,
      // everyone playing toward their own bid, for the one that scores best
      if (s.phase === 'bid' && s.turn === seat && botLevel(s.options) === 2 && g.R.scoring.type === 'exact') {
        const bid = searchMove(bidSearch, s, seat, BID_BUDGET, quickBot(g, s, seat));
        if (bid) return bid;
      }
      // Hard Euchre: ordering up and naming trumps from deals solved double dummy
      if ((s.phase === 'order' || s.phase === 'name') && s.turn === seat && botLevel(s.options) === 2) {
        const call = ddEuchreCall(g, s, seat, quickBot(g, s, seat));
        if (call) return call;
      }
      // Hard Setback: the bid, from deals played to the end with the solver
      if (s.phase === 'pitch' && s.turn === seat && botLevel(s.options) === 2) return setbackBid(g, module, search, s, seat, SETBACK_MS);
      // Hard 500: the auction, from deals solved double dummy
      if (s.phase === 'auction' && s.turn === seat && botLevel(s.options) === 2) {
        const bid = dd500Bid(g, s, seat, quickBot(g, s, seat));
        if (bid) return bid;
      }
      // card play is searched unless the bots are set to Easy; the other decisions use the quick rules
      const budget = botBudget(s.options);
      // (Pitch: the first lead names trumps, a choice of its own: the quick rules make it)
      const pitching = g.R.trump === 'pitched' && !s.data.trump;
      // Hard Setback: the end of the hand solved exactly, the pitch included (see setbackHard.ts)
      if (g.pitchBids && s.phase === 'play' && controller(s) === seat && botLevel(s.options) === 2) {
        const card = setbackCard(g, module, search, s, seat, SETBACK_MS);
        if (card) return { type: 'play', cards: [card] };
      }
      if (s.phase === 'play' && controller(s) === seat && !pitching) {
        // Hard, in the partnership games: deals of the unseen cards, each solved double dummy (see ddPlay.ts)
        const dd = botLevel(s.options) === 2 ? ddCard(g, s, seat, ddBudget()) : null;
        if (dd) return { type: 'play', cards: [dd] };
        if (botLevel(s.options) === 2) return searchMove(hardSearch, s, seat, budget!, hardQuick(g, s, seat)) ?? hardQuick(g, s, seat);
        if (budget) return searchMove(search, s, seat, budget, quickBot(g, s, seat)) ?? quickBot(g, s, seat);
        // Easy, where every card counts toward the score (Hearts' points, the tricks bid in Spades
        // and Oh Hell): it looks a little way ahead, with a slip now and then (its rules alone lose
        // nearly every game to Normal's lookahead). Elsewhere: the rules, with slips.
        // (only at a table set to Easy: games built without the setting, as in tests, play the rules straight)
        if ((g.lowWins || g.trickBids) && s.options.botLevel === 0) {
          const slip = easyMove(s.options, search.candidates(s, seat), null, EASY_LOOK_SLIPS);
          return slip ?? searchMove(search, s, seat, EASY_LOOK, quickBot(g, s, seat)) ?? quickBot(g, s, seat);
        }
        return easyMove(s.options, search.candidates(s, seat), quickBot(g, s, seat), g.pitchBids ? EASY_PITCH_SLIPS : undefined);
      }
      return botLevel(s.options) === 2 ? hardQuick(g, s, seat) : quickBot(g, s, seat);
    },

    redactData(s, viewer) {
      const d = s.data;
      return {
        ...d,
        passes: d.passes.map((p, i) => (p && i !== viewer ? [] : p)),
        // the called card's holder stays secret until it's played (they know, of course)
        partner: d.partnerShown || viewer === d.partner ? d.partner : null,
        received: ownOnly(d.received, viewer),
        // who holds honours is told when the hand is scored, not before
        honours: s.phase === 'roundOver' || s.phase === 'gameOver' ? d.honours : null,
        // duplicate: the boards are nobody's to see (each hand is dealt from them)
        boards: undefined,
        // practice: the coach's notes say what a hand holds; each is for its player alone
        ...(d.practice ? { practice: { ...d.practice, notes: d.practice.notes.map((x, i) => (i === viewer ? x : null)) } } : {}),
        // Pitch: which cards are High, Low and Jack would say who holds what (or that a card
        // wasn't dealt), and so would who has them so far: only once the hand is scored
        ...(d.pitch && s.phase !== 'roundOver' && s.phase !== 'gameOver'
          ? { pitch: { ...d.pitch, high: null, low: null, jack: null, highBy: null, lowTo: null, jackTo: null } }
          : {}),
      };
    },

    sides: (n) => teamsFor(g, n),

    standings(s) {
      // (duplicate compared with other tables: on IMPs)
      const totals = s.data.compared ? impTotals(s) : s.data.scores;
      return placesFromScores(
        s.players.map((_, i) => totals[teamOf(g, s, i)]),
        g.lowWins,
      );
    },

    report(s) {
      return { hand: s.data.round + 1, ...(s.data.results ? { boards: structuredClone(s.data.results) } : {}) };
    },

    compareWith(options) {
      if (!g.bridgeBids || Number(options.style ?? 0) !== 2) return null;
      return (['table', 'par'] as const)[Number(options.compare ?? 0)] ?? null;
    },

    boards: (s) => s.data.boards ?? null,

    // (duplicate scoring; compared, in a tournament, with the other tables, not with anyone in the
    // room; the tournament deals the boards, so how many deals is its to say)
    ...(g.bridgeBids ? { duplicate: { style: 2, compare: 2, deals: 4 } } : {}),

    nightScore(s) {
      if (!s.data.compared) return null;
      const totals = impTotals(s);
      return { unit: 'IMPs', scores: s.players.map((_, i) => totals[teamOf(g, s, i)]) };
    },

    compare(s, others) {
      const d = s.data;
      if (!d.results || !d.others) return;
      for (const o of others) if (d.results.some((r) => r.n === o.n) && !d.others.some((x) => x.n === o.n && x.at === o.at)) d.others.push(structuredClone(o));
      // (the last result in: the game is decided)
      if (d.compared && s.phase === 'roundOver' && d.results.length >= (d.boards?.length ?? 0) && !waitingForOthers(s)) finishDuplicate(g, s);
    },

    status(s, viewer) {
      const status = trickStatus(g, s, viewer);
      const p = s.data.practice;
      if (!p || viewer < 0 || s.players[viewer]?.bot) return status;
      const t = p.tally[viewer];
      return {
        ...status,
        ...(p.notes[viewer] ? { coach: p.notes[viewer]! } : {}),
        ...(t?.graded && !status.hint ? { hint: `Practice: ${t.book} of ${t.graded} by the book` } : {}),
      };
    },
  };
  // (the search bot plays imagined deals out with this module's own rules)
  const search = trickSearch(g, module);
  // (Hard: its own rules of thumb, for its moves and everyone's in its imagined playouts)
  const hardSearch = trickSearch(g, module, (x, seat) => hardQuick(g, x, seat));
  // (the bids a seat may make: any number of tricks, but the dealer's that would make the bids add
  // up to the tricks there are, with the hook)
  const bidSearch: typeof hardSearch = {
    ...hardSearch,
    candidates(s, seat) {
      const others = s.data.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
      const hooked = (b: number) => !!g.trickBids?.hook && seat === s.dealer && others + b === s.data.handSize;
      return Array.from({ length: s.data.handSize + 1 }, (_, b) => b)
        .filter((b) => !hooked(b))
        .map((b) => ({ type: 'bid', amount: b }));
    },
  };
  return module;
}
