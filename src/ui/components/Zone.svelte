<script lang="ts">
  import SuitText from './SuitText.svelte';
  import type { ZoneState } from '../../engine/types';
  import { receive, send } from '../motion';
  import { isHidden } from '../../engine/redact';
  import Card from './Card.svelte';

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
    /** There's room for a row of cards side by side: no need to overlap them. */
    roomy?: boolean;
  }
  /** A face-up hand's overlap: each card shows this much of the one under it (in card widths)… */
  const STEP = 0.38;
  /** …and a new suit this much more. */
  const SUIT_GAP = 0.32;
  let { zone, cw, you, players, selected, selectable, ontap, onzone, zoneActive = false, place = false, fast = false, roomy = false }: Props = $props();

  /** Trick cards sit between the centre and the seat that played them. */
  function trickPos(by: number | undefined) {
    const rel = ((by ?? 0) - Math.max(0, you) + players) % players;
    const angle = Math.PI / 2 + (rel * 2 * Math.PI) / players;
    return { x: Math.cos(angle) * cw * 0.9, y: Math.sin(angle) * cw * 0.42, rot: (rel % 2 ? 1 : -1) * (3 + rel * 2) };
  }
  const top = $derived(zone.cards[zone.cards.length - 1]);

  /**
   * A whole hand face up (bridge's dummy) keeps the width its thirteen cards took: as it's played
   * from, the cards left grow into it, the same overlap and the same room between suits, up to a
   * size that stays within the row (`cw` is a thirteen-card dummy's size).
   */
  const handCw = $derived.by(() => {
    if (!zone.faceUpHand) return cw;
    const n = Math.max(1, zone.cards.length);
    const groups = zone.cards.filter((c, i) => i > 0 && c.group != null && c.group !== zone.cards[i - 1].group).length;
    const full = 1 + 12 * STEP + 3 * SUIT_GAP;
    return Math.round(Math.min(cw * 1.6, (cw * full) / (1 + (n - 1) * STEP + groups * SUIT_GAP)));
  });
</script>

<div class="zone" data-zone={zone.id} data-layout={zone.layout} style:--cw="{cw}px">
  {#if zone.label && zone.layout !== 'trick'}<div class="label eyebrow" data-flip>
      <!-- (a hand turned over at a showdown: who, then what, on two short lines, so the label is no
           wider than the hand) -->
      {#if zone.base === 'showdown'}{#each zone.label.split(' · ') as line, i (i)}<span class="line"><SuitText text={line} /></span>{/each}{:else}<SuitText
          text={zone.label}
        />{/if}{#if zone.layout === 'stack' && !zone.cascade}
        · {zone.cards.length}{/if}
    </div>{/if}

  {#if zone.layout === 'stack'}
    {@const below = zone.peek ? zone.cards.slice(-zone.peek, -1).filter((c) => c.up !== false && !isHidden(c.id)) : []}
    <button
      class="stack"
      class:cascade={zone.cascade}
      style:margin-left={zone.peek ? `calc(var(--cw) * ${0.3 * (zone.peek - 1)})` : undefined}
      data-flip
      class:active={zoneActive}
      onpointerdown={fast ? () => onzone?.() : undefined}
      onclick={(e) => (fast && e.detail !== 0 ? undefined : !place && top && selectable?.has(top.id) ? ontap(top.id) : onzone?.())}
      disabled={!zoneActive && !(top && selectable?.has(top.id))}
    >
      {#if zone.cascade && zone.cards.length > 1}
        <!-- a cascade: the bottom card peeks out above the top one (where the whole pile can go) -->
        <div class="bottom"><Card id={zone.cards[0].id} /></div>
      {:else if zone.cards.length > 1}<div class="under"><Card id="?u" /></div>{/if}
      {#if zone.cards.length > 8}<div class="under two"><Card id="?u2" /></div>{/if}
      {#each below as c, i (c.id)}
        <!-- the cards just under the top, fanned out to the left -->
        <div class="peeked" style:transform="translateX(calc(var(--cw) * {-0.3 * (below.length - i)})) rotate({-4 * (below.length - i)}deg)">
          <Card id={c.id} />
        </div>
      {/each}
      {#if top && isHidden(top.id)}
        <!-- a face-down top just sits there: cards drawn from it fly out on their own -->
        <div class="top"><Card id={top.id} /></div>
      {:else if top}
        {#key top.id}
          <div class="top" in:receive={{ key: top.id }} out:send={{ key: top.id }}>
            <Card id={top.id} down={top.up === false} selected={selected.includes(top.id)} />
          </div>
        {/key}
      {:else}
        <div class="empty"></div>
      {/if}
    </button>
  {:else if zone.layout === 'trick'}
    <div class="trick" data-flip>
      {#each zone.cards as c (c.id)}
        {@const p = trickPos(c.by)}
        <div
          class="tcard"
          style:transform="translate(-50%, -50%) translate({p.x}px, {p.y}px) rotate({p.rot}deg)"
          in:receive={{ key: c.id }}
          out:send={{ key: c.id }}
        >
          <Card id={c.id} />
        </div>
      {/each}
    </div>
  {:else}
    <div class="spread" class:handdown={zone.faceUpHand} class:roomy={roomy && !zone.faceUpHand} style:--cw={zone.faceUpHand ? `${handCw}px` : undefined}>
      {#each zone.cards as c, i (c.id)}
        <button
          class="scard"
          data-flip
          class:newgroup={i > 0 && c.group != null && c.group !== zone.cards[i - 1].group}
          onclick={() => ontap(c.id)}
          disabled={!selectable?.has(c.id)}
          in:receive={{ key: c.id }}
          out:send={{ key: c.id }}
        >
          <Card id={c.id} down={c.up === false} selected={selected.includes(c.id)} dim={c.dim} />
        </button>
      {:else}
        <div class="empty wide" data-flip></div>
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
  .stack {
    position: relative;
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    padding: 0;
  }
  /* (room above for the bottom card, whether or not there's one yet: the pile doesn't jump) */
  .stack.cascade {
    margin-top: calc(var(--cw) * 0.42);
  }
  .stack > .bottom {
    inset: auto;
    left: 0;
    top: calc(var(--cw) * -0.42);
  }
  .stack:disabled {
    cursor: default;
  }
  .stack.active .top {
    filter: drop-shadow(0 0 8px rgba(233, 196, 106, 0.8));
  }
  .stack > div {
    position: absolute;
    inset: 0;
  }
  .under {
    transform: translate(2px, 2px);
  }
  .under.two {
    transform: translate(4px, 4px);
    z-index: -1;
  }
  .empty {
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    border-radius: var(--card-radius);
    border: 1.5px dashed rgba(255, 255, 255, 0.18);
    font-size: calc(var(--cw) / 5);
  }
  .empty.wide {
    width: calc(var(--cw) * 2);
  }
  .spread {
    position: relative;
    display: flex;
    gap: calc(var(--cw) * 0.1);
    flex-wrap: wrap;
    justify-content: center;
    max-width: 100%;
  }
  .spread:has(> :nth-child(5)) .scard + .scard {
    margin-left: calc(var(--cw) * -0.45);
  }
  .spread.roomy .scard + .scard {
    margin-left: 0;
  }
  /* a whole hand on the table (bridge dummy): just the corner indices show */
  .spread:has(> :nth-child(12)) .scard + .scard {
    margin-left: calc(var(--cw) * -0.66);
  }
  .scard {
    position: relative;
    padding: 0;
  }
  /* a whole hand face up (bridge's dummy): the same overlap from thirteen cards down to one, a
     little room between suits, one row; as it's played from, the cards left grow (smoothly) into
     the room the others took */
  .spread.handdown {
    flex-wrap: nowrap;
  }
  .spread.handdown.handdown .scard + .scard {
    margin-left: calc(var(--cw) * -0.62) !important;
  }
  .spread.handdown.handdown .scard.newgroup {
    margin-left: calc(var(--cw) * -0.3) !important;
  }
  .spread.handdown .scard {
    transition: margin-left 0.3s var(--ease-out);
  }
  .spread.handdown :global(.card) {
    transition:
      width 0.3s var(--ease-out),
      height 0.3s var(--ease-out),
      font-size 0.3s var(--ease-out),
      transform 0.22s var(--ease-out),
      box-shadow 0.22s,
      filter 0.2s,
      opacity 0.2s;
  }
  .spread .scard.newgroup {
    margin-left: calc(var(--cw) * 0.22) !important;
  }
  .spread:has(> :nth-child(12)) .scard.newgroup {
    margin-left: calc(var(--cw) * -0.5) !important;
  }
  .scard:disabled {
    cursor: default;
  }
  .trick {
    position: relative;
    width: calc(var(--cw) * 3);
    height: calc(var(--cw) * 2.25);
  }
  .tcard {
    position: absolute;
    left: 50%;
    top: 50%;
  }
</style>
