<script lang="ts">
  import { untrack } from 'svelte';
  import type { ActionSpec } from '../../engine/types';
  import { parseTyped, quickAdds, sliderToValue, snap, valueToSlider, SLIDER_STEPS } from '../amount';

  interface Props {
    spec: ActionSpec;
    pot?: number;
    onconfirm: (amount: number) => void;
    oncancel: () => void;
  }
  let { spec, pot = 0, onconfirm, oncancel }: Props = $props();

  const a = $derived(spec.amount!);
  // what's in the box; the slider, chips and steppers all write here too
  let text = $state(String(untrack(() => spec.amount!.default)));
  const parsed = $derived(parseTyped(text, a));
  const value = $derived('value' in parsed ? parsed.value : null);
  const error = $derived('error' in parsed ? parsed.error : null);
  const small = $derived((a.max - a.min) / a.step <= 15);
  const isChips = $derived(a.label === 'chips');
  const current = () => value ?? snap(Number(text.replace(/[^\d]/g, '')) || a.min, a);

  function set(v: number) {
    text = String(snap(v, a));
  }

  const presets = $derived.by(() => {
    const out: { label: string; v: number }[] = [{ label: 'Min', v: a.min }];
    if (pot > 0 && isChips) {
      out.push({ label: '½ pot', v: Math.round(pot / 2) });
      out.push({ label: 'Pot', v: pot });
    }
    out.push({ label: a.max >= 1000 && isChips ? 'All in' : 'Max', v: a.max });
    return out.filter((o, i, all) => o.v >= a.min && o.v <= a.max && all.findIndex((x) => x.v === o.v) === i);
  });

  function confirm() {
    if (value != null) onconfirm(value);
  }

  let input: HTMLInputElement;
</script>

<button class="scrim" onclick={oncancel} aria-label="Cancel"></button>
<div class="sheet panel" role="dialog" aria-label={spec.label}>
  <div class="head">
    <span class="eyebrow">{spec.label}{a.label ? ` · ${a.label}` : ''}</span>
    <button class="x" onclick={oncancel} aria-label="Cancel">×</button>
  </div>

  <!-- the essentials share one row so they stay visible above the on-screen keyboard -->
  <div class="entry">
    <button class="step" onclick={() => set(current() - a.step)} disabled={current() <= a.min} aria-label="Less">−</button>
    <input
      bind:this={input}
      class="value"
      class:bad={!!error}
      type="text"
      inputmode="numeric"
      pattern="[0-9]*"
      autocomplete="off"
      bind:value={text}
      onfocus={() => input.select()}
      onkeydown={(e) => e.key === 'Enter' && confirm()}
      aria-label="Amount"
    />
    <button class="step" onclick={() => set(current() + a.step)} disabled={current() >= a.max} aria-label="More">+</button>
    <button class="btn primary go" disabled={value == null} onclick={confirm}>
      {spec.label}{value != null ? ` ${value.toLocaleString()}` : ''}
    </button>
  </div>
  <div class="error" aria-live="polite">{error ?? ''}</div>

  {#if small}
    <div class="numbers">
      {#each { length: (a.max - a.min) / a.step + 1 } as _, i}
        {@const v = a.min + i * a.step}
        <button class="num" class:on={v === value} onclick={() => set(v)}>{v}</button>
      {/each}
    </div>
  {:else}
    <input
      class="slider"
      type="range"
      min="0"
      max={SLIDER_STEPS}
      value={valueToSlider(current(), a)}
      oninput={(e) => set(sliderToValue(Number(e.currentTarget.value), a))}
      aria-label="Amount slider"
    />
    <div class="chips">
      {#each presets as p}
        <button class="chip" class:on={p.v === value} onclick={() => set(p.v)}>{p.label}</button>
      {/each}
      {#each quickAdds(a) as c}
        <button class="chip add" onclick={() => set(current() + c)} disabled={current() >= a.max}>+{c.toLocaleString()}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.1) 70%);
  }
  /* pinned to the top so your hand stays visible (and it sits above the keyboard) */
  .sheet {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: calc(6px + var(--safe-t));
    transform: translateX(-50%);
    width: min(32rem, calc(100vw - 24px));
    padding: 0.5rem 0.8rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    background: rgba(8, 26, 20, 0.97);
    background: color-mix(in srgb, var(--felt-3) 97%, transparent);
    animation: pop 0.2s var(--ease-out);
    max-height: calc(100vh - 12px);
    max-height: calc(100dvh - 12px);
    overflow: auto;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -6px);
    }
  }
  .head {
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
  .entry {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .step {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid var(--line);
    font-size: 1.4rem;
    font-weight: 600;
  }
  .step:disabled {
    opacity: 0.3;
  }
  .value {
    flex: 1;
    min-width: 0;
    height: 44px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: rgba(0, 0, 0, 0.3);
    text-align: center;
    font-size: 1.5rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }
  .value:focus {
    border-color: var(--gold);
  }
  .value.bad {
    border-color: var(--danger);
  }
  .go {
    flex: none;
    min-height: 44px;
  }
  .error {
    min-height: 0.9rem;
    font-size: 0.72rem;
    color: #ffb4a2;
    text-align: center;
    margin-top: -0.2rem;
  }
  .slider {
    width: 100%;
    accent-color: var(--gold);
    height: 28px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .chip {
    flex: 1 0 auto;
    min-height: 34px;
    padding: 0 0.7rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
    font-weight: 600;
    font-size: 0.85rem;
  }
  .chip.on {
    background: var(--gold);
    color: #2a1d05;
    border-color: transparent;
  }
  .chip.add {
    color: var(--gold);
  }
  .chip:disabled {
    opacity: 0.35;
  }
  .numbers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
    gap: 0.3rem;
  }
  .num {
    height: 36px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
    font-weight: 700;
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
  }
  .num.on {
    background: var(--gold);
    color: #2a1d05;
    border-color: transparent;
  }
</style>
