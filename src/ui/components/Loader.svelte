<script lang="ts">
  /**
   * The Lamplight loader: a card that floats up and turns over, showing the home screen's hand
   * (A♠ K♥ Q♦ J♣) one turn at a time, on the table's own card back. Its styles (the `.lc` rules)
   * and suit shapes live in index.html, because the first screen shows it before any of the app
   * has downloaded; this draws the same thing from then on.
   */
  interface Props {
    /** Card width in px (it's 1.4 times as tall). */
    size?: number;
    /** Read to screen readers; leave it out when text beside the loader already says what's happening. */
    label?: string;
  }
  let { size = 48, label }: Props = $props();

  const RED = '#c8323c';
  const INK = '#1b1d22';
  const FACES = [
    { rank: 'A', suit: 'S', colour: INK, court: false },
    { rank: 'K', suit: 'H', colour: RED, court: true },
    { rank: 'Q', suit: 'D', colour: RED, court: true },
    { rank: 'J', suit: 'C', colour: INK, court: true },
  ];
  // under this size only the big suit reads, so the corners and court frames go
  const small = $derived(size < 28);
</script>

<span class="lc" class:lc-small={small} style:--lc-w="{size}px" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
  <span class="lc-glow"></span>
  <span class="lc-shadow"></span>
  <span class="lc-float">
    <span class="lc-card">
      <span class="lc-back"></span>
      <span class="lc-front">
        <span class="lc-strip">
          {#each FACES as f (f.rank)}
            <span class="lc-face" style:color={f.colour}>
              <span class="lc-corner">{f.rank}<svg><use href="#lc-{f.suit}" /></svg></span>
              {#if f.court}
                <span class="lc-court"><i>{f.rank}</i><svg><use href="#lc-{f.suit}" /></svg></span>
              {:else}
                <svg class="lc-ace"><use href="#lc-{f.suit}" /></svg>
              {/if}
              <span class="lc-corner lc-end">{f.rank}<svg><use href="#lc-{f.suit}" /></svg></span>
            </span>
          {/each}
        </span>
      </span>
    </span>
  </span>
</span>
