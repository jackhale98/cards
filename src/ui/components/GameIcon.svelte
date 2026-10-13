<script lang="ts">
  /**
   * Picture for a game on the game picker: a small scene drawn in the same style as the real
   * cards, showing what the game is about. Games without a drawing here fall back to the
   * `icon` glyph from their game.json, so a newly added game still shows something.
   */
  interface Props {
    /** Game id (the folder name in src/games). */
    id: string;
    /** Fallback glyph from game.json. */
    icon: string;
    /** Rendered size in px. */
    size?: number;
  }
  let { id, icon, size = 40 }: Props = $props();

  const DRAWN = new Set([
    'holdem',
    'omaha',
    'hearts',
    'spades',
    'euchre',
    'five-hundred',
    'cribbage',
    'bridge',
    'gin-rummy',
    'oh-hell',
    'freetable',
    'crazy-eights',
    'rummy-500',
    'president',
    'canasta',
    'five-card-draw',
    'blackjack',
    'cheat',
    'go-fish',
    'seven-card-stud',
    'baccarat',
    'pinochle',
    'whist',
    'hand-and-foot',
    'kings-corners',
    'palace',
  ]);

  // Suit shapes in a 100-unit box centred on the origin.
  const SPADE =
    'M0,-44 C6,-32 46,-12 46,8 C46,22 35,30 23,30 C15,30 8,26 4,20 C5,30 9,38 16,44 L-16,44 C-9,38 -5,30 -4,20 C-8,26 -15,30 -23,30 C-35,30 -46,22 -46,8 C-46,-12 -6,-32 0,-44Z';
  const HEART = 'M0,40 C-16,26 -46,6 -46,-14 C-46,-30 -34,-40 -22,-40 C-11,-40 -3,-33 0,-25 C3,-33 11,-40 22,-40 C34,-40 46,-30 46,-14 C46,6 16,26 0,40Z';
  const DIAMOND = 'M0,-46 C10,-28 24,-12 38,0 C24,12 10,28 0,46 C-10,28 -24,12 -38,0 C-24,-12 -10,-28 0,-46Z';
  const STAR = '0,-9 2.23,-3.07 8.56,-2.78 3.61,1.17 5.29,7.28 0,3.8 -5.29,7.28 -3.61,1.17 -8.56,-2.78 -2.23,-3.07';

  const RED = '#c8323c';
  const INK = '#1b1d22';
  const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";

  type Suit = 'S' | 'H' | 'D' | 'C';
  const HOLES = [11, 16, 21, 26, 31, 36, 41, 46, 51];
</script>

<!-- A suit, `s` px wide, with its top-left corner at (x, y). -->
{#snippet suit(k: Suit, x: number, y: number, s: number, fill: string)}
  <g transform="translate({x + s / 2} {y + s / 2}) scale({s / 100})" {fill}>
    {#if k === 'S'}
      <path d={SPADE} />
    {:else if k === 'H'}
      <path d={HEART} />
    {:else if k === 'D'}
      <path d={DIAMOND} />
    {:else}
      <circle cx="0" cy="-20" r="20" /><circle cx="-22" cy="10" r="20" /><circle cx="22" cy="10" r="20" />
      <circle cx="0" cy="4" r="12" /><path d="M-6,4 L6,4 C6,24 10,36 16,44 L-16,44 C-10,36 -6,24 -6,4Z" />
    {/if}
  </g>
{/snippet}

<!-- Card face or back, `w` px wide, top-left at (x, y). -->
{#snippet face(x: number, y: number, w: number)}
  <g transform="translate({x} {y}) scale({w / 23.5})">
    <rect x="1.4" y="2" width="22" height="31" rx="3" fill="#000" opacity="0.3" />
    <rect x="0.4" y="0.4" width="21.2" height="30.2" rx="2.8" fill="#fbf8f1" stroke="#d6cbb4" stroke-width="0.8" />
  </g>
{/snippet}
{#snippet back(x: number, y: number, w: number)}
  <g transform="translate({x} {y}) scale({w / 23.5})">
    <rect x="1.4" y="2" width="22" height="31" rx="3" fill="#000" opacity="0.3" />
    <rect width="22" height="31" rx="3" fill="#23395b" />
    <rect x="2.6" y="2.6" width="16.8" height="25.8" rx="1.6" fill="none" stroke="#c99a2e" stroke-width="0.9" />
    <path d="M5,7 L17,24 M17,7 L5,24" stroke="#c99a2e" stroke-opacity="0.4" stroke-width="0.7" />
  </g>
{/snippet}

<!-- Standard-size card centred on the current origin. -->
{#snippet card()}{@render face(-11, -15.5, 23.5)}{/snippet}
{#snippet cardBack()}{@render back(-11, -15.5, 23.5)}{/snippet}

<!-- Rank and suit in a standard card's top-left corner. -->
{#snippet corner(rank: string, k: Suit, fill: string)}
  <text x="-7" y="-6" font-size="8.5" font-weight="700" text-anchor="middle" {fill} font-family={SERIF}>{rank}</text>
  {@render suit(k, -9.5, -4.6, 5, fill)}
{/snippet}

<!-- Court card (jack) with its framed centre. -->
{#snippet jack(k: Suit)}
  {@render card()}
  {@render corner('J', k, INK)}
  <rect x="-4.5" y="-7.5" width="12" height="17" rx="1" fill="#e9c46a" fill-opacity="0.22" stroke={INK} stroke-width="0.6" />
  <text x="1.5" y="4" font-size="10" font-style="italic" font-weight="700" text-anchor="middle" fill={INK} font-family={SERIF}>J</text>
{/snippet}

<!-- Court card with its framed centre, for any rank. -->
{#snippet court(rank: string, k: Suit, fill: string)}
  {@render card()}
  {@render corner(rank, k, fill)}
  <rect x="-4.5" y="-7.5" width="12" height="17" rx="1" fill="#e9c46a" fill-opacity="0.22" stroke={fill} stroke-width="0.6" />
  <text x="1.5" y="4" font-size="10" font-style="italic" font-weight="700" text-anchor="middle" {fill} font-family={SERIF}>{rank}</text>
{/snippet}

<!-- Small card face or back, `w` px wide, centred on the current origin. -->
{#snippet smallFace(w: number)}{@render face((-w * 11) / 23.5, (-w * 15.5) / 23.5, w)}{/snippet}
{#snippet smallBack(w: number)}{@render back((-w * 11) / 23.5, (-w * 15.5) / 23.5, w)}{/snippet}

<!-- A gold score tag. -->
{#snippet tag(x: number, y: number, w: number, label: string)}
  <rect x={x + 1.5} y={y + 2} width={w} height="14" rx="4" fill="#000" opacity="0.3" />
  <rect {x} {y} width={w} height="14" rx="4" fill="#e9c46a" />
  <text x={x + w / 2} y={y + 10.5} font-size="10" font-weight="700" text-anchor="middle" fill="#2a1d05" font-family={SERIF}>{label}</text>
{/snippet}

{#snippet chip(cx: number, cy: number)}
  <g transform="translate({cx} {cy})">
    <circle cy="1.3" r="8.6" fill="#000" opacity="0.3" />
    <circle r="8" fill={RED} />
    <circle r="8" fill="none" stroke="#fbf8f1" stroke-width="2.4" stroke-dasharray="3.14 3.14" />
    <circle r="4.6" fill="none" stroke="#fbf8f1" stroke-opacity="0.75" stroke-width="0.9" />
  </g>
{/snippet}

{#if DRAWN.has(id)}
  <svg class="game-icon" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
    {#if id === 'holdem'}
      <g transform="translate(25 31) rotate(-12)">{@render cardBack()}</g>
      <g transform="translate(37 30) rotate(10)">{@render cardBack()}</g>
      {@render chip(48, 48)}
    {:else if id === 'omaha'}
      {#each [-27, -9, 9, 27] as a (a)}
        <g transform="translate(29 60) rotate({a}) translate(0 -27)">{@render back(-9.4, -13.2, 20)}</g>
      {/each}
      {@render chip(50, 50)}
    {:else if id === 'hearts'}
      <g transform="translate(25 31) rotate(-10)">
        {@render card()}
        {@render corner('Q', 'S', INK)}
        {@render suit('S', -4, -2, 12, INK)}
      </g>
      {@render suit('H', 30, 25, 30, '#14110b')}
      {@render suit('H', 31.5, 26.5, 27, RED)}
    {:else if id === 'spades'}
      <g transform="translate(25 31) rotate(-10)">{@render cardBack()}</g>
      <g transform="translate(38 31) rotate(8)">
        {@render card()}
        {@render corner('A', 'S', INK)}
        {@render suit('S', -6.5, -4, 15, INK)}
      </g>
    {:else if id === 'euchre'}
      <g transform="translate(25 31) rotate(-10)">{@render jack('C')}</g>
      <g transform="translate(38 31) rotate(9)">{@render jack('S')}</g>
    {:else if id === 'five-hundred'}
      <g transform="translate(23 36) rotate(-16)">{@render cardBack()}</g>
      <g transform="translate(37 30) rotate(8)">
        {@render card()}
        <polygon transform="translate(-7 -9.5) scale(0.32)" points={STAR} fill="#6b3fa0" />
        <polygon transform="translate(0.5 1.5) scale(1.05)" points={STAR} fill="#6b3fa0" />
      </g>
    {:else if id === 'cribbage'}
      <g transform="translate(45 17) rotate(14)">
        {@render card()}
        {@render corner('5', 'H', RED)}
      </g>
      <rect x="6.5" y="23.5" width="52" height="22" rx="5" fill="#000" opacity="0.3" />
      <rect x="5" y="21" width="52" height="22" rx="5" fill="#9c6a38" />
      <rect x="7.5" y="23.5" width="47" height="17" rx="3" fill="#b98448" />
      <g fill="#5b3818">
        {#each HOLES as x (x)}<circle cx={x} cy="29" r="1.15" /><circle cx={x} cy="35" r="1.15" />{/each}
      </g>
      {#each [[26, 29, RED], [41, 35, '#3b82c4']] as [x, y, c] (c)}
        <circle cx={+x + 0.6} cy={+y + 0.8} r="2.8" fill="#000" opacity="0.3" />
        <circle cx={x} cy={y} r="2.7" fill={String(c)} />
        <circle cx={+x - 0.8} cy={+y - 0.8} r="0.9" fill="#fff" opacity="0.5" />
      {/each}
    {:else if id === 'bridge'}
      <g transform="translate(23 24) rotate(-12)">{@render card()}{@render suit('H', -5, -7, 11, RED)}</g>
      <g transform="translate(41 24) rotate(10)">{@render card()}{@render suit('S', -5, -7, 11, INK)}</g>
      <rect x="14.5" y="33.5" width="38" height="21" rx="4" fill="#000" opacity="0.3" />
      <rect x="13" y="31.5" width="38" height="21" rx="4" fill="#fbf8f1" stroke="#d6cbb4" stroke-width="0.8" />
      <text x="32" y="46.5" font-size="13" font-weight="700" text-anchor="middle" fill={INK} font-family={SERIF}>3NT</text>
    {:else if id === 'gin-rummy'}
      {#each [['5', -20], ['6', 0], ['7', 20]] as [r, a] (r)}
        <g transform="translate(32 62) rotate({a}) translate(0 -29)">
          {@render card()}
          {@render corner(String(r), 'H', RED)}
          {#if r === '7'}{@render suit('H', -3, -2, 11, RED)}{/if}
        </g>
      {/each}
    {:else if id === 'oh-hell'}
      {#each [[16, 42], [32, 42], [32, 35], [48, 42], [48, 35], [48, 28]] as [x, y] (`${x},${y}`)}
        <g transform="translate({x} {y})">{@render back(-7, -10, 15)}</g>
      {/each}
    {:else if id === 'freetable'}
      <g transform="translate(20 27) rotate(-24)">{@render cardBack()}</g>
      <g transform="translate(42 24) rotate(16)">
        {@render card()}
        {@render corner('A', 'S', INK)}
        {@render suit('S', -4, -2, 11, INK)}
      </g>
      <g transform="translate(31 44) rotate(-8)">
        {@render card()}
        {@render corner('3', 'H', RED)}
        {@render suit('H', -4, -2, 11, RED)}
      </g>
    {:else if id === 'rummy-500'}
      <!-- a run laid down on the table, and the score everyone's racing to -->
      {#each [['7', 15], ['8', 27], ['9', 39]] as [r, x] (r)}
        <g transform="translate({x} 25) rotate(-4)">
          {@render card()}
          {@render corner(String(r), 'C', INK)}
          {#if r === '9'}{@render suit('C', -4, -2, 11, INK)}{/if}
        </g>
      {/each}
      <rect x="20.5" y="44.5" width="30" height="15" rx="4" fill="#000" opacity="0.3" />
      <rect x="19" y="42.5" width="30" height="15" rx="4" fill="#e9c46a" />
      <text x="34" y="53.6" font-size="10.5" font-weight="700" text-anchor="middle" fill="#2a1d05" font-family={SERIF}>500</text>
    {:else if id === 'five-card-draw'}
      <!-- three kings kept, two fresh cards coming in from the draw -->
      <g transform="translate(46 20) rotate(22)">{@render back(-9.4, -13.2, 20)}</g>
      <g transform="translate(39 15) rotate(10)">{@render back(-9.4, -13.2, 20)}</g>
      {#each [[-16, 'S', INK], [0, 'H', RED], [16, 'D', RED]] as [a, k, fill] (a)}
        <g transform="translate(26 66) rotate({a}) translate(0 -26)">
          {@render card()}
          {@render corner('K', k as Suit, fill as string)}
          {@render suit(k as Suit, -3, -1, 10, fill as string)}
        </g>
      {/each}
    {:else if id === 'blackjack'}
      <!-- the natural: an ace and a king, with a chip riding on it -->
      <g transform="translate(25 32) rotate(-10)">{@render card()}{@render corner('A', 'S', INK)}{@render suit('S', -5, -3, 13, INK)}</g>
      <g transform="translate(37 34) rotate(9)">
        {@render card()}
        {@render corner('K', 'H', RED)}
        <rect x="-4.5" y="-7.5" width="12" height="17" rx="1" fill="#e9c46a" fill-opacity="0.22" stroke={RED} stroke-width="0.6" />
        <text x="1.5" y="4" font-size="10" font-style="italic" font-weight="700" text-anchor="middle" fill={RED} font-family={SERIF}>K</text>
      </g>
      {@render chip(48, 50)}
    {:else if id === 'cheat'}
      <!-- cards slapped face down on the pile, and someone calling it -->
      <g transform="translate(26 40) rotate(-14)">{@render cardBack()}</g>
      <g transform="translate(31 38) rotate(6)">{@render cardBack()}</g>
      <g transform="translate(44 17)">
        <path
          d="M-13,-9 h26 a4,4 0 0 1 4,4 v10 a4,4 0 0 1 -4,4 h-14 l-6,6 l1,-6 h-7 a4,4 0 0 1 -4,-4 v-10 a4,4 0 0 1 4,-4z"
          fill="#000"
          opacity="0.3"
          transform="translate(0.8 1.2)"
        />
        <path
          d="M-13,-9 h26 a4,4 0 0 1 4,4 v10 a4,4 0 0 1 -4,4 h-14 l-6,6 l1,-6 h-7 a4,4 0 0 1 -4,-4 v-10 a4,4 0 0 1 4,-4z"
          fill="#fbf8f1"
          stroke="#d6cbb4"
          stroke-width="0.8"
        />
        <text x="0" y="5" font-size="12" font-weight="800" text-anchor="middle" fill={RED} font-family={SERIF}>?!</text>
      </g>
    {:else if id === 'go-fish'}
      <!-- a card held up, and a fish jumping out of the pond -->
      <g transform="translate(24 34) rotate(-10)">{@render card()}{@render corner('7', 'H', RED)}{@render suit('H', -5, -3, 13, RED)}</g>
      <ellipse cx="42" cy="54" rx="17" ry="4.5" fill="#23395b" opacity="0.9" />
      <g transform="translate(42 38) rotate(-28)">
        <path d="M-12,0 C-6,-8 6,-8 10,0 C6,8 -6,8 -12,0Z" fill="#000" opacity="0.3" transform="translate(0.8 1.2)" />
        <path d="M-12,0 C-6,-8 6,-8 10,0 C6,8 -6,8 -12,0Z" fill="#e9c46a" stroke="#a87b1c" stroke-width="0.8" />
        <path d="M9,0 L17,-6 L15,0 L17,6Z" fill="#e9c46a" stroke="#a87b1c" stroke-width="0.8" stroke-linejoin="round" />
        <circle cx="-6" cy="-1.5" r="1.4" fill={INK} />
        <path d="M-1,-5 C1,-1 1,1 -1,5" fill="none" stroke="#a87b1c" stroke-width="0.8" />
      </g>
    {:else if id === 'president'}
      <!-- the top cards (a pair of 2s) wearing the crown -->
      <g transform="translate(25 38) rotate(-9)">{@render card()}{@render corner('2', 'S', INK)}{@render suit('S', -4, -2, 11, INK)}</g>
      <g transform="translate(38 38) rotate(8)">{@render card()}{@render corner('2', 'H', RED)}{@render suit('H', -4, -2, 11, RED)}</g>
      <g transform="translate(32 13)">
        <path d="M-12.5,6.5 L-14,-6 L-6.5,0.5 L0,-9 L6.5,0.5 L14,-6 L12.5,6.5Z" fill="#000" opacity="0.3" transform="translate(0.8 1.2)" />
        <path d="M-12.5,6.5 L-14,-6 L-6.5,0.5 L0,-9 L6.5,0.5 L14,-6 L12.5,6.5Z" fill="#e9c46a" stroke="#a87b1c" stroke-width="0.8" stroke-linejoin="round" />
        <rect x="-12.5" y="5" width="25" height="3.4" rx="1" fill="#c99a2e" />
        {#each [-14, 0, 14] as x (x)}<circle cx={x} cy={x === 0 ? -9.5 : -6.5} r="1.6" fill="#fbf8f1" />{/each}
        <circle cy="2" r="1.5" fill={RED} />
      </g>
    {:else if id === 'canasta'}
      <!-- a canasta squared up with a red card on top, and a wild joker leaning on it -->
      {#each [6, 5, 4, 3, 2, 1] as k (k)}
        <g transform="translate({26 + k * 0.9} {33 + k * 1.1})">{@render face(-11, -15.5, 23.5)}</g>
      {/each}
      <g transform="translate(26 33)">{@render card()}{@render corner('K', 'H', RED)}{@render suit('H', -4, -2, 11, RED)}</g>
      <g transform="translate(44 30) rotate(14)">
        {@render card()}
        <polygon transform="translate(0.5 1.5) scale(1.05)" points={STAR} fill="#6b3fa0" />
        <text x="-7" y="-6" font-size="6" font-weight="700" text-anchor="middle" fill="#6b3fa0" font-family={SERIF}>JK</text>
      </g>
    {:else if id === 'seven-card-stud'}
      <!-- the stud row: two down, then sevens showing for everyone to read -->
      {#each [12, 21] as x (x)}<g transform="translate({x} 27)">{@render smallBack(18)}</g>{/each}
      {#each [[31, 'S', INK], [41, 'H', RED], [51, 'D', RED]] as [x, k, fill] (x)}
        <g transform="translate({x} 28) scale(0.77)">
          {@render card()}
          {@render corner('7', k as Suit, fill as string)}
          {@render suit(k as Suit, -4, -1, 11, fill as string)}
        </g>
      {/each}
      {@render chip(32, 51)}
    {:else if id === 'baccarat'}
      <!-- the dealing shoe, with a natural nine sliding out of its sloped front -->
      <path d="M8,52 L56,52 L56,20 L22,34 Q8,40 8,46Z" fill="#000" opacity="0.3" transform="translate(1.2 1.8)" />
      <path d="M8,52 L56,52 L56,20 L22,34 Q8,40 8,46Z" fill="#6e1c27" />
      <path d="M22,34 L56,20 L56,27 L26,39Z" fill="#932c39" />
      <path d="M22,34 L56,20" stroke="#e9c46a" stroke-width="1.4" stroke-linecap="round" />
      <rect x="40" y="38" width="10" height="6" rx="1.5" fill="#e9c46a" opacity="0.85" />
      <g transform="translate(22 30) rotate(-22)">
        {@render card()}
        {@render corner('9', 'D', RED)}
        {@render suit('D', -4, -2, 12, RED)}
      </g>
    {:else if id === 'pinochle'}
      <!-- the pinochle itself: queen of spades and jack of diamonds -->
      <g transform="translate(24 28) rotate(-10)">{@render court('Q', 'S', INK)}</g>
      <g transform="translate(39 28) rotate(9)">{@render court('J', 'D', RED)}</g>
      {@render tag(22, 46, 20, '40')}
    {:else if id === 'whist'}
      <!-- a trick in the middle: one card from each player -->
      {#each [[18, 32, 90, 'D', RED], [46, 32, 90, 'H', RED], [32, 18, 0, 'S', INK], [32, 46, 0, 'C', INK]] as [x, y, r, k, fill] (k)}
        <g transform="translate({x} {y}) rotate({r})">
          {@render smallFace(16)}
          <g transform="rotate({-Number(r)})">{@render suit(k as Suit, -5, -5, 10, fill as string)}</g>
        </g>
      {/each}
    {:else if id === 'hand-and-foot'}
      <!-- the hand in a fan, and the foot waiting in its pile -->
      {#each [3, 2, 1] as k (k)}<g transform="translate({44 + k * 0.8} {34 + k * 1.2})">{@render smallBack(20)}</g>{/each}
      <g transform="translate(44 34)">
        {@render smallFace(20)}
        <g fill="#7a4a2a">
          <ellipse cx="0.5" cy="3" rx="4.2" ry="6.2" />
          <circle cx="-3.2" cy="-5.2" r="1.7" />
          <circle cx="-0.6" cy="-6.6" r="1.5" />
          <circle cx="1.9" cy="-6.4" r="1.3" />
          <circle cx="3.9" cy="-5.2" r="1.1" />
          <circle cx="5.3" cy="-3.4" r="0.95" />
        </g>
      </g>
      {#each [-22, -6, 10] as a (a)}
        <g transform="translate(18 60) rotate({a}) translate(0 -22)">{@render smallBack(18)}</g>
      {/each}
    {:else if id === 'kings-corners'}
      <!-- the draw pile in the middle, kings in the four corners -->
      <g transform="translate(32 32)">{@render smallBack(17)}</g>
      {#each [[16, 16, -45, 'H', RED], [48, 16, 45, 'S', INK], [48, 48, -45, 'D', RED], [16, 48, 45, 'C', INK]] as [x, y, r, k, fill] (k)}
        <g transform="translate({x} {y}) rotate({r})">
          {@render smallFace(15)}
          <text x="0" y="3.6" font-size="10" font-weight="700" text-anchor="middle" fill={String(fill)} font-family={SERIF}>K</text>
          {@render suit(k as Suit, -2, 4.6, 4, fill as string)}
        </g>
      {/each}
    {:else if id === 'palace'}
      <!-- the palace: three face-down cards, three face-up on top, and a flag flying -->
      <path d="M32,6 L32,22" stroke="#7a4a2a" stroke-width="1.4" stroke-linecap="round" />
      <path d="M32.5,6.5 L43,9.5 L32.5,12.5Z" fill={RED} />
      {#each [14, 32, 50] as x (x)}<g transform="translate({x} 46)">{@render smallBack(17)}</g>{/each}
      {#each [[14, 'H', RED, -4], [32, 'S', INK, 0], [50, 'D', RED, 4]] as [x, k, fill, r] (x)}
        <g transform="translate({x} 36) rotate({r})">
          {@render smallFace(17)}
          {@render suit(k as Suit, -5, -5, 10, fill as string)}
        </g>
      {/each}
    {:else if id === 'crazy-eights'}
      <g transform="translate(32 32) rotate(-6)">
        {@render face(-15, -21.4, 32)}
        {@render suit('S', -13, -19, 6, INK)}
        {@render suit('H', 7, -19, 6, RED)}
        {@render suit('D', -13, 13, 6, RED)}
        {@render suit('C', 7, 13, 6, INK)}
        <text x="1" y="8" font-size="22" font-weight="700" text-anchor="middle" fill={INK} font-family={SERIF}>8</text>
      </g>
    {/if}
  </svg>
{:else}
  <span class="glyph" style:font-size="{size * 0.55}px" style:width="{size}px" style:height="{size}px" aria-hidden="true">{icon}</span>
{/if}

<style>
  .game-icon {
    display: block;
    flex: none;
    overflow: visible;
  }
  .glyph {
    display: grid;
    place-items: center;
    flex: none;
    font-family: var(--font-card);
    color: var(--gold);
    line-height: 1;
  }
</style>
