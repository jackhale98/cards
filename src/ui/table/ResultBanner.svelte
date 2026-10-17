<script lang="ts">
  import { app } from '../../app.svelte';
  import type { GameStatus } from '../../engine/types';
  import { signedTotal, type NightRow } from '../../net/night';
  import SuitText from '../components/SuitText.svelte';
  import { SUPPORT_URL } from '../contact';

  /**
   * A hand's or game's result, over the whole screen, not just the middle of the table: on a short
   * screen (a phone in full screen with the browser's bars, or a small one) the middle can be
   * only a sliver tall.
   */
  let {
    banner,
    recap,
    handDone,
    gameOver,
    history,
    tonight,
    unit = null,
    display,
    replay,
    onhide,
    onscores,
  }: {
    banner: NonNullable<GameStatus['banner']>;
    /** What each player made or lost in the hand (see Table's recap). */
    recap: string | null;
    handDone: boolean;
    gameOver: boolean;
    /** There's a hand-by-hand chart to show. */
    history: boolean;
    /** Tonight's standings, shown when a game ends, and what they count when not places (see nightUnit). */
    tonight: NightRow[];
    unit?: string | null;
    display: boolean;
    replay: boolean;
    onhide: () => void;
    onscores: () => void;
  } = $props();
</script>

<div class="banner panel">
  <button class="close" onclick={onhide} aria-label="Hide">×</button>
  <h2>{banner.title}</h2>
  <div class="lines" class:cols={banner.lines.length > 5}>
    {#each banner.lines as line, k (k)}<p><SuitText text={line} /></p>{/each}
  </div>
  {#if recap}<p class="recap-line">This hand: {recap}</p>{/if}
  {#if (handDone || (gameOver && history)) && !display && !replay}
    <div class="banner-btns">
      {#if handDone}<button class="btn small-btn" onclick={() => app.showReplay(0, 0)}>Replay this hand</button>{/if}
      {#if gameOver && history}<button class="btn small-btn" onclick={onscores}>How it went</button>{/if}
    </div>
  {/if}
  {#if gameOver && tonight.length}
    <!-- top four, so a nine-player night still fits -->
    <p class="tonight">
      Tonight{unit ? `, ${unit}` : ''}: {tonight
        .slice(0, 4)
        .map((r) => `${r.name} ${unit ? signedTotal(r.points) : r.points}`)
        .join(' · ')}{tonight.length > 4 ? ` · +${tonight.length - 4} more` : ''}
    </p>
  {/if}
  {#if gameOver && !display}
    <!-- one quiet line, only when a game is over (never during play) -->
    <p class="support">Enjoyed that? Lamplight is free and ad-free — <a href={SUPPORT_URL} target="_blank" rel="noreferrer">buy us a beer 🍺</a></p>
  {/if}
</div>

<style>
  .banner {
    position: fixed;
    z-index: 5;
    background: rgba(8, 26, 20, 0.94);
    background: color-mix(in srgb, var(--felt-3) 94%, transparent);
    top: calc(50% + (var(--safe-t) - var(--safe-b)) / 2);
    left: calc(50% + (var(--safe-l) - var(--safe-r)) / 2);
    transform: translate(-50%, -50%);
    padding: 0.9rem 1.4rem;
    text-align: center;
    min-width: 16rem;
    max-width: 92%;
    max-height: calc(100vh - 16px - var(--safe-t) - var(--safe-b));
    max-height: calc(100dvh - 16px - var(--safe-t) - var(--safe-b));
    overflow: auto;
    animation: rise 0.35s var(--ease-spring);
  }
  .banner h2 {
    margin: 0 0 0.3rem;
    font-family: var(--font-card);
    font-size: 1.35rem;
    color: var(--gold);
  }
  .banner-btns {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .banner .recap-line {
    color: var(--ink);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .banner p {
    margin: 0.15rem 0;
    font-size: 0.85rem;
    color: var(--ink-dim);
  }
  .banner p.support {
    margin-top: 0.6rem;
    font-size: 0.75rem;
    color: var(--ink-faint);
  }
  .support a {
    color: var(--gold);
  }
  .tonight {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
    color: var(--gold);
    font-weight: 600;
  }
  /* (a short screen and a long list of scores: two columns, so the panel fits without scrolling) */
  @media (max-height: 440px) {
    .lines.cols {
      columns: 2;
      column-gap: 1.6rem;
    }
    .lines.cols p {
      break-inside: avoid;
    }
  }
  .close {
    position: absolute;
    top: 4px;
    right: 8px;
    font-size: 1.2rem;
    color: var(--ink-faint);
    width: 32px;
    height: 32px;
  }
  /* (a 44px target around the small ×) */
  .close::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, -40%) scale(0.95);
    }
  }
</style>
