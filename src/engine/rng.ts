/**
 * The game's dice: every shuffle and deal comes from here.
 *
 * sfc32, a small, fast generator that passes the standard statistical test batteries (PractRand,
 * TestU01 BigCrush), with 128 bits of state kept in the game state (`GameState.rng`, four 32-bit
 * words) so it serialises, backs up and replays with the game. A new game is seeded with 128 bits
 * from the browser's cryptographic random source, so nobody can work out the seed (and with it
 * every hand) from the cards they see: there are 2^128 possible starts, against the 2^32 a
 * single-number seed would allow, which a laptop can search in hours.
 *
 * Seeds can also be plain numbers (tests, replays): they're spread over the four words.
 */

export type RngState = number[];
export type Seed = number | RngState;

/** A fresh, unguessable seed. */
export function randomSeed(): RngState {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a];
}

/** The four words of state for a seed (a number is spread over them with splitmix32). */
export function seedState(seed: Seed): RngState {
  let words: number[];
  if (typeof seed === 'number') {
    let x = seed >>> 0;
    words = [0, 0, 0, 0].map((): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    });
  } else words = [0, 1, 2, 3].map((i) => (seed[i] ?? 0) >>> 0);
  // (never all zero; then stir, as sfc32's authors advise)
  if (!words.some((w) => w !== 0)) words[3] = 1;
  const state = { rng: words };
  for (let i = 0; i < 12; i++) next32(state);
  return state.rng;
}

/** The next 32 random bits. */
function next32(state: { rng: RngState | number }): number {
  // (a game saved with the old single-number state carries on from it)
  if (typeof state.rng === 'number') state.rng = seedState(state.rng);
  const r = state.rng as RngState;
  let [a, b, c, d] = r;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  r[0] = a >>> 0;
  r[1] = b >>> 0;
  r[2] = c >>> 0;
  r[3] = d >>> 0;
  return t >>> 0;
}

/** A random number in [0, 1), with the full 53 bits of precision a double holds. */
export function nextRandom(state: { rng: RngState | number }): number {
  const hi = next32(state) >>> 5; // 27 bits
  const lo = next32(state) >>> 6; // 26 bits
  return (hi * 67108864 + lo) / 9007199254740992;
}

/** In-place Fisher–Yates shuffle driven by the game's RNG: every order equally likely. */
export function shuffle<T>(arr: T[], state: { rng: RngState | number }): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * A number tied to this game's dice, for bots that want a repeatable roll (the same situation
 * gives the same choice) without drawing from the deck's random stream.
 */
export function rngSalt(state: { rng: RngState | number }): number {
  return typeof state.rng === 'number' ? state.rng % 997 : (state.rng[0] ?? 0) % 997;
}
