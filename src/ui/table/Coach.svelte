<script lang="ts">
  import SuitText from '../components/SuitText.svelte';
  import type { GameStatus } from '../../engine/types';

  /**
   * A private note on your last move, under the middle (a coach, in a practice game): its title
   * marked by how it went, and a line or two. Only the player it's for is sent it.
   */
  let { coach, h = $bindable(0) }: { coach: NonNullable<GameStatus['coach']>; h?: number } = $props();
  const MARK = { good: '✓', fair: '~', off: '✗', info: 'i' } as const;
</script>

<section class="coach {coach.tone}" aria-live="polite" bind:clientHeight={h}>
  <p class="title"><span class="mark" aria-hidden="true">{MARK[coach.tone]}</span><SuitText text={coach.title} /></p>
  {#each coach.lines as line, i (i)}<p class="line"><SuitText text={line} /></p>{/each}
</section>

<style>
  .coach {
    position: relative;
    z-index: 3;
    margin: 0;
    max-width: min(34rem, calc(100% - 16px));
    padding: 0.35rem 0.8rem 0.4rem;
    border-radius: 14px;
    border-left: 4px solid var(--ink-faint);
    background: rgba(0, 0, 0, 0.32);
    color: var(--ink);
    font-size: 0.8rem;
    line-height: 1.3;
  }
  .coach.good {
    border-left-color: var(--good);
  }
  .coach.fair {
    border-left-color: var(--gold);
  }
  .coach.off {
    border-left-color: var(--danger);
  }
  p {
    margin: 0;
  }
  .title {
    font-weight: 700;
  }
  .mark {
    display: inline-block;
    min-width: 1.1em;
    font-weight: 800;
  }
  .good .mark {
    color: var(--good);
  }
  .fair .mark {
    color: var(--gold);
  }
  .off .mark {
    color: var(--danger);
  }
  .line {
    color: var(--ink-dim);
  }
</style>
