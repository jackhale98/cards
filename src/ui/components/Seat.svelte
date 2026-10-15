<script lang="ts">
  import SuitText from './SuitText.svelte';
  import type { CardRef, PlayerState, SeatInfo } from '../../engine/types';
  import { isHidden } from '../../engine/redact';
  import type { Relation } from '../../engine/state';
  import type { Avatar } from '../../net/protocol';
  import { seatColor } from '../seatColors';
  import AvatarBadge from './AvatarBadge.svelte';
  import PingDot from './PingDot.svelte';
  import Card from './Card.svelte';
  import { receive, send } from '../motion';

  interface Props {
    player: PlayerState;
    info?: SeatInfo;
    cards: CardRef[];
    turn: boolean;
    connected: boolean;
    showChips: boolean;
    compact?: boolean;
    avatar?: Avatar;
    /** Where this player sits relative to you. */
    relation?: Relation | null;
    /** What this player just did; shown as a speech bubble that fades out. */
    said?: { text: string; key: number } | null;
    ping?: number | null;
    /** Size multiplier for pixel-sized parts (avatar, mini cards) on a big table screen. */
    scale?: number;
    /** Label the seat whose move it is (table screen). */
    turnLabel?: boolean;
  }
  let {
    player,
    info,
    cards,
    turn,
    connected,
    showChips,
    compact = false,
    avatar,
    relation = null,
    said = null,
    ping = null,
    scale = 1,
    turnLabel = false,
  }: Props = $props();
  const RELATION_LABEL: Record<Relation, string> = { left: '◂ your left', right: 'your right ▸', across: 'across' };
  const shown = $derived(cards.filter((c) => !isHidden(c.id)));
  // a crowded row shows face-down cards as one card and a count, leaving room for names
  const backs = $derived(Math.min(cards.length - shown.length, compact ? 1 : 4));
</script>

<div
  class="seat"
  data-seat={player.seat}
  class:turn
  class:out={info?.out}
  class:offline={!connected}
  class:compact
  style:--c={avatar?.color ?? seatColor(player.seat)}
>
  {#if relation}<span class="rel rel-{relation}">{RELATION_LABEL[relation]}</span>{/if}
  {#if turnLabel && turn}<span class="rel now">to play</span>{/if}
  {#if said}
    {#key said.key}
      <span class="said"><SuitText text={said.text} /></span>
    {/key}
  {/if}
  <div class="avatar">
    <AvatarBadge {avatar} name={player.name} seat={player.seat} size={(compact ? 30 : 34) * scale} />
    {#if info?.tag}<span class="tag">{info.tag}</span>{/if}
  </div>
  <div class="meta">
    <div class="name">
      {player.name}{#if player.bot}<span class="bot" title="Bot">◆</span>{/if}
      <PingDot ms={ping} />
    </div>
    <div class="sub">
      {#if showChips}<span class="chips"><span class="chip-dot"></span>{player.chips.toLocaleString()}</span>{/if}
      <!-- (a crowded poker row drops the badge: each action also pops up as a bubble) -->
      {#if info?.badge && !(compact && showChips)}<span class="badge"><SuitText text={info.badge} /></span>{/if}
      {#if !connected}<span class="badge warn">offline</span>{/if}
    </div>
  </div>
  {#if cards.length}
    <div class="cards" style:--cw="{(compact ? 18 : 22) * scale}px">
      {#each shown as c (c.id)}
        <!-- (face up: big enough that each corner's rank and suit can be read) -->
        <div class="mini up" style:--cw="{30 * scale}px" in:receive={{ key: c.id }} out:send={{ key: c.id }}>
          <Card id={c.id} />
        </div>
      {/each}
      {#each { length: backs } as _, i (i)}
        <div class="mini"><Card id={`?${player.seat}.${i}`} /></div>
      {/each}
      {#if cards.length - shown.length > 1}<span class="count">{cards.length - shown.length}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .seat {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.7rem 0.35rem 0.35rem;
    border-radius: 999px;
    background: var(--glass);
    border: 1px solid var(--line);
    min-width: 0;
    transition:
      box-shadow 0.3s,
      opacity 0.3s,
      transform 0.3s var(--ease-out);
    position: relative;
  }
  .turn {
    box-shadow: 0 0 0 2px var(--c);
    box-shadow:
      0 0 0 2px var(--c),
      0 0 22px color-mix(in srgb, var(--c) 55%, transparent);
    transform: translateY(2px);
  }
  .out {
    opacity: 0.45;
  }
  .offline .avatar {
    filter: grayscale(1);
  }
  .avatar {
    position: relative;
    flex: none;
    display: grid;
    border-radius: 50%;
  }
  /* pops over the right end of the seat pill so it never covers the table */
  .said {
    position: absolute;
    z-index: 3;
    top: 50%;
    right: -4px;
    padding: 0.25rem 0.65rem;
    border-radius: 10px;
    background: var(--card-face);
    color: #10231c;
    --suit-red: var(--card-red);
    --suit-red4: var(--card-red);
    --suit-blue: var(--card-blue);
    --suit-green: var(--card-green);
    font-weight: 700;
    font-size: 0.78rem;
    white-space: nowrap;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    animation: said 3.6s var(--ease-out) forwards;
  }
  @keyframes said {
    0% {
      opacity: 0;
      transform: translateY(-50%) scale(0.6);
    }
    8%,
    82% {
      opacity: 1;
      transform: translateY(-50%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(-50%) scale(0.95);
    }
  }
  .rel {
    position: absolute;
    top: -9px;
    left: 50%;
    transform: translateX(-50%);
    padding: 1px 7px;
    border-radius: 6px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--ink-dim);
    background: var(--felt-3);
    background: color-mix(in srgb, var(--felt-2) 55%, var(--felt-3));
    border: 1px solid var(--line);
  }
  .rel.now {
    top: -0.8rem;
    font-size: 0.7rem;
    color: #2a1d05;
    background: var(--c);
    border-color: transparent;
  }
  .turn .avatar::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid var(--c);
    /* a few beats, then a steady ring: an endless pulse keeps the GPU awake all game */
    animation: pulse 1.4s ease-out 4;
  }
  @keyframes pulse {
    from {
      transform: scale(0.9);
      opacity: 1;
    }
    to {
      transform: scale(1.35);
      opacity: 0;
    }
  }
  .tag {
    position: absolute;
    /* above the turn ring, which is drawn after it */
    z-index: 1;
    right: -6px;
    bottom: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 9px;
    font-size: 0.7rem;
    display: grid;
    place-items: center;
    background: #fff;
    color: #111;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  }
  .meta {
    min-width: 0;
    overflow: hidden;
  }
  .name {
    font-weight: 600;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 9rem;
  }
  .bot {
    margin-left: 0.3em;
    font-size: 0.7rem;
    color: var(--ink-faint);
  }
  .sub {
    display: flex;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--ink-dim);
    white-space: nowrap;
    min-width: 0;
  }
  .chips {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .chip-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--gold);
    box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.2);
  }
  .badge {
    color: var(--gold);
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge.warn {
    color: var(--danger);
  }
  .cards {
    flex: none;
    display: flex;
    align-items: center;
    padding-left: 4px;
  }
  .mini {
    margin-left: calc(var(--cw) * -0.7);
  }
  .mini.up + .mini.up {
    margin-left: calc(var(--cw) * -0.55);
  }
  .mini:first-child {
    margin-left: 0;
  }
  .count {
    margin-left: 0.3rem;
    font-size: 0.7rem;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }
  .compact {
    padding-right: 0.5rem;
  }
  .compact .name {
    max-width: 5.5rem;
  }
</style>
