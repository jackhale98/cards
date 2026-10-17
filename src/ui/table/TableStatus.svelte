<script lang="ts">
  import type { LogEntry } from '../../engine/types';
  import type { Avatar } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import SuitText from '../components/SuitText.svelte';
  import { marquee } from '../marquee';

  /**
   * Whose turn it is (the headline) and the last move under it: above the middle, or on a phone on
   * its side in the column on the left (`side`: one line that glides when it's too long).
   */
  let {
    headline,
    mine,
    lastMove,
    lastShown,
    who,
    display,
    side,
    handMode,
    headH = $bindable(0),
    lastH = $bindable(0),
  }: {
    headline: string | undefined;
    /** It's your turn: the headline lights up. */
    mine: boolean;
    lastMove: LogEntry | null;
    /** There's room for the last move's line (see layout/table.ts). */
    lastShown: boolean;
    /** Who made the last move. */
    who: { avatar: Avatar | undefined; name: string } | null;
    display: boolean;
    side: boolean;
    handMode: boolean;
    /** The headline's height, measured for the table's sizes. */
    headH?: number;
    /** The last move's line (it can wrap): kept from when it was last shown, as it isn't always. */
    lastH?: number;
  } = $props();

  function measureLast(el: HTMLElement) {
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight && el.offsetHeight !== lastH) lastH = el.offsetHeight;
    });
    ro.observe(el);
    return { destroy: () => ro.disconnect() };
  }
</script>

{#if headline}<div class="headline" class:mine class:display class:side bind:clientHeight={headH}>
    {#if side}<span class="tip" use:marquee><span class="run"><SuitText text={headline} /></span></span>{:else}<SuitText text={headline} />{/if}
  </div>
{:else if display}
  <!-- (a table screen keeps the headline's room too, between tricks say: the piles below stay put) -->
  <div class="headline display" aria-hidden="true" style:visibility="hidden">&nbsp;</div>{/if}
{#if lastMove && lastShown}
  {#key lastMove.t}
    <div class="last" class:display class:side class:handmode={handMode} use:measureLast>
      {#if lastMove.seat != null && who}
        <AvatarBadge avatar={who.avatar} name={who.name} seat={lastMove.seat} size={16} />
      {/if}
      <span><SuitText text={lastMove.text} /></span>
    </div>
  {/key}
{:else if display}
  <!-- (a table screen keeps the line's room when there's no last move: the piles below stay put) -->
  <div class="last display" aria-hidden="true" style:visibility="hidden">&nbsp;</div>
{/if}

<style>
  .headline {
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.3rem 0.9rem;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.22);
    color: var(--ink-dim);
    transition:
      background 0.3s,
      color 0.3s;
    max-width: 100%;
    text-align: center;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .last {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    margin-top: -2px;
    font-size: 0.74rem;
    color: var(--ink-dim);
    animation: lastIn 0.35s var(--ease-out);
  }
  .last span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* (hand mode: the middle is only as tall as it needs, so a long last move wraps rather than being cut) */
  .last.handmode span {
    white-space: normal;
    text-align: center;
  }
  @keyframes lastIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .headline.mine {
    --suit-red: #a8121e;
    --suit-red4: #b54a2b;
    --suit-blue: #07078f;
    --suit-green: #197674;
    background: var(--gold);
    color: #2a1d05;
    box-shadow: 0 0 24px rgba(233, 196, 106, 0.45);
  }
  /* never squash the headline or last move when the middle is short of room */
  .headline,
  .last {
    flex-shrink: 0;
  }
  /* ---- a table screen: bigger */
  .headline.display {
    font-size: 1.15rem;
    padding: 0.4rem 1.2rem;
  }
  .last.display {
    font-size: 0.95rem;
  }
  /* ---- a phone on its side, in the column: one line; a tip too long for the column glides along it (see marquee), never cut short */
  .headline.side {
    display: block;
    max-width: 100%;
    text-align: left;
    font-size: 0.78rem;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
  }
  /* (a softer glow, inside the room the column leaves for it) */
  .headline.side.mine {
    box-shadow: 0 0 10px rgba(233, 196, 106, 0.4);
  }
  .tip {
    display: block;
    overflow: hidden;
    white-space: nowrap;
  }
  .tip .run {
    display: inline-block;
  }
  .tip:global(.moving) {
    --fade: 14px;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 0.4rem, #000 calc(100% - var(--fade)), transparent);
    mask-image: linear-gradient(to right, transparent, #000 0.4rem, #000 calc(100% - var(--fade)), transparent);
    padding-left: 0.4rem;
    margin-left: -0.4rem;
  }
  .tip:global(.moving) .run {
    /* a few passes then rest (battery); tapping it, or a new tip, plays it again */
    animation: glide var(--cycle) ease-in-out 3;
  }
  @keyframes glide {
    0%,
    15% {
      transform: translateX(0);
    }
    65%,
    80% {
      transform: translateX(var(--over));
    }
    100% {
      transform: translateX(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tip:global(.moving) .run {
      animation: none;
    }
  }
  .last.side {
    align-items: flex-start;
    margin-top: 0;
  }
  /* (shown whole, or not at all: see the column's fitting) */
  .last.side span {
    white-space: normal;
  }
  /* very short landscape phones */
  @media (max-height: 360px) {
    .headline {
      font-size: 0.74rem;
      padding: 0.2rem 0.7rem;
    }
  }
</style>
