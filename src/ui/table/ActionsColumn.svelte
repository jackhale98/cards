<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type { GameStatus } from '../../engine/types';
  import type { Frame } from '../../net/protocol';
  import { app } from '../../app.svelte';
  import ActionBar from '../components/ActionBar.svelte';
  import ReplayBar from '../components/ReplayBar.svelte';

  /**
   * What's in the buttons' column: the race to the target (the board itself is on a TV, and in the
   * scores), Replay hand at a hand's end without a result panel (everyone folded, say), and your
   * moves, or in a replay, the replay's controls (there's nothing to do but watch).
   */
  let {
    track,
    colorOf,
    replayHand,
    replay,
    bar,
  }: {
    track: GameStatus['track'];
    /** Each seat's colour (its avatar's). */
    colorOf: (seat: number) => string;
    /** Offer "Replay hand". */
    replayHand: boolean;
    replay: Frame | null;
    bar: ComponentProps<typeof ActionBar>;
  } = $props();
</script>

{#if track}
  <div class="race" aria-label="Score">
    <div class="eyebrow">To {track.target}</div>
    {#each track.lanes as lane (lane.label)}
      {@const lead = lane.score === Math.max(...track.lanes.map((l) => l.score)) && lane.score > 0}
      <div class="race-lane" class:lead style:--c={colorOf(lane.seat)}>
        <span class="ln">{lane.label}</span><b>{lane.score}</b>
      </div>
    {/each}
  </div>
{/if}
{#if replayHand}
  <button class="btn quiet small-btn replay-quick" onclick={() => app.showReplay(0, 0)}>Replay hand</button>
{/if}
{#if replay}<ReplayBar frame={replay} />{:else}<ActionBar {...bar} />{/if}

<style>
  .race {
    flex: none;
    margin-bottom: 0.5rem;
    padding: 0.35rem 0.55rem;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.22);
  }
  .race .eyebrow {
    font-size: 0.7rem;
  }
  .race-lane {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--ink-dim);
  }
  .race-lane::before {
    content: '';
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .race-lane .ln {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .race-lane b {
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .race-lane.lead b {
    color: var(--gold);
  }
  .replay-quick {
    margin-bottom: 0.4rem;
    width: 100%;
  }
</style>
