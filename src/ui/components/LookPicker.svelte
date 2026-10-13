<script lang="ts">
  import { BACKS, CLOTHS, DEFAULT_LOOK, backVars, clothVars, type Look } from '../looks';
  import Card from './Card.svelte';

  interface Props {
    look?: Look;
    /** Only the host chooses; everyone else sees what's chosen. */
    onpick?: (look: Look) => void;
  }
  let { look = DEFAULT_LOOK, onpick }: Props = $props();
  const current = $derived({ ...DEFAULT_LOOK, ...look });
  const css = (vars: Record<string, string>) =>
    Object.entries(vars)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
</script>

<div class="look">
  <div class="eyebrow">Card backs</div>
  <div class="backs" role="radiogroup" aria-label="Card backs">
    {#each BACKS as b (b.id)}
      <button
        class="swatch"
        class:on={current.back === b.id}
        role="radio"
        aria-checked={current.back === b.id}
        aria-label={b.name}
        disabled={!onpick}
        style={css(backVars(b.id))}
        onclick={() => onpick?.({ ...current, back: b.id })}
      >
        <span class="mini"><Card id="?look" /></span>
        <span class="name">{b.name}</span>
      </button>
    {/each}
  </div>
  <div class="eyebrow">Table cloth</div>
  <div class="cloths" role="radiogroup" aria-label="Table cloth">
    {#each CLOTHS as c (c.id)}
      <button
        class="swatch"
        class:on={current.cloth === c.id}
        role="radio"
        aria-checked={current.cloth === c.id}
        aria-label={c.name}
        disabled={!onpick}
        style={css(clothVars(c.id))}
        onclick={() => onpick?.({ ...current, cloth: c.id })}
      >
        <span class="felt"></span>
        <span class="name">{c.name}</span>
      </button>
    {/each}
  </div>
  {#if !onpick}<p class="small">The host chooses the table's look.</p>{/if}
</div>

<style>
  .look {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .backs,
  .cloths {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.6rem, 1fr));
    gap: 0.5rem;
  }
  .swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 0.45rem 0.25rem 0.35rem;
    border-radius: 12px;
    border: 1px solid transparent;
    color: var(--ink-dim);
  }
  .swatch.on {
    border-color: var(--gold);
    background: rgba(233, 196, 106, 0.1);
    color: var(--ink);
  }
  .swatch:disabled {
    cursor: default;
  }
  .swatch:disabled:not(.on) {
    opacity: 0.55;
  }
  .mini {
    --cw: 2.6rem;
    display: block;
  }
  .felt {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 42%, var(--felt-1), var(--felt-2) 60%, var(--felt-3));
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .name {
    font-size: 0.68rem;
    font-weight: 600;
    text-align: center;
    line-height: 1.1;
  }
</style>
