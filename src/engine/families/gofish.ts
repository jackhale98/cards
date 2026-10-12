import { parseCard, RANK_WORDS, rankPlural } from '../cards';
import { createState, deal, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, sortHand, zone } from '../state';
import { botLevel } from '../bots/search';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Go Fish (pagat.com/quartet/gofish.html). Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "gofish" }
 * ```
 * Five cards each (seven with two players), the rest a face-down stock. On your turn ask another
 * player for a rank you already hold. If they have any they must hand them all over and you ask
 * again; if not, "Go fish!": draw from the stock, and if it's the rank you asked for, show it and
 * ask again — otherwise the turn passes left. Four of a kind (a book) goes down at once. Play ends
 * when someone runs out of cards or the stock runs out; most books wins. With the `allBooks` option,
 * play goes on until every book is made: a player with no cards draws five, and once the stock is
 * empty a wrong guess just passes the turn.
 */
export interface GoFishData {
  books: number[];
  /** Ranks each seat is known to hold (they asked for them and still had them). Public. */
  known: number[][];
  /** Ranks each seat is known not to hold (they said "Go fish!", and haven't drawn since). Public. */
  lacks?: number[][];
  /** The last ask, for the headline. */
  last: { asker: number; target: number; rank: number; got: number; fished?: 'lucky' | 'miss' | 'empty' } | null;
  result: { lines: string[] } | null;
}

type S = GameState<GoFishData>;

const rankOf = (id: string) => parseCard(id).rank;

export function goFishFamily(config: GameConfig): GameModule<GoFishData> {
  const allBooks = (s: S) => !!s.options.allBooks;
  const handSize = (s: S) => (s.players.length === 2 ? 7 : 5);
  const holding = (s: S, seat: number) => ids(hand(s, seat));
  const ranksIn = (s: S, seat: number) => [...new Set(holding(s, seat).map(rankOf))];

  function start(s: S) {
    const d = s.data;
    resetDeck(s, config);
    deal(s, [{ to: 'hand', count: handSize(s) }]);
    s.players.forEach((_, i) => sortHand(s, i));
    d.books = s.players.map(() => 0);
    d.known = s.players.map(() => []);
    d.lacks = s.players.map(() => []);
    d.last = null;
    d.result = null;
    s.phase = 'play';
    s.turn = nextSeat(s, s.dealer);
    s.players.forEach((_, i) => layBooks(s, i));
    log(s, `${name(s, s.dealer)} deals ${handSize(s)} each`);
    if (!checkEnd(s)) s.turn = firstWithCards(s, s.turn);
  }

  /** Any four of a kind goes down at once. */
  function layBooks(s: S, seat: number) {
    const d = s.data;
    for (const r of ranksIn(s, seat)) {
      const four = holding(s, seat).filter((c) => rankOf(c) === r);
      if (four.length === 4) {
        moveCards(s, `hand:${seat}`, `books:${seat}`, four, { up: true, group: d.books[seat] });
        d.books[seat]++;
        d.known[seat] = d.known[seat].filter((x) => x !== r);
        log(s, `${name(s, seat)} completes a book of ${rankPlural(r)}!`, seat, `Book of ${rankPlural(r)}`);
      }
    }
  }

  /** In the long game, an empty hand draws five from the stock. */
  function refill(s: S, seat: number) {
    if (!allBooks(s) || hand(s, seat).cards.length) return;
    const n = Math.min(5, zone(s, 'deck').cards.length);
    if (!n) return;
    moveTop(s, 'deck', `hand:${seat}`, n);
    if (s.data.lacks) s.data.lacks[seat] = [];
    sortHand(s, seat);
    log(s, `${name(s, seat)} draws ${n} new cards`, seat, `+${n}`);
    layBooks(s, seat);
  }

  const firstWithCards = (s: S, from: number) =>
    hand(s, from).cards.length ? from : nextSeat(s, from, (x) => !hand(s, x).cards.length);

  /** Pagat: the game ends when someone runs out of cards or the stock does (or, long game: every book is down). */
  function checkEnd(s: S): boolean {
    const d = s.data;
    const done = allBooks(s)
      ? s.players.every((p) => !hand(s, p.seat).cards.length)
      : s.players.some((p) => !hand(s, p.seat).cards.length) || !zone(s, 'deck').cards.length;
    if (!done) return false;
    const best = Math.max(...d.books);
    s.winner = s.players.map((p) => p.seat).filter((i) => d.books[i] === best);
    s.phase = 'gameOver';
    s.turn = null;
    d.result = { lines: s.players.map((p) => `${p.name}: ${d.books[p.seat]} book${d.books[p.seat] === 1 ? '' : 's'}`) };
    log(s, `Game over — ${s.winner.map((w) => name(s, w)).join(' & ')} ${s.winner.length > 1 ? 'tie' : 'wins'} with ${best} books`);
    return true;
  }

  /** The turn passes left (to someone with cards). */
  function passTurn(s: S, from: number) {
    s.turn = nextSeat(s, from, (x) => !hand(s, x).cards.length);
  }

  // ---- bots ------------------------------------------------------------------------------

  /**
   * Bot strength is memory. Easy remembers nothing: a random rank of its own from a random player.
   * Normal remembers who has asked for what. Hard also remembers who said "Go fish!" to what.
   */
  function botAsk(s: S, seat: number): Action {
    const d = s.data;
    const level = botLevel(s.options);
    const mine = ranksIn(s, seat);
    const others = s.players.map((p) => p.seat).filter((i) => i !== seat && hand(s, i).cards.length);
    const ask = (r: number, target: number): Action => ({ type: 'ask', cards: [holding(s, seat).find((c) => rankOf(c) === r)!], seat: target });
    const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    if (level === 0) return ask(pick(mine), pick(others));
    // someone known to hold a rank we have
    for (const i of others) {
      const r = d.known[i].find((x) => mine.includes(x));
      if (r) return ask(r, i);
    }
    // otherwise our biggest group, from whoever holds the most cards (Hard: and hasn't just denied it)
    const count = (r: number) => holding(s, seat).filter((c) => rankOf(c) === r).length;
    const bySize = (xs: number[]) => [...xs].sort((a, b) => hand(s, b).cards.length - hand(s, a).cards.length);
    for (const r of [...mine].sort((a, b) => count(b) - count(a))) {
      const target = bySize(others.filter((i) => level < 2 || !d.lacks?.[i]?.includes(r)))[0];
      if (target != null) return ask(r, target);
    }
    return ask(mine[0], bySize(others)[0]);
  }

  return {
    config,
    botLevels: true,

    setup(players, seed, options) {
      const s = createState<GoFishData>(config, players, seed, options, { books: [], known: [], last: null, result: null });
      s.dealer = players.length - 1;
      start(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase !== 'play' || s.turn !== seat) return [];
      const others = s.players.map((p) => p.seat).filter((i) => i !== seat && hand(s, i).cards.length);
      const out: ActionSpec[] = [
        { type: 'ask', label: 'Ask for this rank…', style: 'primary', select: { min: 1, max: 1, cards: holding(s, seat) }, target: { seats: others, label: 'Ask who?' } },
      ];
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      if (a.type === 'rematch') {
        assertRule(s.phase === 'gameOver', 'Game not over');
        s.winner = undefined;
        s.dealer = nextSeat(s, s.dealer);
        return start(s);
      }
      assertRule(s.phase === 'play' && s.turn === seat, 'Not your turn');
      assertRule(a.type === 'ask', `Unknown action ${a.type}`);
      const card = a.cards?.[0];
      const target = a.seat ?? -1;
      assertRule(card && holding(s, seat).includes(card), 'Pick a card of the rank you want');
      assertRule(target >= 0 && target !== seat && target < s.players.length && hand(s, target).cards.length > 0, 'Ask another player who still has cards');
      const rank = rankOf(card);
      const theirs = holding(s, target).filter((c) => rankOf(c) === rank);
      d.known[target] = d.known[target].filter((x) => x !== rank);
      const lacks = (d.lacks ??= s.players.map(() => []));
      // the asker holds the rank; the target, once they've handed theirs over or said "Go fish!", doesn't
      lacks[seat] = lacks[seat].filter((x) => x !== rank);
      if (!lacks[target].includes(rank)) lacks[target] = [...lacks[target], rank];
      if (theirs.length) {
        moveCards(s, `hand:${target}`, `hand:${seat}`, theirs);
        sortHand(s, seat);
        d.last = { asker: seat, target, rank, got: theirs.length };
        log(s, `${name(s, seat)} asks ${name(s, target)} for ${rankPlural(rank)} — gets ${theirs.length}`, seat, `+${theirs.length} ${theirs.length === 1 ? RANK_WORDS[rank] : rankPlural(rank)}`, target);
        // the asker now surely has that rank (unless it makes a book)
        if (!d.known[seat].includes(rank)) d.known[seat].push(rank);
        layBooks(s, seat);
        refill(s, seat);
        refill(s, target);
        if (checkEnd(s)) return;
        if (!hand(s, seat).cards.length) passTurn(s, seat);
        return; // ask again
      }
      log(s, `${name(s, seat)} asks ${name(s, target)} for ${rankPlural(rank)} — “Go fish!”`, target, 'Go fish!', seat);
      if (!d.known[seat].includes(rank)) d.known[seat].push(rank);
      if (!zone(s, 'deck').cards.length) {
        // (long game, empty stock) nothing to fish: the turn passes
        d.last = { asker: seat, target, rank, got: 0, fished: 'empty' };
        passTurn(s, seat);
        return void checkEnd(s);
      }
      moveTop(s, 'deck', `hand:${seat}`, 1);
      const drawn = hand(s, seat).cards.at(-1)!.id;
      lacks[seat] = []; // a fresh card could be anything
      sortHand(s, seat);
      const lucky = rankOf(drawn) === rank;
      d.last = { asker: seat, target, rank, got: 0, fished: lucky ? 'lucky' : 'miss' };
      if (lucky) log(s, `${name(s, seat)} fishes the ${RANK_WORDS[rank]} they wanted and goes again!`, seat, 'Lucky fish!');
      layBooks(s, seat);
      refill(s, seat);
      if (checkEnd(s)) return;
      if (!lucky || !hand(s, seat).cards.length) passTurn(s, seat);
    },

    bot(s, seat) {
      if (s.phase !== 'play' || s.turn !== seat) return null;
      return botAsk(s, seat);
    },

    standings(s) {
      return placesFromScores(s.data.books);
    },

    status(s, viewer) {
      const d = s.data;
      let headline = '';
      if (s.phase === 'play') {
        const l = d.last;
        const lastText = l
          ? l.got
            ? `${name(s, l.asker)} got ${l.got} ${l.got === 1 ? RANK_WORDS[l.rank] : rankPlural(l.rank)} from ${name(s, l.target)}`
            : `${name(s, l.target)}: “Go fish!”${l.fished === 'lucky' ? ' — and the fish was lucky' : ''}`
          : '';
        const turnText = s.turn === viewer ? 'Your turn: pick a card, then who to ask' : `${name(s, s.turn!)} is asking`;
        headline = [lastText, turnText].filter(Boolean).join(' · ');
      } else headline = d.result?.lines.join(' · ') ?? '';
      return {
        headline,
        seats: s.players.map((_, i) => ({ badge: `${hand(s, i).cards.length} cards · ${d.books[i]} book${d.books[i] === 1 ? '' : 's'}`, tag: i === s.dealer ? 'D' : undefined })),
        scoreboard: { columns: ['Books'], rows: s.players.map((p) => ({ name: p.name, values: [d.books[p.seat]], highlight: s.winner?.includes(p.seat) })) },
        banner:
          s.phase === 'gameOver'
            ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`, lines: d.result?.lines ?? [] }
            : undefined,
      };
    },
  };
}
