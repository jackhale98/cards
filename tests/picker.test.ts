import { describe, expect, it } from 'vitest';
import { categoryOf, GAME_LIST, GAMES, misfit, playersText } from './games';

describe('game picker', () => {
  it('sorts every game into a section', () => {
    const by = (c: string) => GAME_LIST.filter((g) => categoryOf(g) === c).map((g) => g.config.id).sort();
    expect(by('Poker')).toEqual(['five-card-draw', 'holdem', 'omaha', 'seven-card-stud']);
    expect(by('Trick-taking')).toEqual(['bridge', 'euchre', 'five-hundred', 'hearts', 'oh-hell', 'pinochle', 'spades', 'whist']);
    expect(by('Rummy')).toEqual(['canasta', 'gin-rummy', 'hand-and-foot', 'rummy-500']);
    expect(by('Shedding')).toEqual(['cheat', 'crazy-eights', 'palace', 'president']);
    expect(by('Casino')).toEqual(['baccarat', 'blackjack']);
    expect(by('Family')).toEqual(['go-fish', 'kings-corners']);
    expect(by('More')).toEqual(['cribbage', 'freetable']);
  });

  it('knows which games suit the people at the table (bots fill the rest)', () => {
    expect(misfit(GAMES.bridge, 1)).toBeNull(); // bots make up the four
    expect(misfit(GAMES.bridge, 5)).toBe('up to 4');
    expect(misfit(GAMES.holdem, 9)).toBeNull();
    expect(misfit(GAMES.canasta, 3)).toBeNull(); // a bot makes four
    expect(misfit(GAMES.freetable, 1)).toBe(GAMES.freetable.config.players.min > 1 ? `needs ${GAMES.freetable.config.players.min}+` : null);
    expect(playersText(GAMES.canasta)).toBe('2–4 or 6');
    expect(playersText(GAMES.euchre)).toBe('4 or 6');
    expect(playersText(GAMES.bridge)).toBe('4');
  });
});
