<script lang="ts">
  import type { ActionSpec } from '../../engine/types';

  interface Props {
    actions: ActionSpec[];
    selected: string[];
    pot?: number;
    onact: (spec: ActionSpec, amount?: number) => void;
  }
  let { actions, selected, pot = 0, onact }: Props = $props();

  let amountFor = $state<ActionSpec | null>(null);
  let amount = $state(0);
  let menuOpen = $state(false);

  // With many options, card actions only appear once a matching selection is made.
  const crowded = $derived(actions.filter((a) => !a.menu).length > 3);
  const main = $derived(actions.filter((a) => !a.menu && (!crowded || !a.select || ready(a))));
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
    if (a.amount) {
      amountFor = a;
      amount = a.amount.default;
      return;
    }
    onact(a);
  }

  function confirmAmount() {
    if (amountFor) onact(amountFor, amount);
    amountFor = null;
  }

  const presets = $derived.by(() => {
    const a = amountFor?.amount;
    if (!a) return [];
    const opts: { label: string; v: number }[] = [{ label: 'Min', v: a.min }];
    if (pot > 0 && a.label === 'chips') {
      opts.push({ label: '½ pot', v: Math.round(pot / 2) });
      opts.push({ label: 'Pot', v: pot });
    }
    opts.push({ label: 'Max', v: a.max });
    return opts.filter((o) => o.v >= a.min && o.v <= a.max);
  });
</script>

<div class="bar">
  {#each main as a (a.type)}
    <button class="btn {a.style ?? ''}" disabled={!ready(a)} onclick={() => press(a)}>
      {a.label}
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
        {a.label}
        {#if hint(a)}<small>{hint(a)}</small>{/if}
      </button>
    {/each}
  </div>
{/if}

{#if amountFor?.amount}
  {@const spec = amountFor.amount}
  <button class="scrim" onclick={() => (amountFor = null)} aria-label="Cancel"></button>
  <div class="sheet panel">
    <div class="eyebrow">{amountFor.label}</div>
    <div class="amount">{amount.toLocaleString()} <small>{spec.label ?? ''}</small></div>
    <input type="range" min={spec.min} max={spec.max} step={spec.step} bind:value={amount} />
    <div class="presets">
      {#each presets as p}
        <button class="btn" onclick={() => (amount = p.v)}>{p.label}</button>
      {/each}
    </div>
    <div class="row">
      <button class="btn quiet" onclick={() => (amountFor = null)}>Cancel</button>
      <button class="btn primary" onclick={confirmAmount}>{amountFor.label} {amount.toLocaleString()}</button>
    </div>
  </div>
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
  .more {
    letter-spacing: 0.15em;
    min-height: 36px;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.25);
  }
  .menu {
    position: fixed;
    right: calc(12px + var(--safe-r));
    bottom: 12px;
    z-index: 41;
    display: flex;
    flex-direction: column;
    padding: 0.4rem;
    min-width: 13rem;
    max-height: calc(100dvh - 24px);
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
  .sheet {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(26rem, calc(100vw - 24px));
    padding: 1rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    animation: pop 0.2s var(--ease-out);
  }
  .amount {
    font-size: 2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .amount small {
    font-size: 0.9rem;
    color: var(--ink-dim);
    font-weight: 500;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--gold);
    height: 28px;
  }
  .presets,
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .presets .btn {
    flex: 1;
    min-height: 36px;
    padding: 0.3em 0.6em;
  }
  .row {
    justify-content: flex-end;
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.96;
    }
  }
</style>
