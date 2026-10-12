<script lang="ts">
  import type { GameStatus } from '../../engine/types';
  import type { Avatar } from '../../net/protocol';
  import { seatColor } from '../seatColors';

  let { track, avatars }: { track: NonNullable<GameStatus['track']>; avatars: (Avatar | undefined)[] } = $props();
  const pct = (n: number) => `${Math.min(100, (n / track.target) * 100)}%`;
  // street markers every 30 points, like the lines on a cribbage board
  const marks = $derived(Array.from({ length: Math.floor((track.target - 1) / 30) }, (_, i) => (i + 1) * 30));
</script>

<div class="track" aria-label="Score board">
  {#each track.lanes as lane (lane.label)}
    {@const c = avatars[lane.seat]?.color ?? seatColor(lane.seat)}
    <div class="lane" style:--c={c}>
      <span class="name">{lane.label}</span>
      <div class="bar">
        {#each marks as m}<i class="mark" style:left={pct(m)}></i>{/each}
        <div class="fill" style:width={pct(lane.score)}></div>
        <span class="peg back" style:left={pct(lane.prev)}></span>
        <span class="peg front" style:left={pct(lane.score)}></span>
      </div>
      <b class="score">{lane.score}</b>
    </div>
  {/each}
</div>

<style>
  .track {
    width: min(100%, 34rem);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px 10px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.22);
  }
  .lane {
    display: grid;
    grid-template-columns: minmax(3rem, 7rem) 1fr 2.2rem;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.64rem;
    line-height: 1.1;
  }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ink-dim);
  }
  .bar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.12);
    background: color-mix(in srgb, var(--c) 35%, transparent);
    transition: width 0.6s var(--ease-out);
  }
  .mark {
    position: absolute;
    top: -1px;
    bottom: -1px;
    width: 1px;
    background: rgba(255, 255, 255, 0.18);
  }
  .peg {
    position: absolute;
    top: 50%;
    width: 9px;
    height: 9px;
    margin: -4.5px 0 0 -4.5px;
    border-radius: 50%;
    transition: left 0.6s var(--ease-out);
  }
  .peg.front {
    background: var(--c);
    box-shadow: 0 0 6px var(--c);
  }
  .peg.back {
    background: transparent;
    border: 2px solid var(--c);
    opacity: 0.7;
  }
  .score {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
