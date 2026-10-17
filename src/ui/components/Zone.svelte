<script lang="ts">
  import SuitText from './SuitText.svelte';
  import type { ZoneState } from '../../engine/types';
  import { cardName } from '../cardName';
  import { dummyCw as grownCw, FULL_HAND, layoutZone, TAP, type Spot } from '../layout';
  import { LAYER, useFrames } from '../layout/frames.svelte';
  import type { SpreadStyle } from '../layout/spread';
  import { CASCADE } from '../layout/stack';
  import Card from './Card.svelte';

  /**
   * A zone on the table: its label, and a frame that its layout (layout/index.ts) sizes and
   * places its cards in. At a table the card layer draws the cards (CardLayer.svelte), and the
   * frame keeps what you tap, in order; elsewhere (the full-screen melds) the frame draws them.
   */
  interface Props {
    zone: ZoneState;
    cw: number;
    /** Viewer seat and player count, for placing trick cards toward their owners. */
    you: number;
    players: number;
    selected: string[];
    selectable: Set<string> | null;
    ontap: (id: string) => void;
    /** Tap on an empty spot / the stack itself (e.g. draw from the deck). */
    onzone?: () => void;
    /** Tapping the pile is a slap: it goes on touch, not on release. */
    fast?: boolean;
    zoneActive?: boolean;
    /** The selected card(s) can be put here: a tap places them (rather than selecting the top card). */
    place?: boolean;
    /** Where on the table it is: how its rows overlap and wrap (layout/spread.ts). */
    style?: Exclude<SpreadStyle, 'dummy'>;
    /** The widest its rows may be before they wrap (Infinity: never). */
    room?: number;
    /** Between its rows, when they wrap (default: a tenth of a card). */
    rowGap?: number;
    /** There's room for a row of cards side by side: no need to overlap them. */
    roomy?: boolean;
    /** The widest a face-up hand's cards may grow and still fit the middle's height. */
    growTo?: number;
    /** A table screen's pile in the middle: its label keeps the widest it has been (its count and hint change all game), so the row doesn't re-centre as it changes. */
    steady?: boolean;
    /** Draw its own cards, even at a table (it's on a sheet over it). */
    inline?: boolean;
  }
  /** How far (px) the room beside a dummy may dip before it shrinks to suit. */
  const HOLD = 8;
  let {
    zone,
    cw,
    you,
    players,
    selected,
    selectable,
    ontap,
    onzone,
    zoneActive = false,
    place = false,
    fast = false,
    style = 'middle',
    room = Infinity,
    rowGap,
    roomy = false,
    growTo = Infinity,
    steady = false,
    inline = false,
  }: Props = $props();

  const frames = useFrames();
  const layered = $derived(!!frames && !inline);

  /** Keep the widest a label has been (while `on`): it widens when its text grows, and never narrows. */
  function holdWidth(el: HTMLElement, on: boolean) {
    let widest = 0;
    const ro = new ResizeObserver(() => {
      if (!on || el.offsetWidth <= widest) return;
      widest = el.offsetWidth;
      el.style.minWidth = `${widest}px`;
    });
    ro.observe(el);
    return {
      update(v: boolean) {
        on = v;
        if (!on) {
          widest = 0;
          el.style.minWidth = '';
        }
      },
      destroy: () => ro.disconnect(),
    };
  }

  /**
   * A whole hand face up (bridge's dummy) keeps the width its thirteen cards took, so it never
   * moves up beside the trick as it empties (the height it frees there would let its cards grow,
   * push it back onto its own row, and shrink them again): as it's played from, the cards left
   * grow into it, the same overlap and the same room between suits, up to a size that still fits
   * the middle beside the trick (`cw` is a thirteen-card dummy's size) and its height (`growTo`:
   * past it, the whole middle would shrink to fit, a moment late, and the dummy would swell and
   * settle back with every card played).
   */
  const fitCw = $derived.by(() => {
    if (!zone.faceUpHand) return cw;
    return grownCw(cw, growTo, zone.cards);
  });
  /**
   * Through a hand the dummy only grows: the room beside the trick wobbles by a few pixels as cards
   * land and the tip changes, and the dummy shouldn't wobble with it. It keeps the size it has
   * reached while it has the same cards or fewer, unless the room really goes (a smaller window:
   * then it follows, rather than overflow the middle).
   */
  let kept = $state({ n: 0, cw: 0, size: 0 });
  const dummyCw = $derived(
    zone.faceUpHand && kept.cw === cw && zone.cards.length <= kept.n && fitCw < kept.size && fitCw >= kept.size - HOLD ? kept.size : fitCw,
  );
  $effect(() => {
    const n = zone.cards.length;
    // (a new deal, or a different card size for the table: start again)
    if (n > kept.n || kept.cw !== cw || dummyCw !== kept.size) kept = { n, cw, size: dummyCw };
    else if (n !== kept.n) kept.n = n;
  });

  const placed = $derived(
    layoutZone(zone, {
      cw,
      you,
      players,
      style,
      maxW: room,
      roomy,
      rowGap,
      // (cards you can pick now spread out enough to tap each one)
      tap: zone.cards.some((c) => selectable?.has(c.id)) ? TAP : undefined,
      dummy: zone.faceUpHand ? { cw: dummyCw, minW: Math.round(cw * FULL_HAND) } : undefined,
    }),
  );
  const top = $derived(zone.cards.at(-1));
  /** Each card's place, and how it looks there. */
  const spots = $derived(
    placed.spots.map((p): Spot => ({
      ...p,
      selected: selected.includes(p.id),
      glow: zone.layout === 'stack' && zoneActive && p.id === top?.id,
    })),
  );
  /** A card you can pick here (a pile is tapped as a whole). */
  const pickable = (id: string) => !!selectable?.has(id);

  let frameEl = $state<HTMLElement>();
  // (at a table: the card layer draws this zone's cards)
  $effect(() => {
    const el = frameEl;
    if (!frames || inline || !el) return;
    const key = zone.id;
    frames.set(key, {
      el,
      zone: zone.id,
      owner: zone.owner,
      layer: zone.layout === 'trick' ? LAYER.trick : LAYER.piles,
      spots,
      ids: zone.cards.map((c) => c.id),
    });
    return () => frames.drop(key, el);
  });

  const at = (p: Spot) => `translate(${p.x - p.w / 2}px, ${p.y - p.w * 0.7}px) rotate(${p.rot}deg)`;
  const pileName = $derived(zone.label ?? 'Pile');
</script>

{#snippet drawn(p: Spot)}
  <Card id={p.id} down={p.down} selected={p.selected} dim={p.dim} />
  {#if p.count}<span class="count">{p.count}</span>{/if}
{/snippet}

<div class="zone" data-zone={zone.id} data-layout={zone.layout} style:--cw="{cw}px">
  {#if zone.label && zone.layout !== 'trick'}<div class="label eyebrow" data-flip use:holdWidth={steady}>
      <!-- (a hand turned over at a showdown: who, then what, on two short lines, so the label is no
           wider than the hand) -->
      {#if zone.base === 'showdown'}{#each zone.label.split(' · ') as line, i (i)}<span class="line"><SuitText text={line} /></span>{/each}{:else}<SuitText
          text={zone.label}
        />{/if}{#if zone.layout === 'stack' && !zone.cascade}
        · {zone.cards.length}{/if}
    </div>{/if}

  {#if zone.layout === 'stack'}
    <!-- a pile is tapped as a whole: its top card, or what the pile is for (draw, take, put) -->
    <button
      class="frame stack"
      bind:this={frameEl}
      style:width="{placed.w}px"
      style:height="{placed.h}px"
      class:active={zoneActive}
      onpointerdown={fast ? () => onzone?.() : undefined}
      onclick={(e) => (fast && e.detail !== 0 ? undefined : !place && top && selectable?.has(top.id) ? ontap(top.id) : onzone?.())}
      disabled={!zoneActive && !(top && selectable?.has(top.id))}
      aria-label={!top
        ? `${pileName}, empty`
        : `${pileName}, ${zone.cards.length} ${zone.cards.length === 1 ? 'card' : 'cards'}${top.up === false ? '' : `, ${cardName(top.id)} on top`}`}
    >
      {#if !zone.cards.length}<div class="empty" data-flip style:top={zone.cascade ? `${CASCADE * cw}px` : undefined}></div>{/if}
      {#if !layered}
        {#each spots as p (p.key)}
          <div class="card-at" class:glow={p.glow} style:transform={at(p)} style:--cw="{p.w}px" style:z-index={p.z}>{@render drawn(p)}</div>
        {/each}
      {/if}
    </button>
  {:else}
    <div class="frame" class:handdown={zone.faceUpHand} bind:this={frameEl} style:width="{placed.w}px" style:height="{placed.h}px">
      {#if !zone.cards.length && zone.layout !== 'trick'}<div class="empty wide" data-flip></div>{/if}
      {#each spots as p (p.key)}
        {#if zone.layout === 'trick'}
          {#if !layered}<div class="card-at" style:transform={at(p)} style:--cw="{p.w}px" style:z-index={p.z}>{@render drawn(p)}</div>{/if}
        {:else}
          <!-- (where the card is, to tap it: the card is drawn in it, or at a table by the card layer over it) -->
          <button
            class="scard card-at"
            style:transform={at(p)}
            style:--cw="{p.w}px"
            style:z-index={p.z}
            onclick={() => ontap(p.id)}
            disabled={!pickable(p.id)}
            aria-label={cardName(p.id, p.down)}
            aria-pressed={pickable(p.id) ? !!p.selected : undefined}
          >
            {#if !layered}{@render drawn(p)}{/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .zone {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
  .label .line {
    display: block;
    text-align: center;
  }
  .label {
    font-size: 0.7rem;
    white-space: nowrap;
    position: relative;
    z-index: 1;
  }
  .frame {
    position: relative;
    flex: none;
    padding: 0;
  }
  .stack:disabled {
    cursor: default;
  }
  /* each card's place: the card is drawn here (or, at a table, by the card layer over it) */
  .card-at {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    padding: 0;
    border-radius: var(--card-radius);
    transition: transform 0.3s var(--ease-out);
  }
  .scard:disabled {
    cursor: default;
  }
  .scard:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .card-at.glow {
    filter: drop-shadow(0 0 8px rgba(233, 196, 106, 0.8));
  }
  .empty {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    border-radius: var(--card-radius);
    border: 1.5px dashed rgba(255, 255, 255, 0.18);
  }
  .empty.wide {
    width: calc(var(--cw) * 2);
  }
  /* a squared pile's size, on its corner */
  .count {
    position: absolute;
    left: calc(var(--cw) * -0.08);
    bottom: calc(var(--cw) * -0.08);
    z-index: 8;
    min-width: 1.5em;
    padding: 0.05em 0.35em;
    border-radius: 999px;
    background: var(--gold);
    color: #1a1408;
    font-size: max(11px, calc(var(--cw) * 0.22));
    font-weight: 800;
    line-height: 1.3;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .card-at {
      transition: none;
    }
  }
</style>
