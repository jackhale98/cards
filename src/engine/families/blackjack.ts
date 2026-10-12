import { buildDeck, parseCard, rankLabel, SUIT_SYMBOL } from '../cards';
import { shuffle } from '../rng';
import { createState, hand, ids, log, moveCards, moveTop, name, placesFromScores, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Blackjack against the house (pagat.com/banking/blackjack.html). Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "blackjack", "minBet": 10, "maxBet": 500 }
 * ```
 * Everyone bets, then gets two cards face up; the dealer (the host's phone, playing the house) gets
 * one up and a hole card. With an ace showing, players may insure for half their bet. The dealer
 * peeks under an ace or ten for blackjack. Players then hit, stand, double down (two cards only),
 * split pairs (up to four hands; split aces get one card each) or, as an option, surrender. The
 * dealer draws to 17 (standing on soft 17 unless the option says otherwise). Wins pay 1:1, a
 * blackjack 3:2, insurance 2:1; ties push. Play a set number of rounds: most chips wins.
 */
export interface BlackjackRules {
  family: 'blackjack';
  minBet: number;
  maxBet: number;
}

export interface BjHand {
  cards: string[];
  bet: number;
  done: boolean;
  doubled?: boolean;
  /** Made by splitting aces: one card only, and 21 isn't a blackjack. */
  splitAces?: boolean;
  split?: boolean;
  /** win / lose / push / blackjack / bust / surrender, once settled. */
  result?: string;
}

export interface BlackjackData {
  round: number;
  /** Each seat's bet for the round being placed (null = not yet). */
  bets: (number | null)[];
  hands: BjHand[][];
  /** The hand being played by `s.turn`. */
  active: number;
  insurance: (number | null)[];
  /** Chips each player had at the start of the round (for the summary). */
  before: number[];
  result: { lines: string[] } | null;
}

type S = GameState<BlackjackData>;

/** Best total of a hand (aces 11 unless that busts) and whether an ace still counts 11. */
export function handTotal(cards: string[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = parseCard(c).rank;
    if (r === 14) {
      aces++;
      total += 11;
    } else total += Math.min(r, 10);
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}
const value = (id: string) => Math.min(parseCard(id).rank === 14 ? 11 : parseCard(id).rank, 10);
const isBlackjack = (h: BjHand): boolean => h.cards.length === 2 && !h.split && handTotal(h.cards).total === 21;
const label = (id: string) => `${rankLabel(parseCard(id).rank)}${SUIT_SYMBOL[parseCard(id).suit]}`;

export function blackjackFamily(config: GameConfig): GameModule<BlackjackData> {
  const R = config.rules as unknown as BlackjackRules;
  const decks = (s: S) => Number(s.options.decks ?? 2);
  const rounds = (s: S) => Number(s.options.rounds ?? 10);
  const minBet = (s: S) => Number(s.options.minBet ?? R.minBet);
  const maxBet = (_s: S) => R.maxBet;
  const dealerCards = (s: S) => ids(zone(s, 'dealer'));
  const inRound = (s: S, seat: number) => (s.data.hands[seat]?.length ?? 0) > 0;

  /** Lay a seat's hands out in its zone: split hands side by side. */
  function relayout(s: S, seat: number) {
    const z = hand(s, seat);
    const all = new Map(z.cards.map((c) => [c.id, c]));
    z.cards = s.data.hands[seat].flatMap((h, gi) => h.cards.map((id) => ({ ...all.get(id)!, id, up: true, group: gi })));
  }

  /** Draw from the shoe; reshuffle the discards in when it runs low. */
  function draw(s: S, to: string, up = true) {
    if (!zone(s, 'deck').cards.length) {
      zone(s, 'deck').cards = shuffle(ids(zone(s, 'discard')), s).map((id) => ({ id }));
      zone(s, 'discard').cards = [];
      log(s, 'The shoe is reshuffled');
    }
    moveTop(s, 'deck', to, 1, { up });
    return zone(s, to).cards.at(-1)!.id;
  }

  function startRound(s: S) {
    const d = s.data;
    // everything from the last round goes to the discards; shuffle a fresh shoe when it's a quarter gone
    for (const z of Object.values(s.zones)) if (z.id !== 'deck' && z.id !== 'discard') moveCards(s, z.id, 'discard', ids(z));
    const shoe = 52 * decks(s);
    if (zone(s, 'deck').cards.length < shoe / 4) {
      zone(s, 'deck').cards = shuffle([...ids(zone(s, 'deck')), ...ids(zone(s, 'discard'))], s).map((id) => ({ id }));
      zone(s, 'discard').cards = [];
      if (d.round > 0) log(s, 'A fresh shoe is shuffled');
    }
    d.round++;
    d.bets = s.players.map((p) => (p.chips >= minBet(s) ? null : 0));
    d.hands = s.players.map(() => []);
    d.insurance = s.players.map(() => null);
    d.active = 0;
    d.before = s.players.map((p) => p.chips);
    d.result = null;
    s.phase = 'bet';
    s.turn = null;
    zone(s, 'dealer').label = 'Dealer';
  }

  function deal(s: S) {
    const d = s.data;
    const players = s.players.map((p) => p.seat).filter((i) => d.bets[i]! > 0);
    for (const i of players) {
      s.players[i].chips -= d.bets[i]!;
      d.hands[i] = [{ cards: [], bet: d.bets[i]!, done: false }];
    }
    for (const round of [0, 1]) {
      for (const i of players) d.hands[i][0].cards.push(draw(s, `hand:${i}`));
      draw(s, 'dealer', round === 0); // the second dealer card is the hole card
    }
    players.forEach((i) => relayout(s, i));
    dealerLabel(s);
    log(s, `Round ${d.round}: the dealer shows ${label(dealerCards(s)[0])}`);
    if (parseCard(dealerCards(s)[0]).rank === 14) {
      // an ace up: insurance
      s.phase = 'insurance';
      for (const i of players) if (s.players[i].chips < Math.floor(d.bets[i]! / 2)) d.insurance[i] = 0;
      if (players.every((i) => d.insurance[i] != null)) return peek(s);
      return;
    }
    peek(s);
  }

  /** The dealer checks under an ace or ten for blackjack. */
  function peek(s: S) {
    const d = s.data;
    const up = value(dealerCards(s)[0]);
    const dealerBJ = (up === 11 || up === 10) && handTotal(dealerCards(s)).total === 21;
    const players = s.players.map((p) => p.seat).filter((i) => inRound(s, i));
    if (dealerBJ) {
      for (const c of zone(s, 'dealer').cards) c.up = true;
      dealerLabel(s);
      log(s, 'The dealer has blackjack!');
      for (const i of players) {
        if (d.insurance[i]) s.players[i].chips += d.insurance[i]! * 3;
        const h = d.hands[i][0];
        h.done = true;
        if (isBlackjack(h)) {
          s.players[i].chips += h.bet;
          h.result = 'push';
        } else h.result = 'lose';
      }
      return endRound(s);
    }
    if (d.insurance.some((x) => x)) log(s, 'No dealer blackjack — insurance is lost');
    // player blackjacks are paid at once
    for (const i of players) {
      const h = d.hands[i][0];
      if (isBlackjack(h)) {
        s.players[i].chips += h.bet + Math.floor((h.bet * 3) / 2);
        h.done = true;
        h.result = 'blackjack';
        log(s, `${name(s, i)} has blackjack!`, i, 'Blackjack!');
      }
    }
    s.phase = 'play';
    nextHand(s, 0);
  }

  /** Turn to the next hand still to play, from seat `from` on (the dealer's left first); then the dealer plays. */
  function nextHand(s: S, from: number) {
    const d = s.data;
    for (let seat = from; seat < s.players.length; seat++) {
      const k = d.hands[seat].findIndex((h) => !h.done);
      if (k >= 0) {
        s.turn = seat;
        d.active = k;
        return;
      }
    }
    s.turn = null;
    s.phase = 'dealer';
    for (const c of zone(s, 'dealer').cards) c.up = true;
    dealerLabel(s);
  }

  function dealerLabel(s: S) {
    const z = zone(s, 'dealer');
    const shown = z.cards.filter((c) => c.up).map((c) => c.id);
    const t = handTotal(shown).total;
    z.label = shown.length ? `Dealer · ${t > 21 ? 'bust' : t}` : 'Dealer';
  }

  /** A hand gets a card; 21 stands automatically, over 21 is bust. */
  function hit(s: S, seat: number, h: BjHand) {
    const card = draw(s, `hand:${seat}`);
    h.cards.push(card);
    relayout(s, seat);
    const t = handTotal(h.cards).total;
    if (t > 21) {
      h.done = true;
      h.result = 'bust';
      log(s, `${name(s, seat)} draws ${label(card)} and busts with ${t}`, seat, `Bust ${t}`);
    } else if (t === 21 || h.splitAces || h.doubled) h.done = true;
  }

  /** The dealer's turn: draw to 17 (and on soft 17 with the `hitSoft17` option). */
  function dealerStep(s: S) {
    const live = s.data.hands.flat().some((h) => !h.result);
    const { total, soft } = handTotal(dealerCards(s));
    const hits = total < 17 || (total === 17 && soft && !!s.options.hitSoft17);
    if (live && hits) {
      const card = draw(s, 'dealer');
      dealerLabel(s);
      log(s, `The dealer draws ${label(card)} — ${handTotal(dealerCards(s)).total}`);
      return;
    }
    settle(s);
  }

  function settle(s: S) {
    const d = s.data;
    const dealer = handTotal(dealerCards(s)).total;
    log(s, dealer > 21 ? `The dealer busts with ${dealer}` : `The dealer stands on ${dealer}`);
    s.players.forEach((p, i) => {
      for (const h of d.hands[i]) {
        if (h.result) continue;
        const t = handTotal(h.cards).total;
        if (dealer > 21 || t > dealer) {
          p.chips += h.bet * 2;
          h.result = 'win';
        } else if (t === dealer) {
          p.chips += h.bet;
          h.result = 'push';
        } else h.result = 'lose';
      }
    });
    endRound(s);
  }

  function endRound(s: S) {
    const d = s.data;
    s.turn = null;
    const lines = s.players
      .filter((p) => inRound(s, p.seat))
      .map((p) => {
        const delta = p.chips - d.before[p.seat];
        const what = d.hands[p.seat].map((h) => h.result).join(', ');
        return `${p.name}: ${what} ${delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '±0'} → ${p.chips}`;
      });
    // what the dealer finished with leads the summary (the banner covers the dealer's cards on a TV)
    const dealer = handTotal(dealerCards(s)).total;
    const dealerLine =
      dealer > 21 ? `The dealer busts with ${dealer}` : dealer === 21 && dealerCards(s).length === 2 ? 'The dealer has blackjack' : `The dealer has ${dealer}`;
    lines.unshift(dealerLine);
    const broke = s.players.every((p) => p.chips < minBet(s));
    if (d.round >= rounds(s) || broke) {
      const best = Math.max(...s.players.map((p) => p.chips));
      s.winner = s.players.filter((p) => p.chips === best).map((p) => p.seat);
      s.phase = 'gameOver';
      lines.push(broke ? 'The house has everyone’s chips!' : `After ${d.round} rounds, most chips wins`);
    } else s.phase = 'roundOver';
    d.result = { lines };
  }

  // ---- what may be done ------------------------------------------------------------------

  const current = (s: S) => (s.turn != null ? s.data.hands[s.turn][s.data.active] : null);
  const canDouble = (s: S, seat: number, h: BjHand) => h.cards.length === 2 && !h.splitAces && s.players[seat].chips >= h.bet;
  const canSplit = (s: S, seat: number, h: BjHand) =>
    h.cards.length === 2 && value(h.cards[0]) === value(h.cards[1]) && s.data.hands[seat].length < 4 && s.players[seat].chips >= h.bet && !h.splitAces;
  const canSurrender = (s: S, seat: number, h: BjHand) => !!s.options.surrender && h.cards.length === 2 && s.data.hands[seat].length === 1 && !h.split;

  // ---- bots: basic strategy, simplified ---------------------------------------------------------

  function botPlay(s: S, seat: number): Action {
    const h = current(s)!;
    const up = value(dealerCards(s)[0]);
    const { total, soft } = handTotal(h.cards);
    if (canSplit(s, seat, h)) {
      const v = value(h.cards[0]);
      if (v === 11 || v === 8 || (v === 9 && ![7, 10, 11].includes(up)) || ([2, 3, 6, 7].includes(v) && up <= 7)) return { type: 'split' };
    }
    if (canDouble(s, seat, h) && !soft && (total === 11 || (total === 10 && up <= 9) || (total === 9 && up >= 3 && up <= 6))) return { type: 'double' };
    if (soft) return { type: total >= 19 || (total === 18 && up <= 8) ? 'stand' : 'hit' };
    if (total >= 17) return { type: 'stand' };
    if (total >= 13 && up <= 6) return { type: 'stand' };
    if (total === 12 && up >= 4 && up <= 6) return { type: 'stand' };
    if (canSurrender(s, seat, h) && total === 16 && up >= 9) return { type: 'surrender' };
    return { type: 'hit' };
  }

  return {
    config,

    setup(players, seed, options) {
      const s = createState<BlackjackData>(config, players, seed, options, {
        round: 0,
        bets: [],
        hands: [],
        active: 0,
        insurance: [],
        before: [],
        result: null,
      });
      s.zones.deck.cards = shuffle(buildDeck({ ...config.deck, decks: decks(s) }), s).map((id) => ({ id }));
      const stack = Number(options.stack ?? config.chips?.start ?? 1000);
      s.players.forEach((p) => (p.chips = stack));
      s.dealer = 0; // (the house deals; no dealer seat)
      startRound(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'roundOver') return [{ type: 'next', label: 'Next round', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase === 'bet' && d.bets[seat] === null) {
        const max = Math.min(maxBet(s), s.players[seat].chips);
        return [{ type: 'bet', label: 'Bet', style: 'primary', amount: { min: minBet(s), max, step: minBet(s), default: minBet(s), label: 'chips' } }];
      }
      if (s.phase === 'insurance' && d.insurance[seat] === null && inRound(s, seat)) {
        return [
          { type: 'insure', label: `Insure · ${Math.floor(d.bets[seat]! / 2)}` },
          { type: 'noInsurance', label: 'No insurance', style: 'primary' },
        ];
      }
      if (s.phase !== 'play' || s.turn !== seat) return [];
      const h = current(s)!;
      const out: ActionSpec[] = [
        { type: 'hit', label: 'Hit', style: 'primary', zone: 'deck' },
        { type: 'stand', label: 'Stand' },
      ];
      if (canDouble(s, seat, h)) out.push({ type: 'double', label: `Double · ${h.bet}` });
      if (canSplit(s, seat, h)) out.push({ type: 'split', label: 'Split' });
      if (canSurrender(s, seat, h)) out.push({ type: 'surrender', label: 'Surrender', style: 'quiet' });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'roundOver', 'Round in progress');
          return startRound(s);
        case 'rematch': {
          assertRule(s.phase === 'gameOver', 'Game not over');
          const stack = Number(s.options.stack ?? config.chips?.start ?? 1000);
          s.players.forEach((p) => (p.chips = stack));
          s.winner = undefined;
          d.round = 0;
          return startRound(s);
        }
        case 'bet': {
          assertRule(s.phase === 'bet' && d.bets[seat] === null, 'Not betting now');
          const amount = Math.floor(a.amount ?? 0);
          assertRule(amount >= minBet(s) && amount <= Math.min(maxBet(s), s.players[seat].chips), `Bet ${minBet(s)} to ${Math.min(maxBet(s), s.players[seat].chips)}`);
          d.bets[seat] = amount;
          log(s, `${who} bets ${amount}`, seat, `Bet ${amount}`);
          if (d.bets.every((b) => b !== null)) {
            if (d.bets.every((b) => !b)) return endRound(s);
            deal(s);
          }
          return;
        }
        case 'insure':
        case 'noInsurance': {
          assertRule(s.phase === 'insurance' && d.insurance[seat] === null && inRound(s, seat), 'Not now');
          const cost = a.type === 'insure' ? Math.floor(d.bets[seat]! / 2) : 0;
          assertRule(s.players[seat].chips >= cost, 'Not enough chips');
          s.players[seat].chips -= cost;
          d.insurance[seat] = cost;
          if (cost) log(s, `${who} takes insurance (${cost})`, seat, 'Insured');
          if (s.players.every((p) => !inRound(s, p.seat) || d.insurance[p.seat] !== null)) peek(s);
          return;
        }
      }
      assertRule(s.phase === 'play' && s.turn === seat, 'Not your turn');
      const h = current(s)!;
      switch (a.type) {
        case 'hit':
          hit(s, seat, h);
          if (!h.done) log(s, `${who} hits: ${handTotal(h.cards).total}`, seat, `Hit ${handTotal(h.cards).total}`);
          break;
        case 'stand':
          h.done = true;
          log(s, `${who} stands on ${handTotal(h.cards).total}`, seat, `Stand ${handTotal(h.cards).total}`);
          break;
        case 'double':
          assertRule(canDouble(s, seat, h), 'You can only double on your first two cards');
          s.players[seat].chips -= h.bet;
          h.bet *= 2;
          h.doubled = true;
          hit(s, seat, h);
          h.done = true;
          log(s, `${who} doubles down: ${handTotal(h.cards).total}`, seat, `Double ${handTotal(h.cards).total}`);
          break;
        case 'split': {
          assertRule(canSplit(s, seat, h), 'You can only split a pair');
          s.players[seat].chips -= h.bet;
          const aces = parseCard(h.cards[0]).rank === 14;
          const second: BjHand = { cards: [h.cards.pop()!], bet: h.bet, done: false, split: true, splitAces: aces };
          h.split = true;
          h.splitAces = aces;
          d.hands[seat].splice(d.active + 1, 0, second);
          log(s, `${who} splits ${aces ? 'aces' : 'the pair'}`, seat, 'Split');
          // each hand gets its second card
          hit(s, seat, h);
          hit(s, seat, second);
          break;
        }
        case 'surrender':
          assertRule(canSurrender(s, seat, h), 'Surrender only as your first move');
          s.players[seat].chips += Math.floor(h.bet / 2);
          h.done = true;
          h.result = 'surrender';
          log(s, `${who} surrenders, taking back ${Math.floor(h.bet / 2)}`, seat, 'Surrender');
          break;
        default:
          assertRule(false, `Unknown action ${a.type}`);
      }
      // this seat's next unfinished hand (after a split), or on to the next player
      if (d.hands[seat].every((x) => x.done)) nextHand(s, seat + 1);
      else d.active = d.hands[seat].findIndex((x) => !x.done);
    },

    system(s) {
      if (s.phase !== 'dealer') return null;
      return { delay: 900, run: dealerStep };
    },

    bot(s, seat) {
      const d = s.data;
      if (s.phase === 'bet' && d.bets[seat] === null) {
        const chips = s.players[seat].chips;
        const units = Math.min(Math.floor(Math.min(maxBet(s), chips) / minBet(s)), 1 + Math.floor(Math.random() * 3));
        return { type: 'bet', amount: Math.max(1, units) * minBet(s) };
      }
      if (s.phase === 'insurance' && d.insurance[seat] === null && inRound(s, seat)) return { type: 'noInsurance' };
      if (s.phase === 'play' && s.turn === seat) return botPlay(s, seat);
      return null;
    },

    standings(s) {
      return placesFromScores(s.players.map((p) => p.chips));
    },

    status(s, viewer) {
      const d = s.data;
      const dealer = dealerCards(s);
      const upTotal = dealer.length ? (zone(s, 'dealer').cards.every((c) => c.up) ? handTotal(dealer).total : value(dealer[0])) : 0;
      let headline = '';
      if (s.phase === 'bet') headline = d.bets[viewer] === null ? `Round ${d.round} of ${rounds(s)} · place your bet` : 'Waiting for bets…';
      else if (s.phase === 'insurance') headline = d.insurance[viewer] === null && inRound(s, viewer) ? 'The dealer shows an ace — insurance?' : 'Waiting on insurance…';
      else if (s.phase === 'play') {
        const h = current(s)!;
        const many = s.turn != null && d.hands[s.turn].length > 1 ? ` (hand ${d.active + 1})` : '';
        headline = s.turn === viewer ? `Your ${handTotal(h.cards).total}${many} against the dealer’s ${upTotal}` : `${name(s, s.turn!)} to play${many}`;
      } else if (s.phase === 'dealer') headline = `Dealer has ${upTotal}`;
      else headline = d.result?.lines[0] ?? '';
      const badge = (i: number) => {
        if (s.phase === 'bet') return d.bets[i] === null ? 'Betting…' : d.bets[i] ? `Bet ${d.bets[i]}` : 'Out';
        if (!inRound(s, i)) return 'Out';
        return d.hands[i].map((h) => (h.result ? `${h.result} · ${h.bet}` : `${handTotal(h.cards).total} on ${h.bet}`)).join(' | ');
      };
      const mine = viewer >= 0 && inRound(s, viewer) ? d.hands[viewer].map((h) => `${handTotal(h.cards).soft && handTotal(h.cards).total < 21 ? 'soft ' : ''}${handTotal(h.cards).total}`).join(' · ') : undefined;
      return {
        headline,
        hint: mine,
        seats: s.players.map((p, i) => ({ badge: badge(i), out: p.chips < minBet(s) && !inRound(s, i) })),
        scoreboard: {
          columns: ['Chips'],
          rows: s.players.map((p) => ({ name: p.name, values: [p.chips], highlight: s.winner?.includes(p.seat) })),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`, lines: d.result?.lines ?? [] }
            : s.phase === 'roundOver'
              ? { title: `Round ${d.round}`, lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
}
