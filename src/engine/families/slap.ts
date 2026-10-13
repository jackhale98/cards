import { parseCard } from '../cards';
import { createState, deal, hand, log, name, nextSeat, placesFromScores, resetDeck, zone } from '../state';
import { rngSalt, shuffle } from '../rng';
import { botLevel } from '../bots/search';
import { msUntil, REACTION_WINDOW, span } from '../lib/realtime';
import { assertRule, type Action, type ActionSpec, type CardRef, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Slap games, played in real time: Slapjack and Egyptian Rat Screw (pagat.com/war/slapjack.html,
 * pagat.com/war/egyptian_ratscrew.html). Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "slap", "style": "slapjack" }   // or "ers"
 * ```
 * Every card is dealt face down, one pile each. In turn, players turn the top card of their pile
 * face up onto the middle. When the pile can be slapped (a jack in Slapjack; doubles, and whatever
 * other patterns the lobby turns on, in Egyptian Rat Screw), the quickest hand takes the whole pile
 * to the bottom of their own. Speed is measured on each player's own device, from when the card
 * appeared on their screen, so a slow connection doesn't cost anyone a slap: the host waits a
 * moment after the first slap and the quickest reaction wins.
 *
 * Slapjack: a wrong slap pays a card to whoever turned that card up. Run out of cards and you can
 * still slap the next jack to get back in; miss it and you're out.
 *
 * Egyptian Rat Screw: turn up a jack, queen, king or ace and the next player must turn up a court
 * card or ace within 1, 2, 3 or 4 cards; if they don't, the player who set the challenge takes the
 * pile (unless someone slaps it first). A wrong slap burns a card under the pile. Out of cards, you
 * may still slap your way back in.
 *
 * Either game is played until someone has every card, or (with the timer option) until time runs
 * out, when the most cards wins.
 */
export interface SlapData {
  /** Bumped whenever the top of the pile changes: what slaps are reacting to (`GameStatus.race`). */
  race: number;
  /** Good slaps on this race, waiting for the window to close: the quickest reaction wins. */
  slaps: { seat: number; rt: number }[];
  /** When the slap window closes (host clock, ms; 0 = as soon as the host gets to it). */
  judgeAt: number;
  /** Seats that slapped wrongly on this race (one penalty each; slap again once the pile changes). */
  missed: number[];
  /** Egyptian Rat Screw: a court card or ace was turned up by `by`; the player to answer has `left` tries. */
  challenge: { by: number; left: number } | null;
  /** About to take the pile (a lost challenge, or nobody has cards left), unless someone slaps first. */
  collect: number | null;
  /** Who turned up the top card. */
  last: number | null;
  /** Slapjack: knocked out (ran out of cards and missed the next jack). */
  out: boolean[];
  /** The latest slap, for the headline and a flash on everyone's screen. */
  flash: { seat: number; ok: boolean; text: string; race: number } | null;
  /** Timer option: when the game ends (host clock), set when the first card is turned up. */
  endsAt: number;
  result: { lines: string[] } | null;
}

type S = GameState<SlapData>;

/** The pause before a challenge winner takes the pile (time to slap it first). */
const COLLECT_DELAY = 1300;
const MINUTES = [0, 5, 10, 15];
/** Egyptian Rat Screw: tries to answer each court card or ace. */
const TRIES: Record<number, number> = { 11: 1, 12: 2, 13: 3, 14: 4 };
const RANK_WORD: Record<number, string> = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };

export function slapFamily(config: GameConfig): GameModule<SlapData> {
  const style = (config.rules as { style?: string }).style === 'ers' ? 'ers' : 'slapjack';
  const ers = style === 'ers';

  const count = (s: S, seat: number) => hand(s, seat).cards.length;
  const pile = (s: S) => zone(s, 'pile');
  /** Face-up cards in the pile, bottom first (burned cards lie face down underneath and don't count). */
  const shown = (s: S) => pile(s).cards.filter((c) => c.up !== false);
  const rank = (c: CardRef) => parseCard(c.id).rank;

  /** Why the pile can be slapped right now, or null. */
  function slappable(s: S): string | null {
    const up = shown(s);
    const top = up.at(-1);
    if (!top) return null;
    if (!ers) return rank(top) === 11 ? 'a jack' : null;
    const o = s.options;
    const t = rank(top);
    const below = up.at(-2);
    if (below && rank(below) === t) return 'doubles';
    if (o.sandwich && up.length >= 3 && rank(up.at(-3)!) === t) return 'a sandwich';
    if (o.topBottom && up.length >= 3 && rank(up[0]) === t) return 'top and bottom';
    if (below && o.marriage && [t, rank(below)].sort().join() === '12,13') return 'a marriage';
    if (below && o.tens) {
      const v = (r: number) => (r === 14 ? 1 : r <= 10 ? r : 99);
      if (v(t) + v(rank(below)) === 10) return 'tens';
    }
    return null;
  }

  const canSlap = (s: S, seat: number) =>
    s.phase === 'play' && !s.data.out[seat] && !s.data.missed.includes(seat) && !s.data.slaps.some((x) => x.seat === seat) && pile(s).cards.length > 0;
  const canFlip = (s: S, seat: number) => s.phase === 'play' && s.turn === seat && !s.data.slaps.length && s.data.collect === null && count(s, seat) > 0;

  /** The next seat (after `seat`) holding cards, or null if nobody does. */
  function nextWithCards(s: S, seat: number): number | null {
    const n = nextSeat(s, seat, (i) => count(s, i) === 0 || s.data.out[i]);
    return count(s, n) > 0 && !s.data.out[n] ? n : null;
  }

  /** The pile goes to the bottom of `seat`'s cards (shuffled first in Slapjack). */
  function takePile(s: S, seat: number) {
    const taken = pile(s)
      .cards.splice(0)
      .map((c) => ({ id: c.id }));
    if (!ers) shuffle(taken, s);
    const into = hand(s, seat);
    // a pile is face up bottom first; turned over it goes under, the old top card lowest
    const under: CardRef[] = taken.map((c) => {
      s.seq = (s.seq ?? 0) + 1;
      return { id: c.id, k: s.seq };
    });
    into.cards.unshift(...under.reverse());
    const d = s.data;
    d.race++;
    d.slaps = [];
    d.missed = [];
    d.challenge = null;
    d.collect = null;
    d.last = null;
    s.turn = seat;
  }

  /** Move the top card of `from`'s pile to the bottom of `to` (a zone id), face down. */
  function payBottom(s: S, from: number, to: string) {
    const src = hand(s, from).cards;
    const c = src.pop();
    if (!c) return;
    s.seq = (s.seq ?? 0) + 1;
    zone(s, to).cards.unshift({ id: c.id, up: false, k: s.seq });
  }

  function start(s: S) {
    const d = s.data;
    resetDeck(s, config);
    while (zone(s, 'deck').cards.length) deal(s, [{ to: 'hand', count: 1 }]);
    d.race = (d.race ?? 0) + 1;
    d.slaps = [];
    d.judgeAt = 0;
    d.missed = [];
    d.challenge = null;
    d.collect = null;
    d.last = null;
    d.out = s.players.map(() => false);
    d.flash = null;
    d.endsAt = 0;
    d.result = null;
    s.phase = 'play';
    s.turn = nextSeat(s, s.dealer);
    log(s, `${name(s, s.dealer)} deals everyone a pile; ${name(s, s.turn)} turns up first`);
  }

  function finish(s: S, lines: string[]) {
    const counts = s.players.map((_, i) => count(s, i));
    const best = Math.max(...counts);
    s.winner = counts.flatMap((c, i) => (c === best ? [i] : []));
    s.phase = 'gameOver';
    s.turn = null;
    s.data.collect = null;
    s.data.slaps = [];
    s.data.result = { lines };
    log(s, lines[0]);
  }

  /** Someone holds every card: they win. */
  function checkWin(s: S) {
    if (pile(s).cards.length) return;
    const d = s.data;
    const holders = s.players.flatMap((_, i) => (count(s, i) > 0 && !d.out[i] ? [i] : []));
    // in Slapjack the empty-handed are still in until the next jack; in ERS they can always slap back in
    if (holders.length === 1 && (ers || s.players.every((_, i) => i === holders[0] || d.out[i]))) finish(s, [`${name(s, holders[0])} has every card!`]);
  }

  /** Slapjack: a jack went by (taken by someone else, or covered): anyone without cards who didn't win it is out. */
  function jackGone(s: S, winner: number | null) {
    if (ers) return;
    s.players.forEach((_, i) => {
      if (i !== winner && !s.data.out[i] && count(s, i) === 0) {
        s.data.out[i] = true;
        log(s, `${name(s, i)} is out`, i, 'Out');
      }
    });
    const left = s.players.flatMap((_, i) => (s.data.out[i] ? [] : [i]));
    if (left.length === 1) {
      // the last one standing takes whatever's left
      if (pile(s).cards.length) takePile(s, left[0]);
      finish(s, [`${name(s, left[0])} has every card!`]);
    }
  }

  function flip(s: S, seat: number, a: Action) {
    const d = s.data;
    const opt = Number(s.options.timer ?? 0);
    if (opt && !d.endsAt && a.at) d.endsAt = a.at + (MINUTES[opt] ?? 0) * 60_000;
    // a jack covered without a slap still counts as gone by
    const wasJack = !ers && shown(s).at(-1) && rank(shown(s).at(-1)!) === 11;
    const c = hand(s, seat).cards.pop()!;
    s.seq = (s.seq ?? 0) + 1;
    pile(s).cards.push({ id: c.id, up: true, by: seat, k: s.seq });
    d.race++;
    d.missed = [];
    d.last = seat;
    d.flash = null;
    const r = parseCard(c.id).rank;
    log(s, `${name(s, seat)} turns up ${cardText(c.id)}`, seat, undefined, undefined, { from: `hand:${seat}`, to: 'pile' });
    if (wasJack) {
      jackGone(s, null);
      if (s.phase !== 'play') return;
    }

    if (ers && TRIES[r]) {
      d.challenge = { by: seat, left: TRIES[r] };
      const next = nextWithCards(s, seat);
      if (next === null || next === seat) {
        // nobody else can answer: it's theirs
        d.collect = seat;
        s.turn = null;
      } else s.turn = next;
      return;
    }
    if (ers && d.challenge) {
      d.challenge.left--;
      if (d.challenge.left <= 0) {
        d.collect = d.challenge.by;
        s.turn = null;
        return;
      }
      // the same player keeps trying, or (out of cards) the next one carries on
      const next = count(s, seat) > 0 ? seat : nextWithCards(s, seat);
      if (next === null || next === d.challenge.by) {
        d.collect = d.challenge.by;
        s.turn = null;
      } else s.turn = next;
      return;
    }
    const next = nextWithCards(s, seat);
    if (next === null) {
      // nobody has a card left to turn: the pile goes to whoever turned up the last one
      d.collect = seat;
      s.turn = null;
    } else s.turn = next;
  }

  function slap(s: S, seat: number, a: Action) {
    const d = s.data;
    assertRule(canSlap(s, seat), 'You can’t slap now');
    const why = slappable(s);
    const stale = a.race !== undefined && a.race !== d.race;
    if (why) {
      // a slap aimed at an earlier card that happens to land on a good one counts, but last
      const rt = stale ? 60_000 : Math.max(0, a.rt ?? 0);
      if (!d.slaps.length) d.judgeAt = (a.at ?? 0) + REACTION_WINDOW;
      d.slaps.push({ seat, rt });
      return;
    }
    // aimed at a card that's already been covered or taken: no harm done
    if (stale) return;
    d.missed.push(seat);
    d.flash = { seat, ok: false, text: 'Wrong slap', race: d.race };
    if (!count(s, seat)) {
      log(s, `${name(s, seat)} slaps — wrong!`, seat, 'Slap ✗');
      return;
    }
    if (ers) {
      payBottom(s, seat, 'pile');
      log(s, `${name(s, seat)} slaps — wrong! A card goes under the pile`, seat, 'Slap ✗');
    } else if (d.last !== null && d.last !== seat) {
      payBottom(s, seat, `hand:${d.last}`);
      log(s, `${name(s, seat)} slaps — wrong! Pays a card to ${name(s, d.last)}`, seat, 'Slap ✗', d.last);
    } else log(s, `${name(s, seat)} slaps — wrong!`, seat, 'Slap ✗');
    // a wrong slap may have spent their last card: play moves on
    if (s.turn === seat && !count(s, seat)) {
      const next = nextWithCards(s, seat);
      if (next === null) {
        d.collect = d.last ?? seat;
        s.turn = null;
      } else s.turn = next;
    }
  }

  /** The window has closed: the quickest good slap takes the pile. */
  function judge(s: S) {
    const d = s.data;
    const why = slappable(s) ?? 'it';
    const best = [...d.slaps].sort((x, y) => x.rt - y.rt)[0];
    const others = d.slaps.length - 1;
    takePile(s, best.seat);
    d.flash = { seat: best.seat, ok: true, text: 'Slap!', race: d.race };
    log(s, `${name(s, best.seat)} slaps ${why} first${others ? ` (${others} too slow)` : ''} and takes the pile`, best.seat, 'Slap!');
    jackGone(s, best.seat);
    if (s.phase === 'play') checkWin(s);
  }

  // ---- bots ------------------------------------------------------------------------------

  /** A steady coin for this bot on this card (the host asks bots again and again: don't re-roll). */
  const roll = (s: S, seat: number, salt: number) => ((((s.data.race * 7919 + seat * 104729 + salt * 31337 + rngSalt(s)) >>> 0) * 2654435761) >>> 0) / 2 ** 32;

  return {
    config,
    realtime: true,
    botLevels: true,

    setup(players, seed, options) {
      const s = createState<SlapData>(config, players, seed, options, {
        race: 0,
        slaps: [],
        judgeAt: 0,
        missed: [],
        challenge: null,
        collect: null,
        last: null,
        out: [],
        flash: null,
        endsAt: 0,
        result: null,
      });
      s.dealer = players.length - 1;
      start(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase !== 'play' || seat < 0) return [];
      const out: ActionSpec[] = [];
      if (canFlip(s, seat)) out.push({ type: 'flip', label: 'Turn over', style: 'primary', zone: `hand:${seat}` });
      if (canSlap(s, seat)) out.push({ type: 'slap', label: 'Slap!', style: 'danger', react: true, zone: 'pile' });
      return out;
    },

    apply(s, seat, a) {
      if (a.type === 'rematch') {
        assertRule(s.phase === 'gameOver', 'Game not over');
        s.winner = undefined;
        s.dealer = nextSeat(s, s.dealer);
        return start(s);
      }
      assertRule(s.phase === 'play', 'Not now');
      if (a.type === 'slap') return slap(s, seat, a);
      assertRule(a.type === 'flip', `Unknown action ${a.type}`);
      assertRule(s.turn === seat, 'Not your turn');
      assertRule(!s.data.slaps.length && s.data.collect === null, 'Wait a moment');
      assertRule(count(s, seat) > 0, 'You have no cards');
      flip(s, seat, a);
    },

    system(s) {
      if (s.phase !== 'play') return null;
      const d = s.data;
      if (d.slaps.length) return { delay: msUntil(d.judgeAt), run: judge };
      if (d.collect !== null)
        return {
          delay: COLLECT_DELAY,
          run: (s) => {
            const who = s.data.collect!;
            const wasJack = !ers && shown(s).at(-1) && rank(shown(s).at(-1)!) === 11;
            takePile(s, who);
            log(s, `${name(s, who)} takes the pile`, who, 'Mine');
            if (wasJack) jackGone(s, who);
            if (s.phase === 'play') checkWin(s);
          },
        };
      if (d.endsAt)
        return {
          delay: msUntil(d.endsAt),
          run: (s) => {
            // the pile in the middle goes to nobody
            finish(s, ['Time’s up! Most cards wins.']);
          },
        };
      return null;
    },

    bot(s, seat) {
      if (s.phase !== 'play') return null;
      const d = s.data;
      const level = botLevel(s.options);
      if (canSlap(s, seat)) {
        const why = slappable(s);
        // slower bots sometimes miss one; easy ones sometimes slap a court card by mistake
        if (why && roll(s, seat, 1) >= [0.3, 0.1, 0.02][level]) return { type: 'slap', race: d.race };
        const top = shown(s).at(-1);
        if (!why && top && rank(top) >= 11 && roll(s, seat, 2) < [0.05, 0.015, 0][level]) return { type: 'slap', race: d.race };
      }
      if (canFlip(s, seat)) return { type: 'flip' };
      return null;
    },

    /** Reaction times: Easy is slow, Hard quicker than most people. */
    botDelay(s, _seat, a) {
      const level = botLevel(s.options);
      if (a.type === 'slap')
        return span(
          (
            [
              [800, 1400],
              [520, 900],
              [340, 580],
            ] as const
          )[level],
        );
      return span([550, 1000]);
    },

    standings(s) {
      return placesFromScores(s.players.map((_, i) => (s.data.out[i] ? -1 : count(s, i))));
    },

    status(s, viewer) {
      const d = s.data;
      let headline = '';
      if (s.phase === 'play') {
        const flash = d.flash && d.flash.race === d.race ? d.flash : null;
        if (d.slaps.length) headline = 'Slap!';
        else if (flash?.ok) headline = `${flash.seat === viewer ? 'You' : name(s, flash.seat)} slapped first!`;
        else if (d.collect !== null) headline = `${d.collect === viewer ? 'You take' : `${name(s, d.collect)} takes`} the pile…`;
        else if (d.challenge && s.turn !== null)
          headline = `${s.turn === viewer ? 'You have' : `${name(s, s.turn)} has`} ${d.challenge.left} ${d.challenge.left === 1 ? 'try' : 'tries'} to turn up a court card or ace`;
        else if (s.turn !== null) headline = s.turn === viewer ? 'Your turn: turn over a card' : `${name(s, s.turn)} turns over`;
        if (flash && !flash.ok) headline = `${flash.seat === viewer ? 'You' : name(s, flash.seat)} slapped wrong! · ${headline}`;
      } else headline = d.result?.lines[0] ?? '';
      const timer = d.endsAt && s.phase === 'play' ? `Ends at ${new Date(d.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : undefined;
      return {
        headline,
        race: d.race,
        hint: timer,
        seats: s.players.map((_, i) => ({
          badge: d.out[i] ? 'Out' : `${count(s, i)} card${count(s, i) === 1 ? '' : 's'}`,
          out: d.out[i],
        })),
        banner:
          s.phase === 'gameOver'
            ? {
                title: s.winner!.length === 1 ? `${name(s, s.winner![0])} wins!` : 'A tie!',
                lines: [...(d.result?.lines ?? []), ...s.players.map((p, i) => `${p.name}: ${count(s, i)} cards`)],
              }
            : undefined,
      };
    },
  };
}

function cardText(id: string) {
  const c = parseCard(id);
  const word = RANK_WORD[c.rank] ?? String(c.rank);
  return `${/^[aeiou8]/.test(word) ? 'an' : 'a'} ${word}`;
}
