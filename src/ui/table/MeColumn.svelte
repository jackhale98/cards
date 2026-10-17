<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PlayerState, SeatInfo } from '../../engine/types';
  import type { Avatar } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import SuitText from '../components/SuitText.svelte';
  import Recap from './Recap.svelte';

  /**
   * You: a column of your own beside the middle, above your hand, so your hand has the whole
   * width. On a phone on its side (`side`) whose turn it is sits at its top (`status`), and at a
   * hand's end the hand's summary, where the column is free then, rather than under the middle,
   * where a big showdown needs every bit of the height.
   */
  let {
    me,
    you,
    avatar,
    info,
    chips,
    hint,
    react,
    away,
    side,
    handMode,
    recap,
    status,
    meOwnH = $bindable(0),
    recapH = $bindable(0),
  }: {
    /** You, in this game (null: at the table but not playing it). */
    me: PlayerState | null;
    you: number;
    avatar: Avatar | undefined;
    info: SeatInfo | undefined;
    /** A chips game: your chips under your name. */
    chips: boolean;
    hint: string | undefined;
    /** A reaction you just sent, rising from your name. */
    react: { text: string; key: number } | undefined;
    /** Not playing this game: why ("Watching"). */
    away: string;
    side: boolean;
    handMode: boolean;
    /** The hand's summary, in the column (side only). */
    recap: string | null;
    /** Whose turn it is and the last move (side only). */
    status: Snippet;
    /** Your own part's height, and the summary's, for the table's sizes. */
    meOwnH?: number;
    recapH?: number;
  } = $props();

  /**
   * The column is short: the headline always shows whole; the last move only when there's room
   * for all of it (never half a line), then the hand's summary (which the Scores sheet has too).
   */
  function fitSide(el: HTMLElement) {
    let frame = 0;
    const fit = () => {
      const parts = ['.last', '.recap'].map((q) => el.querySelector<HTMLElement>(q)).filter((x) => !!x);
      for (const x of parts) x.style.display = '';
      for (const x of parts) if (el.scrollHeight > el.clientHeight + 1) x.style.display = 'none';
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const ro = new ResizeObserver(later);
    ro.observe(el);
    // (and when the column itself grows: with something hidden, this box is only as tall as what's
    // left in it, so it wouldn't change size by itself to show it again)
    if (el.parentElement) ro.observe(el.parentElement);
    const mo = new MutationObserver(later);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    later();
    return {
      destroy: () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        mo.disconnect();
      },
    };
  }
</script>

<section class="me" class:side class:handmode={handMode} aria-label="You">
  {#if side}
    <div class="side-status" use:fitSide>
      {@render status()}
      {#if recap}<Recap {recap} side bind:h={recapH} />{/if}
    </div>
  {/if}
  <div class="me-own" bind:clientHeight={meOwnH}>
    {#if me}
      <div class="me-name">
        {#if react}{#key react.key}<span class="my-react" aria-hidden="true">{react.text}</span>{/key}{/if}
        <AvatarBadge {avatar} name={me.name} seat={you} size={24} /><span class="mn">{me.name}</span>
        {#if info?.tag}<span class="mytag">{info.tag}</span>{/if}
      </div>
      <div class="me-sub">
        {#if chips}<span><b>{me.chips.toLocaleString()}</b> chips</span>{/if}
        {#if info?.badge}<span class="gold"><SuitText text={info.badge} /></span>{/if}
      </div>
      {#if hint}<div class="hint"><SuitText text={hint} /></div>{/if}
    {:else}
      <!-- (at the table but not in this game: you're in the next one) -->
      <div class="me-sub">{away}</div>
    {/if}
  </div>
</section>

<style>
  .me {
    grid-area: me;
    align-self: end;
    /* (room for a short name and a badge beside it: "Tester ★"; wider for a longer status,
       "0 in hand · 0 up · 3 down", so it takes two lines rather than four) */
    min-width: clamp(90px, 13vw, 140px);
    max-width: clamp(120px, 22vw, 200px);
    padding-bottom: 2px;
    font-size: 0.8rem;
  }
  .me.handmode {
    font-size: 0.9rem;
  }
  /* a phone on its side: whose turn it is at the top of the column, you at the bottom */
  .me.side {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    min-height: 0;
    /* a set width, not the width of the words in it: a one-line tip that grew and shrank with
       each move would push the middle (and every card in it) about */
    width: clamp(130px, 24vw, 210px);
    max-width: none;
  }
  /* (a short column: the last move gives way first, so nothing runs into your name below) */
  .side-status {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-height: 0;
    overflow: hidden;
    /* (room around the tip for its glow, which this box would otherwise cut square: given back
       outside, so nothing moves; see TableStatus's .headline.side.mine) */
    padding: 12px;
    margin: -12px;
  }
  .me.side > .me-own {
    flex: none;
  }
  .my-react {
    position: absolute;
    left: 0;
    bottom: 100%;
    font-size: 1.5rem;
    pointer-events: none;
    animation: my-react 3.6s var(--ease-out) forwards;
  }
  @keyframes my-react {
    0% {
      opacity: 0;
      transform: translateY(6px) scale(0.6);
    }
    10%,
    75% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .my-react {
      animation-name: my-react-still;
    }
    @keyframes my-react-still {
      0%,
      80% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }
  }
  .me-name {
    position: relative;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
    min-width: 0;
  }
  /* a long name shortens ("Alexand…"); the dealer badge beside it always shows */
  .me-name .mn {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .me-name > :global(*) {
    flex: none;
  }
  .me-name > .mn {
    flex: 0 1 auto;
  }
  .mytag {
    font-size: 0.7rem;
    background: #fff;
    color: #111;
    border-radius: 6px;
    padding: 0 4px;
  }
  /* (chips and your status on one line where they fit: "1,111 chips · Call 63") */
  .me-sub {
    color: var(--ink-dim);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.4rem;
  }
  .me-sub b {
    color: var(--ink);
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .gold,
  .hint {
    color: var(--gold);
    font-weight: 600;
  }
  /* (a hint, "Melded 0 · holding 57": small, under your score) */
  .hint {
    margin-top: 0.15rem;
    font-size: 0.7rem;
    font-weight: 500;
    opacity: 0.9;
  }
</style>
