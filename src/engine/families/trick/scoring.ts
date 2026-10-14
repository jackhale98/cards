import { name } from '../../state';
import { bridgeLabel, bridgeScore, contractLabel } from './contracts';
import { teamName, teamOf, teamsFor } from './sides';
import { target, totalRounds, type S, type TrickGame } from './types';

/** Scoring a hand, and whether the game is over. */

/** Points each team earns this round. */
export function roundScores(g: TrickGame, s: S): { deltas: number[]; lines: string[] } {
  const d = s.data;
  const teams = teamsFor(g, s.players.length);
  const lines: string[] = [];
  const sc = g.R.scoring;
  const deltas = teams.map(() => 0);
  const totalPoints = g.totalPoints;
  if (sc.type === 'penalty') {
    const shooter = sc.moon ? d.points.findIndex((p) => p === totalPoints && p > 0) : -1;
    const sub = shooter >= 0 && d.moon === 'sub';
    if (shooter >= 0) lines.push(`🌙 ${name(s, shooter)} shot the moon${sub ? ` and takes ${totalPoints} off` : ''}!`);
    teams.forEach((t, ti) => {
      deltas[ti] = shooter >= 0 ? (t.includes(shooter) ? (sub ? -totalPoints : 0) : sub ? 0 : totalPoints) : t.reduce((n, i) => n + d.points[i], 0);
    });
  } else if (sc.type === 'tricks') {
    teams.forEach((t, ti) => (deltas[ti] = t.reduce((n, i) => n + d.tricks[i], 0)));
  } else if (sc.type === 'whist') {
    // the side with more tricks scores one for each over six (the "book")
    const won = teams.map((t) => t.reduce((n, i) => n + d.tricks[i], 0));
    const best = won.indexOf(Math.max(...won));
    deltas[best] = won[best] - 6;
    lines.push(`${teamName(g, s, best)} take ${won[best]} tricks: ${won[best] - 6} over the book`);
    // honours (an option): 4 for all of A K Q J of trumps, 2 for three — not for a side already at 4.
    // Tricks score first, so honours never count once the other side's tricks have won the game.
    const h = d.honours;
    const tricksWin = d.scores[best] + deltas[best] >= target(g, s);
    if (s.options.honours && h && d.scores[h.team] < target(g, s) - 1 && (h.team === best || !tricksWin)) {
      const pts = h.count === 4 ? 4 : 2;
      deltas[h.team] += pts;
      lines.push(`${teamName(g, s, h.team)} held ${h.count} honours: +${pts}`);
    }
  } else if (sc.type === 'exact') {
    teams.forEach((t, ti) => {
      // a point a trick plus the bonus for an exact bid (or, with `exactOnly`, nothing for a miss)
      for (const i of t) deltas[ti] += d.tricks[i] === d.bids[i] ? d.tricks[i] + sc.bonus : s.options.exactOnly ? 0 : d.tricks[i];
    });
  } else if (sc.type === 'euchre') {
    const makers = teamOf(g, s, d.maker!);
    const won = teams[makers].reduce((n, i) => n + d.tricks[i], 0);
    const alone = d.sittingOut != null;
    const march = sc.march ?? 2;
    const euchred = sc.euchred ?? 2;
    if (won >= 3) {
      deltas[makers] = won === 5 ? (alone ? march * 2 : march) : 1;
      lines.push(`${teamName(g, s, makers)} make it${won === 5 ? (alone ? ' — a loner march!' : ' — march!') : ''} (${won} tricks)`);
    } else {
      // a lone defender who euchres the makers scores 4
      deltas[1 - makers] = d.defAlone != null ? euchred * 2 : euchred;
      lines.push(`${teamName(g, s, makers)} are euchred${d.defAlone != null ? ` by ${name(s, d.defAlone)} alone` : ''}! (${won} tricks)`);
    }
  } else if (sc.type === 'bridge') {
    const c = d.bridge!;
    const side = teamOf(g, s, d.maker!);
    const won = teams[side].reduce((n, i) => n + d.tricks[i], 0);
    const pts = bridgeScore(c, !!d.vul?.[side], won);
    if (pts >= 0) deltas[side] = pts;
    else deltas[1 - side] = -pts;
    const diff = won - c.level - 6;
    lines.push(
      `${name(s, d.maker!)} ${diff >= 0 ? `made ${bridgeLabel(c)}${diff ? ` +${diff}` : ''}` : `went down ${-diff} in ${bridgeLabel(c)}`}${d.vul?.[side] ? ' (vulnerable)' : ''}`,
    );
  } else if (sc.type === 'auction') {
    const c = d.contract!;
    const makers = teamOf(g, s, d.maker!);
    if (c.misere) {
      // the contractor alone must take nothing; the opponents score nothing either way
      const made = d.tricks[d.maker!] === 0;
      deltas[makers] = made ? c.value : -c.value;
      lines.push(`${name(s, d.maker!)} ${made ? 'makes' : 'fails'} ${contractLabel(c)}: ${made ? '+' : '−'}${c.value}`);
      return { deltas, lines };
    }
    if (g.R.callPartner) {
      // five-handed: contractor and partner win or lose half the bid each (alone, all of it);
      // each opponent scores 10 a trick
      const side = [d.maker!, ...(d.partner != null ? [d.partner] : [])];
      const won = side.reduce((n, i) => n + d.tricks[i], 0);
      const made = won >= c.tricks;
      const value = made && won === 10 && c.value < (sc.slam ?? 250) ? (sc.slam ?? 250) : c.value;
      const each = side.length === 2 ? value / 2 : value;
      for (const i of side) deltas[teamOf(g, s, i)] = made ? each : -each;
      lines.push(
        `${side.map((i) => name(s, i)).join(' & ')} ${made ? 'make' : 'go down on'} ${contractLabel(c)} with ${won} tricks: ${made ? '+' : '−'}${each}${side.length === 2 ? ' each' : ''}`,
      );
      for (const p of s.players) {
        if (side.includes(p.seat)) continue;
        deltas[teamOf(g, s, p.seat)] = d.tricks[p.seat] * sc.perTrick;
        if (d.tricks[p.seat]) lines.push(`${p.name}: ${d.tricks[p.seat]} tricks, +${d.tricks[p.seat] * sc.perTrick}`);
      }
      return { deltas, lines };
    }
    teams.forEach((t, ti) => {
      const won = t.reduce((n, i) => n + d.tricks[i], 0);
      if (ti === makers) {
        const made = won >= c.tricks;
        const value = made && won === 10 && c.value < (sc.slam ?? 250) ? (sc.slam ?? 250) : c.value;
        deltas[ti] = made ? value : -c.value;
        lines.push(`${teamName(g, s, ti)} ${made ? 'make' : 'go down on'} ${contractLabel(c)} with ${won} tricks: ${made ? '+' : '−'}${Math.abs(deltas[ti])}`);
      } else {
        deltas[ti] = won * sc.perTrick;
        lines.push(`${teamName(g, s, ti)}: ${won} tricks, +${deltas[ti]}`);
      }
    });
  } else {
    // contract (spades-style): team bid vs team tricks, nil bids scored separately
    const nilBonus = sc.nil ?? 100;
    teams.forEach((t, ti) => {
      let bid = 0;
      let won = 0;
      // tricks taken by a failed nil don't help the partner's bid, but they are still bags
      let nilBags = 0;
      for (const i of t) {
        if (d.bids[i] === 0 && g.nilAllowed) {
          const ok = d.tricks[i] === 0;
          const worth = d.blind?.[i] ? nilBonus * 2 : nilBonus;
          deltas[ti] += ok ? worth : -worth;
          nilBags += d.tricks[i];
          lines.push(`${name(s, i)} ${ok ? 'made' : 'failed'} ${d.blind?.[i] ? 'blind nil' : 'nil'}`);
        } else {
          bid += d.bids[i] ?? 0;
          won += d.tricks[i];
        }
      }
      let newBags = nilBags;
      if (bid > 0 || won > 0) {
        if (won >= bid) {
          deltas[ti] += bid * 10;
          newBags += won - bid;
        } else deltas[ti] -= bid * 10;
      }
      deltas[ti] += newBags * (sc.overtrick ?? 1);
      d.bags[ti] += newBags;
      const bags = sc.bags;
      while (bags && d.bags[ti] >= bags.every) {
        d.bags[ti] -= bags.every;
        deltas[ti] -= bags.penalty;
        lines.push(`${teamName(g, s, ti)}: ${bags.every} bags, −${bags.penalty}`);
      }
    });
  }
  return { deltas, lines };
}

/** The last trick is in (or a misère has failed): score the hand and see whether the game is over. */
export function endRound(g: TrickGame, s: S) {
  const d = s.data;
  const R = g.R;
  const lowWins = g.lowWins;
  if (R.scoring.type === 'penalty' && R.scoring.moon && d.moon == null) {
    const shooter = d.points.findIndex((p) => p === g.totalPoints && p > 0);
    if (shooter >= 0) {
      // the shooter chooses: everyone else +26, or 26 off their own score
      s.phase = 'moon';
      s.turn = shooter;
      return;
    }
  }
  const { deltas, lines } = roundScores(g, s);
  deltas.forEach((v, ti) => (d.scores[ti] += v));
  teamsFor(g, s.players.length).forEach((_, ti) => lines.push(`${teamName(g, s, ti)}: ${deltas[ti] >= 0 ? '+' : ''}${deltas[ti]} → ${d.scores[ti]}`));
  d.result = { lines };
  s.turn = null;
  if (g.auction) return endAuctionRound(g, s, deltas, lines);
  const best = lowWins ? Math.min(...d.scores) : Math.max(...d.scores);
  const reached = R.end.deals
    ? d.round + 1 >= Number(s.options.deals ?? R.end.deals)
    : R.end.rounds
      ? d.round + 1 >= totalRounds(g, s)
      : lowWins
        ? Math.max(...d.scores) >= target(g, s)
        : best >= target(g, s);
  const tied = d.scores.filter((x) => x === best).length > 1;
  // a side down at `loseAt` ends the game: the best of the rest win (as long as they're level)
  const loseAt = R.end.loseAt;
  if (!reached && !lowWins && loseAt != null && d.scores.some((x) => x <= loseAt)) {
    const teams = teamsFor(g, s.players.length);
    for (const ti of teams.keys()) if (d.scores[ti] <= loseAt) lines.push(`${teamName(g, s, ti)} drop to ${d.scores[ti]} and lose`);
    s.winner = teams.flatMap((t, ti) => (d.scores[ti] === best ? t : []));
    s.phase = 'gameOver';
    return;
  }
  if (reached && tied && !lowWins && !R.end.rounds && !R.end.deals) {
    // sides level at the top: play another hand to settle it
    lines.push(`Level at ${best} — play another hand`);
    s.phase = 'roundOver';
  } else if (reached) {
    const teams = teamsFor(g, s.players.length);
    s.winner = teams.flatMap((t, ti) => (d.scores[ti] === best ? t : []));
    s.phase = 'gameOver';
  } else s.phase = 'roundOver';
}

/**
 * 500: a side wins by reaching the target with a successful bid (unless the `bidToWin` option is
 * off, when any side reaching it wins); a side at the `loseAt` score loses.
 */
function endAuctionRound(g: TrickGame, s: S, deltas: number[], lines: string[]) {
  const d = s.data;
  const teams = teamsFor(g, s.players.length);
  const makers = teamOf(g, s, d.maker!);
  const bidToWin = s.options.bidToWin ?? true;
  let winners: number[] = [];
  // (five-handed, the partner wins with the contractor if they get there too)
  const makerSides = [makers, ...(d.partner != null ? [teamOf(g, s, d.partner)] : [])];
  const reached = makerSides.filter((ti) => deltas[ti] > 0 && d.scores[ti] >= target(g, s));
  if (reached.length) winners = reached;
  else if (!bidToWin) {
    const best = Math.max(...d.scores);
    if (best >= target(g, s)) winners = teams.map((_, ti) => ti).filter((ti) => d.scores[ti] === best);
  }
  const loseAt = g.R.end.loseAt;
  if (!winners.length && loseAt != null && d.scores.some((x) => x <= loseAt)) {
    winners = teams.map((_, ti) => ti).filter((ti) => d.scores[ti] > loseAt);
    for (const ti of teams.keys()) if (d.scores[ti] <= loseAt) lines.push(`${teamName(g, s, ti)} go out the back door at ${d.scores[ti]}`);
  }
  if (bidToWin && !winners.length && d.scores.some((x, ti) => x >= target(g, s) && ti !== makers))
    lines.push(`(A side has to make a bid to win — reaching ${target(g, s)} on defence isn't enough)`);
  if (winners.length) {
    s.winner = winners.flatMap((ti) => teams[ti]);
    s.phase = 'gameOver';
  } else s.phase = 'roundOver';
}
