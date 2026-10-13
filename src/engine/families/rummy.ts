import { buildDeck, cardLabel, cardName, parseCard } from '../cards';
import { bestMelds, deadwoodValue, meldOrder } from '../lib/melds';
import { createState, cutForDeal, hand, ids, log, moveCards, moveTop, name, placesFromScores, resetDeck, zone } from '../state';
import { botLevel } from '../bots/search';
import { familyRules, assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';
import { ownOnly } from '../redact';
/** This family's settings in game.json (generated from the schema). */
export type { GinRules as RummyRules } from '../schema.gen';

export interface RummyData {
  handNo: number;
  scores: number[];
  /** Hands won, for the end-of-game box bonus. */
  boxes: number[];
  /** First turn: 0 = non-dealer may take the upcard, 1 = dealer may, then normal play. */
  firstPick: number;
  /** After both pass on the upcard, the non-dealer must draw from the stock. */
  mustDrawStock: boolean;
  /** Card just taken from the discard pile (it can't be thrown straight back). */
  justTook: string | null;
  /** Card each seat just drew (highlighted in their hand; redacted to the owner). */
  received: string[][];
  /** Cards each seat has taken from the discard pile this hand (public: everyone saw them go). */
  pickedUp?: string[][];
  result: { headline: string; lines: string[] } | null;
}

type S = GameState<RummyData>;

export function rummyFamily(config: GameConfig): GameModule<RummyData> {
  const R = familyRules(config, 'rummy', 'gin');
  const target = (s: S) => Number(s.options.target ?? R.end.target);
  const other = (seat: number) => 1 - seat;
  const topDiscard = (s: S) => zone(s, 'discard').cards.at(-1)?.id ?? null;
  const showZone = (seat: number) => `show:${seat}`;

  function arrange(s: S, seat: number) {
    const z = hand(s, seat);
    const order = meldOrder(ids(z));
    z.cards.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  /** Deadwood left after discarding each possible card (11-card hand). */
  function discardOptions(s: S, seat: number) {
    const cards = ids(hand(s, seat));
    return cards.filter((c) => c !== s.data.justTook).map((c) => ({ card: c, points: bestMelds(cards.filter((x) => x !== c)).points }));
  }

  /** Cards `seat` hasn't seen: not in its hand or the discard pile, nor picked up by the opponent. */
  function unseenBy(s: S, seat: number) {
    const seen = new Set([...ids(hand(s, seat)), ...ids(zone(s, 'discard')), ...(s.data.pickedUp?.[other(seat)] ?? [])]);
    return buildDeck(config.deck).filter((c) => !seen.has(c));
  }

  /** Best deadwood achievable by taking `card` and then discarding something else. */
  function bestAfterTaking(cards: string[], card: string) {
    const all = [...cards, card];
    return Math.min(...cards.map((d) => bestMelds(all.filter((x) => x !== d)).points));
  }

  function startHand(s: S) {
    const d = s.data;
    resetDeck(s, config);
    for (const seat of [0, 1]) zone(s, showZone(seat)).cards = [];
    const first = other(s.dealer);
    for (let i = 0; i < R.handSize; i++) for (const seat of [first, s.dealer]) moveTop(s, 'deck', `hand:${seat}`, 1);
    moveTop(s, 'deck', 'discard', 1, { up: true });
    [0, 1].forEach((seat) => arrange(s, seat));
    d.handNo++;
    d.firstPick = 0;
    d.mustDrawStock = false;
    d.justTook = null;
    d.received = [[], []];
    d.pickedUp = [[], []];
    d.result = null;
    s.phase = 'firstPick';
    s.turn = first;
    log(s, `Hand ${d.handNo}: ${name(s, s.dealer)} deals, ${cardLabel(topDiscard(s)!)} turned up`, undefined, undefined, undefined, { from: 'deck' });
  }

  function takeDiscard(s: S, seat: number) {
    const card = topDiscard(s)!;
    moveCards(s, 'discard', `hand:${seat}`, [card]);
    s.data.justTook = card;
    s.data.received[seat] = [card];
    (s.data.pickedUp ??= [[], []])[seat].push(card);
    arrange(s, seat);
    log(s, `${name(s, seat)} takes the ${cardName(card)} from the discard pile`, seat, `Took ${cardLabel(card)}`, undefined, { from: 'discard' });
    s.phase = 'discard';
  }

  /**
   * Bots. Easy sometimes settles for a worse discard and only takes the discard pile for an obvious
   * gain. Normal keeps the least deadwood. Hard also keeps away from feeding the opponent (cards
   * that fit what they've picked up).
   */
  function botMove(s: S, seat: number): Action | null {
    if (s.turn !== seat) return null;
    const level = botLevel(s.options);
    const cards = ids(hand(s, seat));
    const top = topDiscard(s);
    const now = bestMelds(cards).points;
    const wants = (c: string | null) => !!c && bestAfterTaking(cards, c) < now - (level === 0 ? 4 : 0);
    if (s.phase === 'firstPick') return wants(top) ? { type: 'take' } : { type: 'pass' };
    if (s.phase === 'draw') return !s.data.mustDrawStock && wants(top) ? { type: 'take' } : { type: 'draw' };
    if (s.phase !== 'discard') return null;
    if (now === 0 && s.options.bigGin) return { type: 'bigGin' };
    let opts = discardOptions(s, seat);
    const theirs = s.data.pickedUp?.[other(seat)] ?? [];
    // how much a card would help the opponent: same rank, or a near neighbour in suit, as cards they took
    const feeds = (c: string) => {
      const x = parseCard(c);
      return theirs.reduce((n, t) => {
        const y = parseCard(t);
        return n + (y.rank === x.rank ? 3 : y.suit === x.suit && Math.abs(y.rank - x.rank) <= 2 ? 2 : 0);
      }, 0);
    };
    // Hard looks a draw ahead: the deadwood it can expect next turn, averaged over every card it might draw
    const unseen = level === 2 ? unseenBy(s, seat) : [];
    const nextTurn = (card: string) => {
      const keep = cards.filter((c) => c !== card);
      let t = 0;
      for (const u of unseen) {
        const m = bestMelds([...keep, u]);
        t += m.points - Math.max(0, ...m.deadwood.map(deadwoodValue));
      }
      return t / Math.max(1, unseen.length);
    };
    const ahead = new Map(level === 2 ? opts.map((o) => [o.card, nextTurn(o.card)]) : []);
    const cost = (o: { card: string; points: number }) =>
      (ahead.get(o.card) ?? o.points + (level === 2 ? 99 : 0)) + (level === 2 ? feeds(o.card) * 0.5 : 0) - deadwoodValue(o.card) / 100;
    opts = opts.sort((a, b) => cost(a) - cost(b));
    let pick = opts[0];
    if (level === 0 && opts.length > 1 && Math.random() < 0.35) pick = opts[1 + Math.floor(Math.random() * Math.min(2, opts.length - 1))];
    // going out: the best discard for it (whatever its danger, the hand ends)
    const out = [...opts].sort((a, b) => a.points - b.points)[0];
    if (out.points === 0) return { type: 'gin', cards: [out.card] };
    if (out.points <= R.knockMax) return { type: 'knock', cards: [out.card] };
    return { type: 'discard', cards: [pick.card] };
  }

  /** Pagat's bonuses (gin 20, undercut 10, box 20), or the common 25-each variant. */
  const bonusesFor = (s: S) => ({ ...R.bonuses, ...(s.options.bonus25 ? { gin: 25, undercut: 25, box: 25 } : {}) });

  function endHand(s: S, knocker: number, kind: 'knock' | 'gin' | 'bigGin') {
    const d = s.data;
    const B = bonusesFor(s);
    const defender = other(knocker);
    const k = bestMelds(ids(hand(s, knocker)));
    // the defender arranges their hand to lay off as much as possible (none on gin)
    const def = bestMelds(ids(hand(s, defender)), kind === 'knock' ? k.melds : undefined);
    const laid = def.laid;
    const defDead = def.deadwood.filter((c) => !laid.includes(c));
    const dd = defDead.reduce((n, c) => n + deadwoodValue(c), 0);
    const kd = k.points;

    let winner: number;
    let points: number;
    const lines: string[] = [];
    if (kind === 'bigGin') {
      winner = knocker;
      points = (B.bigGin ?? B.gin) + dd;
      lines.push(`${name(s, knocker)} goes BIG GIN! +${B.bigGin ?? B.gin} bonus`);
    } else if (kind === 'gin') {
      winner = knocker;
      points = B.gin + dd;
      lines.push(`${name(s, knocker)} goes gin! +${B.gin} bonus`);
    } else if (kd < dd) {
      winner = knocker;
      points = dd - kd;
      lines.push(`${name(s, knocker)} knocks with ${kd}`);
    } else {
      winner = defender;
      points = kd - dd + B.undercut;
      lines.push(`${name(s, defender)} undercuts ${name(s, knocker)}! +${B.undercut} bonus`);
    }
    if (laid.length) lines.push(`${name(s, defender)} lays off ${laid.map(cardLabel).join(' ')}`);
    lines.push(`${name(s, knocker)} ${kd} deadwood · ${name(s, defender)} ${dd} deadwood`);
    lines.push(`${name(s, winner)} scores ${points}`);
    d.scores[winner] += points;
    d.boxes[winner]++;

    // lay both hands face up: melds first, then layoffs, then deadwood
    // each meld is its own group; laid-off cards and deadwood follow, deadwood dimmed
    const reveal = (seat: number, groups: string[][], dead: string[], text: string) => {
      groups.filter((g) => g.length).forEach((g, gi) => moveCards(s, `hand:${seat}`, showZone(seat), g, { up: true, group: gi }));
      moveCards(s, `hand:${seat}`, showZone(seat), dead, { up: true, group: groups.length, dim: true });
      zone(s, showZone(seat)).label = `${name(s, seat)} · ${text}`;
    };
    reveal(knocker, k.melds, k.deadwood, kind === 'knock' ? `knocked, ${kd} deadwood` : 'gin');
    reveal(defender, [...def.melds, laid], defDead, `${dd} deadwood${laid.length ? `, laid off ${laid.map(cardLabel).join(' ')}` : ''}`);

    const headline = `${lines[0]} · ${name(s, winner)} +${points}`;
    log(s, headline, knocker, kind === 'knock' ? `Knock (${kd})` : kind === 'gin' ? 'Gin!' : 'Big gin!');
    s.turn = null;
    s.dealer = winner; // the winner deals the next hand
    if (d.scores[winner] >= target(s)) {
      // the game bonus doubles if the loser didn't score at all (a shutout)
      const game = (B.game ?? 0) * (d.scores[other(winner)] === 0 ? 2 : 1);
      const finals = [0, 1].map((i) => d.scores[i] + (i === winner ? game : 0) + d.boxes[i] * (B.box ?? 0));
      lines.push(
        ...[0, 1].map(
          (i) =>
            `${name(s, i)}: ${d.scores[i]} + ${d.boxes[i]} hands won${i === winner && game ? ` + ${game} ${d.scores[other(winner)] === 0 ? 'shutout' : 'game'}` : ''} = ${finals[i]}`,
        ),
      );
      s.winner = [finals[0] >= finals[1] ? 0 : 1];
      s.phase = 'gameOver';
    } else s.phase = 'handOver';
    d.result = { headline, lines };
  }

  const module: GameModule<RummyData> = {
    config,
    botLevels: true,

    setup(players, seed, options) {
      const s = createState<RummyData>(config, players, seed, options, {
        handNo: 0,
        scores: [0, 0],
        boxes: [0, 0],
        firstPick: 0,
        mustDrawStock: false,
        justTook: null,
        received: [[], []],
        result: null,
      });
      s.dealer = cutForDeal(s); // low card deals
      startHand(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      const top = topDiscard(s);
      if (s.phase === 'handOver') return [{ type: 'next', label: 'Next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.turn !== seat) return [];
      if (s.phase === 'firstPick')
        return [
          { type: 'take', label: `Take ${top ? cardLabel(top) : ''}`, style: 'primary', zone: 'discard' },
          { type: 'pass', label: 'Pass' },
        ];
      if (s.phase === 'draw') {
        const out: ActionSpec[] = [{ type: 'draw', label: 'Draw stock', style: 'primary', zone: 'deck' }];
        if (!d.mustDrawStock && top) out.push({ type: 'take', label: `Take ${cardLabel(top)}`, zone: 'discard' });
        return out;
      }
      if (s.phase === 'discard') {
        const opts = discardOptions(s, seat);
        const cards = opts.map((o) => o.card);
        const out: ActionSpec[] = [{ type: 'discard', label: 'Discard', style: 'primary', quick: true, select: { min: 1, max: 1, cards } }];
        const gin = opts.filter((o) => o.points === 0).map((o) => o.card);
        const knock = opts.filter((o) => o.points > 0 && o.points <= R.knockMax).map((o) => o.card);
        if (s.options.bigGin && bestMelds(ids(hand(s, seat))).points === 0) out.unshift({ type: 'bigGin', label: 'Big Gin!', style: 'primary' });
        if (gin.length) out.push({ type: 'gin', label: 'Gin!', select: { min: 1, max: 1, cards: gin } });
        if (knock.length) out.push({ type: 'knock', label: 'Knock', select: { min: 1, max: 1, cards: knock } });
        return out;
      }
      return [];
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'handOver', 'Hand in progress');
          return startHand(s);
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.scores = [0, 0];
          d.boxes = [0, 0];
          d.handNo = 0;
          s.winner = undefined;
          return startHand(s);
      }
      assertRule(s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'pass':
          assertRule(s.phase === 'firstPick', 'You can only pass on the first upcard');
          log(s, `${who} passes on the ${cardName(topDiscard(s)!)}`, seat, 'Pass');
          if (d.firstPick === 0) {
            d.firstPick = 1;
            s.turn = other(seat);
          } else {
            d.mustDrawStock = true;
            s.phase = 'draw';
            s.turn = other(seat);
          }
          return;
        case 'take':
          assertRule((s.phase === 'firstPick' || s.phase === 'draw') && !d.mustDrawStock, 'You must draw from the stock');
          assertRule(topDiscard(s), 'The discard pile is empty');
          return takeDiscard(s, seat);
        case 'draw':
          assertRule(s.phase === 'draw', 'Not time to draw');
          moveTop(s, 'deck', `hand:${seat}`, 1);
          d.received[seat] = [hand(s, seat).cards.at(-1)!.id];
          d.justTook = null;
          d.mustDrawStock = false;
          arrange(s, seat);
          log(s, `${who} draws from the stock`, seat, 'Drew', undefined, { from: 'deck' });
          s.phase = 'discard';
          return;
        case 'discard':
        case 'knock':
        case 'gin': {
          assertRule(s.phase === 'discard', 'Draw first');
          const card = a.cards?.[0];
          const opt = discardOptions(s, seat).find((o) => o.card === card);
          assertRule(card && opt, d.justTook === card ? 'You can’t discard the card you just took' : 'Choose a card to discard');
          if (a.type === 'knock') assertRule(opt.points <= R.knockMax, `You need ${R.knockMax} or less deadwood to knock`);
          if (a.type === 'gin') assertRule(opt.points === 0, 'That leaves deadwood — not gin');
          moveCards(s, `hand:${seat}`, 'discard', [card], { up: true });
          d.justTook = null;
          d.received[seat] = [];
          if (a.type !== 'discard') return endHand(s, seat, opt.points === 0 ? 'gin' : 'knock');
          log(s, `${who} discards the ${cardName(card)}`, seat, cardLabel(card), undefined, { to: 'discard' });
          if (zone(s, 'deck').cards.length <= 2) {
            d.result = { headline: 'The stock ran out — no score this hand', lines: ['Nobody knocked before the stock ran low.'] };
            log(s, d.result.headline);
            s.phase = 'handOver';
            s.turn = null;
            for (const i of [0, 1]) for (const c of hand(s, i).cards) c.up = true;
            return;
          }
          s.phase = 'draw';
          s.turn = other(seat);
          return;
        }
        case 'bigGin':
          assertRule(!!s.options.bigGin && s.phase === 'discard' && bestMelds(ids(hand(s, seat))).points === 0, 'Not big gin');
          return endHand(s, seat, 'bigGin');
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    redactData(s, viewer) {
      return { ...s.data, received: ownOnly(s.data.received, viewer) };
    },

    bot(s, seat) {
      return botMove(s, seat);
    },

    standings(s) {
      return placesFromScores(s.data.scores);
    },

    status(s, viewer) {
      const d = s.data;
      const top = topDiscard(s);
      const turnName = s.turn != null ? name(s, s.turn) : '';
      let headline: string;
      if (s.phase === 'firstPick')
        headline = s.turn === viewer ? `Take the ${top ? cardLabel(top) : 'upcard'} or pass` : `${turnName} is deciding on the upcard`;
      else if (s.phase === 'draw')
        headline = s.turn === viewer ? (d.mustDrawStock ? 'Draw from the stock' : 'Draw from the stock or take the discard') : `${turnName} to draw`;
      else if (s.phase === 'discard') headline = s.turn === viewer ? 'Discard a card — or knock' : `${turnName} to discard`;
      else headline = d.result?.headline ?? '';

      let hint: string | undefined;
      if (viewer >= 0 && (s.phase === 'firstPick' || s.phase === 'draw' || s.phase === 'discard')) {
        const cards = ids(hand(s, viewer));
        if (cards.length > R.handSize) {
          const best = Math.min(...discardOptions(s, viewer).map((o) => o.points));
          hint = best === 0 ? 'Gin is on!' : best <= R.knockMax ? `Can knock with ${best}` : `Deadwood ${best} after discard`;
        } else hint = `Deadwood ${bestMelds(cards).points}`;
      }

      return {
        headline,
        hint,
        seats: s.players.map((_, i) => ({ badge: `${d.scores[i]} pts`, tag: i === s.dealer ? 'D' : undefined })),
        scoreboard: {
          columns: ['Hands won', 'Score'],
          rows: s.players.map((p, i) => ({ name: p.name, values: [d.boxes[i], d.scores[i]], highlight: s.winner?.includes(i) })),
        },
        banner: s.phase === 'gameOver' ? { title: `${name(s, s.winner![0])} wins!`, lines: d.result?.lines ?? [] } : undefined,
      };
    },
  };
  return module;
}
