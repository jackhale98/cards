import { createState, nextSeat, placesFromScores } from '../../state';
import { ownOnly } from '../../redact';
import { botBudget, easyMove, searchMove } from '../../bots/search';
import { assertRule, type GameConfig, type GameModule } from '../../types';
import { trickActions } from './actions';
import { applyBid, applyBid500, applyBury, applyCall, applyDecline, applyDouble, applyName, applyOrder } from './bidding';
import { quickBot, trickSearch } from './bots';
import { applyCallPartner, applyDefend, applyNominate, callable, startRound } from './deal';
import { applyBlind, applyBlindGive, applyPass } from './exchange';
import { collectTrick, leadJoker, playCard } from './play';
import { endRound } from './scoring';
import { controller, teamOf, teamsFor } from './sides';
import { trickStatus } from './status';
import { trickGame, type TrickData } from './types';

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

export function trickTakingFamily(config: GameConfig): GameModule<TrickData> {
  const g = trickGame(config);

  const module: GameModule<TrickData> = {
    config,
    botLevels: true,

    setup(players, seed, options) {
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
      startRound(g, s);
      return s;
    },

    actions: (s, seat) => trickActions(g, s, seat),

    apply(s, seat, a) {
      const d = s.data;
      switch (a.type) {
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
        case 'decline':
          return applyDecline(g, s, seat);
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
      // five-handed 500: call the best card not held (the top trump, or an ace in no trumps)
      if (s.phase === 'callPartner' && s.turn === seat) {
        const best = callable(g, s)[0];
        return best ? { type: 'callCard', amount: g.deckCards.indexOf(best) } : { type: 'callAlone' };
      }
      // card play is searched unless the bots are set to Easy; the other decisions use the quick rules
      const budget = botBudget(s.options);
      if (s.phase === 'play' && controller(s) === seat)
        return budget
          ? (searchMove(search, s, seat, budget, quickBot(g, s, seat)) ?? quickBot(g, s, seat))
          : easyMove(s.options, search.candidates(s, seat), quickBot(g, s, seat));
      return quickBot(g, s, seat);
    },

    redactData(s, viewer) {
      const d = s.data;
      return {
        ...d,
        passes: d.passes.map((p, i) => (p && i !== viewer ? [] : p)),
        // the called card's holder stays secret until it's played (they know, of course)
        partner: d.partnerShown || viewer === d.partner ? d.partner : null,
        received: ownOnly(d.received, viewer),
      };
    },

    standings(s) {
      return placesFromScores(
        s.players.map((_, i) => s.data.scores[teamOf(g, s, i)]),
        g.lowWins,
      );
    },

    status: (s, viewer) => trickStatus(g, s, viewer),
  };
  // (the search bot plays imagined deals out with this module's own rules)
  const search = trickSearch(g, module);
  return module;
}
