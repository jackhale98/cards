import { describe, expect, it } from 'vitest';
import { bankerDraws, baccaratTotal, type BaccaratData } from '../src/engine/families/baccarat';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from '../src/games';

const g = GAMES.baccarat as GameModule<BaccaratData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const ids = (s: GameState<any>, z: string) => s.zones[z].cards.map((c) => c.id);

/** Run the house's dealing steps until the coup is settled. */
function deal(s: GameState<BaccaratData>) {
  for (let i = 0; i < 10 && s.phase === 'deal'; i++) g.system!(s)!.run(s);
}
/** Stack the shoe so these cards come off the top in order (Player, Banker, Player, Banker, …). */
function stack(s: GameState<BaccaratData>, order: string[]) {
  const rest = s.zones.deck.cards.filter((c) => !order.includes(c.id));
  s.zones.deck.cards = [...rest, ...[...order].reverse().map((id) => ({ id }))];
}

describe('baccarat (pagat: punto banco)', () => {
  it('counts only the last digit, faces and tens nothing', () => {
    expect(baccaratTotal(['7H', '8S'])).toBe(5);
    expect(baccaratTotal(['KH', 'TS'])).toBe(0);
    expect(baccaratTotal(['AH', '8S'])).toBe(9);
    expect(baccaratTotal(['9H', '9S', '3C'])).toBe(1);
  });

  it('banker drawing table', () => {
    expect(bankerDraws(5, null)).toBe(true);
    expect(bankerDraws(6, null)).toBe(false);
    expect(bankerDraws(2, 9)).toBe(true);
    expect(bankerDraws(3, 8)).toBe(false);
    expect(bankerDraws(3, 9)).toBe(true);
    expect(bankerDraws(4, 1)).toBe(false);
    expect(bankerDraws(4, 7)).toBe(true);
    expect(bankerDraws(5, 3)).toBe(false);
    expect(bankerDraws(5, 4)).toBe(true);
    expect(bankerDraws(6, 6)).toBe(true);
    expect(bankerDraws(6, 5)).toBe(false);
    expect(bankerDraws(7, 7)).toBe(false);
  });

  it('a natural stands; Banker pays less 5% commission', () => {
    const s = g.setup(people(2), 1, {});
    g.apply(s, 0, { type: 'betBanker', amount: 100 });
    g.apply(s, 1, { type: 'betPlayer', amount: 100 });
    expect(s.phase).toBe('deal');
    // Player 3 + 2 = 5, Banker 4 + 5 = 9 (natural): no third cards
    stack(s, ['3H', '4H', '2H', '5H']);
    deal(s);
    expect(ids(s, 'player')).toEqual(['3H', '2H']);
    expect(ids(s, 'banker')).toEqual(['4H', '5H']);
    expect(s.data.outcome).toBe('banker');
    expect(s.players[0].chips).toBe(1095);
    expect(s.players[1].chips).toBe(900);
  });

  it('player draws on 5; banker on 3 stands against an 8', () => {
    const s = g.setup(people(1), 2, {});
    g.apply(s, 0, { type: 'betPlayer', amount: 50 });
    // Player 3 + 2 = 5 draws an 8 → 3; Banker K + 3 = 3 stands against the 8 → Player 3 vs Banker 3: a tie
    stack(s, ['3H', 'KH', '2H', '3S', '8C']);
    deal(s);
    expect(ids(s, 'player')).toEqual(['3H', '2H', '8C']);
    expect(ids(s, 'banker')).toEqual(['KH', '3S']);
    expect(s.data.outcome).toBe('tie');
    expect(s.players[0].chips).toBe(1000); // pushed
  });

  it('player stands on 6; banker draws on 5; a tie pays 8:1', () => {
    const s = g.setup(people(1), 3, {});
    g.apply(s, 0, { type: 'betTie', amount: 10 });
    // Player 6 stands; Banker 5 draws an A → 6: tie
    stack(s, ['4H', '2C', '2H', '3C', 'AD']);
    deal(s);
    expect(ids(s, 'banker')).toEqual(['2C', '3C', 'AD']);
    expect(s.data.outcome).toBe('tie');
    expect(s.players[0].chips).toBe(1080);
    expect(s.phase).toBe('roundOver');
  });

  it('bots play the set number of rounds', () => {
    const s = g.setup([...people(1), { name: 'B', bot: true }, { name: 'C', bot: true }], 9, { rounds: 5 });
    for (let i = 0; i < 200 && s.phase !== 'gameOver'; i++) {
      if (s.phase === 'deal') deal(s);
      else if (s.phase === 'roundOver') g.apply(s, 0, { type: 'next' });
      else for (const p of s.players) if (s.data.bets[p.seat] === null) g.apply(s, p.seat, p.seat ? g.bot!(s, p.seat)! : { type: 'betBanker', amount: 10 });
    }
    expect(s.phase).toBe('gameOver');
    expect(s.data.round).toBe(5);
  });
});
