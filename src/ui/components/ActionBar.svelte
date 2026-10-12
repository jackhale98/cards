<script lang="ts">
  import SuitText from './SuitText.svelte';
  import type { Relation } from '../../engine/state';
  import type { ActionSpec } from '../../engine/types';
  import type { Avatar } from '../../net/protocol';
  import AmountSheet from './AmountSheet.svelte';
  import AvatarBadge from './AvatarBadge.svelte';

  interface Props {
    actions: ActionSpec[];
    selected: string[];
    pot?: number;
    onact: (spec: ActionSpec, amount?: number, seat?: number) => void;
    onclear?: () => void;
    /** Name/avatar/relation of a seat, for choosing a player. */
    seatInfo?: (seat: number) => { name: string; avatar?: Avatar; relation: Relation | null };
  }
  let { actions, selected, pot = 0, onact, onclear, seatInfo }: Props = $props();
  let targetFor = $state<ActionSpec | null>(null);
  let chooseFor = $state<ActionSpec | null>(null);
  const RELATION: Record<Relation, string> = { left: '◂ Your left', right: 'Your right ▸', across: 'Across' };

  let amountFor = $state<ActionSpec | null>(null);
  let menuOpen = $state(false);

  // With many options, card actions only appear once a matching selection is made.
  // While cards are selected, pile shortcuts (Draw — also a tap on the deck) step aside for card actions.
  const crowded = $derived(actions.filter((a) => !a.menu).length > 3);
  const main = $derived(
    actions.filter((a) => !a.menu && (!crowded || (a.select ? ready(a) : !(a.zone && selected.length)))),
  );
  const more = $derived(actions.filter((a) => a.menu));

  function ready(a: ActionSpec) {
    if (!a.select) return true;
    const n = selected.length;
    return n >= a.select.min && n <= a.select.max && selected.every((id) => a.select!.cards.includes(id));
  }

  function hint(a: ActionSpec) {
    if (!a.select || ready(a)) return '';
    const { min, max } = a.select;
    if (min === max) return `Select ${min}`;
    return `Select ${min}+`;
  }

  function press(a: ActionSpec) {
    menuOpen = false;
    if (a.target) {
      targetFor = a;
      return;
    }
    if (a.choose) {
      chooseFor = a;
      return;
    }
    if (a.amount) {
      amountFor = a;
      return;
    }
    onact(a);
  }

</script>

<div class="bar">
  {#if selected.length && onclear}
    <button class="btn quiet clear" onclick={onclear}>✕ Clear{selected.length > 1 ? ` (${selected.length})` : ''}</button>
  {/if}
  {#each main as a (a.type)}
    <!-- a slap goes the moment a finger touches it (a click waits for the finger to lift) -->
    <button
      class="btn {a.style ?? ''}"
      class:slap={a.react}
      disabled={!ready(a)}
      onpointerdown={a.react ? () => press(a) : undefined}
      onclick={(e) => (!a.react || e.detail === 0 ? press(a) : undefined)}
    >
      <SuitText text={a.label} />
      {#if hint(a)}<small>{hint(a)}</small>{/if}
    </button>
  {/each}
  {#if more.length}
    <button class="btn quiet more" class:open={menuOpen} onclick={() => (menuOpen = !menuOpen)} aria-label="More actions">•••</button>
  {/if}
</div>

{#if menuOpen}
  <button class="scrim" onclick={() => (menuOpen = false)} aria-label="Close menu"></button>
  <div class="menu panel">
    {#each more as a (a.type)}
      <button class="item" class:danger={a.style === 'danger'} disabled={!ready(a)} onclick={() => press(a)}>
        <SuitText text={a.label} />
        {#if hint(a)}<small>{hint(a)}</small>{/if}
      </button>
    {/each}
  </div>
{/if}

{#if targetFor?.target && seatInfo}
  {@const spec = targetFor}
  <button class="scrim" onclick={() => (targetFor = null)} aria-label="Cancel"></button>
  <div class="sheet panel">
    <div class="eyebrow">{spec.target!.label ?? spec.label} · {selected.length} card{selected.length === 1 ? '' : 's'}</div>
    <div class="targets">
      {#each spec.target!.seats as seat (seat)}
        {@const info = seatInfo(seat)}
        <button
          class="target"
          onclick={() => {
            onact(spec, undefined, seat);
            targetFor = null;
          }}
        >
          <AvatarBadge avatar={info.avatar} name={info.name} {seat} size={34} />
          <span class="tname">{info.name}</span>
          {#if info.relation}<small>{RELATION[info.relation]}</small>{/if}
        </button>
      {/each}
    </div>
    <div class="row"><button class="btn quiet" onclick={() => (targetFor = null)}>Cancel</button></div>
  </div>
{/if}

{#if chooseFor?.choose}
  {@const spec = chooseFor}
  <button class="scrim" onclick={() => (chooseFor = null)} aria-label="Cancel"></button>
  <div class="sheet panel">
    <div class="chead">
      <span class="eyebrow">{spec.choose!.label ?? spec.label}</span>
      <button class="x" onclick={() => (chooseFor = null)} aria-label="Cancel">×</button>
    </div>
    <div class="choices" class:many={spec.choose!.options.length > 6}>
      {#each spec.choose!.options as o (o.value)}
        <button
          class="choice"
          disabled={o.disabled}
          onclick={() => {
            onact(spec, o.value);
            chooseFor = null;
          }}
          >{#if o.label.includes(' · ')}<SuitText text={o.label.split(' · ')[0]} /><small>{o.label.split(' · ')[1]}</small>{:else}<SuitText text={o.label} />{/if}</button
        >
      {/each}
    </div>
  </div>
{/if}

{#if amountFor?.amount}
  <AmountSheet
    spec={amountFor}
    {pot}
    oncancel={() => (amountFor = null)}
    onconfirm={(v) => {
      onact(amountFor!, v);
      amountFor = null;
    }}
  />
{/if}

<style>
  .bar {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    align-items: stretch;
    justify-content: flex-end;
    height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
    /* a scrolling box clips what's outside it, the primary button's soft glow included: room
       for the glow inside, taken back outside so the buttons stay where they were */
    /* (only 8px on the right: the table's edge is close there) */
    padding: 10px 8px 22px 14px;
    margin: -10px -8px -22px -14px;
  }
  .bar .btn {
    flex-direction: column;
    gap: 0;
    line-height: 1.1;
    font-size: 0.9rem;
    padding: 0.5em 0.9em;
  }
  .bar small {
    font-size: 0.66rem;
    font-weight: 500;
    opacity: 0.8;
  }
  .clear {
    position: relative;
    min-height: 34px;
    font-size: 0.8rem !important;
    color: var(--ink-dim);
  }
  /* (a 44px tall target without making the bar taller) */
  .clear::after {
    content: '';
    position: absolute;
    inset: -5px 0;
  }
  .more {
    letter-spacing: 0.15em;
    min-height: 36px;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.1) 70%);
  }
  .menu {
    background: rgba(8, 26, 20, 0.96);
    background: color-mix(in srgb, var(--felt-3) 96%, transparent);
    position: fixed;
    right: calc(12px + var(--safe-r));
    bottom: calc(12px + var(--safe-b));
    z-index: 41;
    display: flex;
    flex-direction: column;
    padding: 0.4rem;
    min-width: 13rem;
    max-height: calc(100vh - 24px - var(--safe-t) - var(--safe-b));
    max-height: calc(100dvh - 24px - var(--safe-t) - var(--safe-b));
    overflow: auto;
    animation: pop 0.18s var(--ease-out);
  }
  .item {
    text-align: left;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    font-weight: 500;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  .item:hover:not(:disabled),
  .item:active:not(:disabled) {
    background: var(--glass-hi);
  }
  .item:disabled {
    opacity: 0.4;
  }
  .item small {
    color: var(--ink-faint);
  }
  .item.danger {
    color: #ffb4a2;
  }
  /* pinned to the top so your hand stays visible while you decide */
  .sheet {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: calc(8px + var(--safe-t));
    transform: translateX(-50%);
    width: min(28rem, calc(100vw - 24px));
    padding: 0.7rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    animation: pop 0.2s var(--ease-out);
    background: rgba(8, 26, 20, 0.96);
    background: color-mix(in srgb, var(--felt-3) 96%, transparent);
    max-height: calc(100vh - 24px);
    max-height: calc(100dvh - 24px);
    overflow: auto;
  }
  .row {
    display: flex;
    justify-content: flex-end;
  }
  .chead {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .x {
    width: 32px;
    height: 32px;
    font-size: 1.3rem;
    color: var(--ink-dim);
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: 0.35rem;
  }
  .choices.many {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    max-height: 62vh;
    overflow-y: auto;
  }
  .choices.many .choice {
    padding: 0.2rem;
    line-height: 1.1;
  }
  .choice small {
    display: block;
    font-size: 0.72rem;
    font-weight: 600;
    opacity: 0.7;
  }
  .choice {
    min-height: 40px;
    padding: 0 0.4rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid var(--line);
    font-weight: 700;
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .choice:disabled {
    opacity: 0.25;
  }
  .choice:active {
    transform: scale(0.97);
  }
  .targets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.4rem;
  }
  .target {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
    text-align: left;
    min-width: 0;
  }
  .target:active {
    transform: scale(0.97);
  }
  .tname {
    font-weight: 700;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .target small {
    font-size: 0.65rem;
    color: var(--gold);
    font-weight: 600;
    white-space: nowrap;
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.96;
    }
  }
  .btn.slap {
    min-width: 6.5rem;
    font-size: 1.05rem;
    letter-spacing: 0.04em;
    touch-action: manipulation;
  }
</style>
