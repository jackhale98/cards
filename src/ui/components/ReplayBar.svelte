<script lang="ts">
  import { app } from '../../app.svelte';
  import type { Frame } from '../../net/protocol';

  /**
   * Replaying a finished hand: step through it (or let it play), move between the last few hands,
   * and get back to the game. The live game carries on meanwhile: if it's your turn, it says so.
   */
  let { frame }: { frame: Frame } = $props();

  const go = (hand: number, step: number) => app.showReplay(hand, step);
  const first = $derived(frame.step === 0);
  const last = $derived(frame.step >= frame.steps - 1);
  // (in the live game: your move, not just a "Deal next hand" anyone could press)
  const yourTurn = $derived.by(() => {
    const live = app.view;
    if (!live?.state || live.you < 0) return false;
    return (live.status?.actor ?? live.state.turn) === live.you && live.actions.length > 0;
  });

  // playing: a move a second, stopping at the end (or when stepped by hand)
  let playing = $state(false);
  $effect(() => {
    if (!playing) return;
    if (last) {
      playing = false;
      return;
    }
    const t = setTimeout(() => go(frame.hand, frame.step + 1), 1000);
    return () => clearTimeout(t);
  });
  const step = (by: number) => {
    playing = false;
    go(frame.hand, frame.step + by);
  };
  const hand = (by: number) => {
    playing = false;
    go(frame.hand + by, 0);
  };

  function onkey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' && !first) step(-1);
    else if (e.key === 'ArrowRight' && !last) step(1);
    else if (e.key === 'Escape') app.closeReplay();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="replay" role="toolbar" aria-label="Replay">
  <div class="what">
    <b>{frame.hand === 0 ? 'Last hand' : frame.hand === 1 ? 'The hand before' : `${frame.hand} hands before`}</b>
    <span class="small">Move {frame.step + 1} of {frame.steps}</span>
  </div>
  <div class="buttons">
    <button class="icon play" disabled={last && !playing} onclick={() => (playing = !playing)} aria-label={playing ? 'Pause' : 'Play'}
      >{playing ? '⏸' : '▶'}</button
    >
    <button class="icon" disabled={first} onclick={() => step(-1)} aria-label="Back a move">◀</button>
    <button class="icon" disabled={last} onclick={() => step(1)} aria-label="Forward a move">▶▶</button>
    <button class="icon small" disabled={frame.hand >= frame.hands - 1} onclick={() => hand(1)} aria-label="Earlier hand">⏮ hand</button>
    <button class="icon small" disabled={frame.hand === 0} onclick={() => hand(-1)} aria-label="Later hand">hand ⏭</button>
  </div>
  <button class="btn small-btn back" class:primary={yourTurn} onclick={() => app.closeReplay()}>
    {yourTurn ? 'Your turn — back' : 'Back to the game'}
  </button>
</div>

<style>
  /* (it takes the place of the action buttons: there are no moves to make in a replay) */
  .replay {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    height: 100%;
    justify-content: flex-end;
  }
  .what {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    text-align: center;
  }
  .what b {
    font-size: 0.85rem;
  }
  .what .small {
    color: var(--ink-dim);
    font-size: 0.72rem;
  }
  .buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
  }
  .icon {
    min-height: 40px;
    border-radius: 10px;
    font-size: 0.95rem;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.06);
  }
  .icon:disabled {
    opacity: 0.3;
  }
  .icon.small {
    font-size: 0.68rem;
    min-height: 34px;
  }
  .play {
    grid-column: 1 / -1;
    background: rgba(233, 196, 106, 0.22);
    background: color-mix(in srgb, var(--gold) 22%, transparent);
  }
  .back {
    white-space: normal;
  }
</style>
