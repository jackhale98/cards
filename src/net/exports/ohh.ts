import type { PokerData } from '../../engine/families/poker';
import * as bet from '../../engine/lib/betting';
import { canSee } from '../../engine/redact';
import type { PokerRules } from '../../engine/schema.gen';
import type { Action } from '../../engine/types';
import type { HandFormat, RecordMeta } from './types';

/**
 * Open Hand History (hh-specs.handhistory.org, 1.4.9), the poker hand history format that tracking
 * tools read: one JSON object per hand, a blank line between hands, in a `.ohh` file.
 *
 * Written for one player (the "hero"): their own hole cards, and other players' only where they
 * were shown at a showdown. Amounts are play chips (currency XPM, "play money"); an action's
 * `amount` is what that action put in. Seats are 1-based (`id` is the game seat).
 */
interface OhhAction {
  street: number;
  seat: number;
  action: string;
  amount: number;
  allin: boolean;
}

interface OhhHand {
  number: number;
  at: Date;
  button: number;
  sb: number;
  bb: number;
  /** Seats dealt in, with their stacks before the blinds. */
  players: { seat: number; stack: number }[];
  hole: string[][];
  actions: OhhAction[];
  board: string[];
  shown: { seat: number; cards: string[] }[];
  wins: { seat: number; amount: number }[];
  pot: number;
}

/** A card the OHH way: rank then lower-case suit ("As", "Td"). */
const card = (id: string) => `${id[0]}${id[1].toLowerCase()}`;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function ohh(rules: PokerRules): HandFormat<OhhHand> {
  const omaha = rules.holeCards === 4;
  const STREETS = ['Preflop', 'Flop', 'Turn', 'River'];
  return {
    start(deal, at) {
      const d = deal.data as PokerData;
      const dealtIn = deal.players.filter((p) => !d.b.out[p.seat]);
      const hand: OhhHand = {
        number: d.handNo,
        at,
        button: d.button,
        sb: d.sb,
        bb: d.bb,
        players: dealtIn.map((p) => ({ seat: p.seat, stack: p.chips + d.b.committed[p.seat] })),
        hole: deal.players.map((p) => deal.zones[`hand:${p.seat}`].cards.map((c) => c.id)),
        actions: [],
        board: [],
        shown: [],
        wins: [],
        pot: 0,
      };
      // the blinds, posted with the deal
      for (const p of dealtIn) {
        const said = d.acted[p.seat] ?? '';
        const put = d.b.committed[p.seat];
        if (!put) continue;
        hand.actions.push({ street: 0, seat: p.seat, action: said.startsWith('Small') ? 'Post SB' : 'Post BB', amount: put, allin: d.b.allIn[p.seat] });
      }
      hand.actions.sort((a, b) => (a.action === 'Post SB' ? -1 : b.action === 'Post SB' ? 1 : 0));
      return hand;
    },

    step(hand, prev, _next, move?: { seat: number; action: Action }) {
      if (!move || prev.phase !== 'betting') return;
      const before = prev.data as PokerData;
      const { seat } = move;
      // the move again on a copy of the betting (the move that ends a hand has paid the pot out)
      const b = structuredClone(before.b);
      const chips = prev.players.map((p) => p.chips);
      const t = move.action.type;
      try {
        if (t === 'raise') bet.act(b, chips, seat, { type: 'raise', to: Math.floor(move.action.amount ?? 0) });
        else if (t === 'fold' || t === 'check' || t === 'call' || t === 'allin') bet.act(b, chips, seat, { type: t });
        else return;
      } catch {
        return;
      }
      const put = b.committed[seat] - before.b.committed[seat];
      const toCall = before.b.currentBet - before.b.bets[seat];
      const opened = before.street === 0 || before.b.currentBet > 0;
      const action = t === 'fold' ? 'Fold' : t === 'check' ? 'Check' : t === 'call' || (t === 'allin' && put <= toCall) ? 'Call' : opened ? 'Raise' : 'Bet';
      hand.actions.push({
        street: before.street,
        seat,
        action,
        amount: action === 'Fold' || action === 'Check' ? 0 : put,
        allin: b.allIn[seat] && !before.b.allIn[seat],
      });
    },

    end(hand, last) {
      const d = last.data as PokerData;
      hand.board = last.zones.board.cards.map((c) => c.id);
      // (what each put in, from their actions: by the end the table has paid the pot out)
      const put = (seat: number) => hand.actions.filter((a) => a.seat === seat).reduce((n, a) => n + a.amount, 0);
      hand.pot = hand.players.reduce((n, p) => n + put(p.seat), 0);
      // shown at the showdown: hands everyone could see by the end
      if (d.showdown)
        for (const p of hand.players) {
          const z = last.zones[`hand:${p.seat}`];
          if (!d.b.folded[p.seat] && z.cards.length && z.cards.every((c) => canSee(z, c, -1)))
            hand.shown.push({ seat: p.seat, cards: z.cards.map((c) => c.id) });
        }
      for (const p of hand.players) {
        const won = last.players[p.seat].chips - (p.stack - put(p.seat));
        if (won > 0) hand.wins.push({ seat: p.seat, amount: won });
      }
    },

    write(hands, seat, meta: RecordMeta) {
      return hands
        .filter((h) => h.wins.length || h.pot)
        .map((h) => {
          // the board split into its streets ([3, 1, 1]: flop, turn, river)
          const streets: string[][] = [[]];
          let at = 0;
          for (const n of rules.board) {
            streets.push(h.board.slice(at, at + n));
            at += n;
          }
          const rounds: unknown[] = [];
          for (let st = 0; st < STREETS.length; st++) {
            if (st > 0 && !streets[st]?.length) break;
            const acts = h.actions.filter((a) => a.street === st);
            const list = acts.map((a) => ({ player_id: a.seat, action: a.action, amount: a.amount, is_allin: a.allin }));
            // the hero's own cards, dealt after the blinds
            if (st === 0 && seat >= 0 && h.players.some((p) => p.seat === seat)) {
              const blinds = list.filter((a) => a.action.startsWith('Post')).length;
              list.splice(blinds, 0, { player_id: seat, action: 'Dealt Cards', amount: 0, is_allin: false, cards: h.hole[seat].map(card) } as never);
            }
            rounds.push({ id: st, street: STREETS[st], cards: (streets[st] ?? []).map(card), actions: list.map((a, i) => ({ action_number: i + 1, ...a })) });
          }
          if (h.shown.length)
            rounds.push({
              id: rounds.length,
              street: 'Showdown',
              actions: h.shown.map((x, i) => ({
                action_number: i + 1,
                player_id: x.seat,
                action: 'Shows Cards',
                amount: 0,
                is_allin: false,
                cards: x.cards.map(card),
              })),
            });
          return JSON.stringify({
            ohh: {
              spec_version: '1.4.9',
              site_name: 'Lamplight',
              network_name: 'Lamplight',
              internal_version: 'lamplight',
              tournament: false,
              game_number: `${meta.table}-${h.number}`,
              start_date_utc: iso(h.at),
              table_name: meta.table,
              table_size: meta.names.length,
              game_type: omaha ? 'Omaha' : 'Holdem',
              bet_limit: { bet_type: 'NL', bet_cap: 0 },
              currency: 'XPM',
              dealer_seat: h.button + 1,
              small_blind_amount: h.sb,
              big_blind_amount: h.bb,
              ante_amount: 0,
              ...(seat >= 0 ? { hero_player_id: seat } : {}),
              players: h.players.map((p) => ({ id: p.seat, seat: p.seat + 1, name: meta.names[p.seat] ?? '', starting_stack: p.stack })),
              rounds,
              pots: [{ number: 0, amount: h.pot, rake: 0, player_wins: h.wins.map((w) => ({ player_id: w.seat, win_amount: w.amount })) }],
            },
          });
        })
        .join('\n\n');
    },
  };
}
