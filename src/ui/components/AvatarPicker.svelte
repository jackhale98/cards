<script lang="ts">
  import { AVATAR_COLORS, AVATAR_EMOJI, type Avatar } from '../../net/protocol';
  import AvatarBadge from './AvatarBadge.svelte';

  let { value, name, onpick }: { value: Avatar; name: string; onpick: (a: Avatar) => void } = $props();
</script>

<div class="picker">
  <div class="preview">
    <AvatarBadge avatar={value} {name} size={64} />
    <b>{name || 'You'}</b>
  </div>
  <div class="eyebrow">Icon</div>
  <div class="emoji">
    {#each AVATAR_EMOJI as e}
      <button class:on={e === value.emoji} onclick={() => onpick({ ...value, emoji: e })} aria-label="Avatar {e}">{e}</button>
    {/each}
  </div>
  <div class="eyebrow">Colour</div>
  <div class="colors">
    {#each AVATAR_COLORS as c}
      <button class:on={c === value.color} style:--c={c} onclick={() => onpick({ ...value, color: c })} aria-label="Colour {c}"></button>
    {/each}
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.1rem;
    margin-bottom: 0.3rem;
  }
  .emoji {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
    gap: 0.3rem;
  }
  .emoji button {
    height: 42px;
    font-size: 1.4rem;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid transparent;
    transition: transform 0.12s;
  }
  .emoji button:active {
    transform: scale(0.9);
  }
  .emoji button.on {
    border-color: var(--gold);
    background: rgba(233, 196, 106, 0.15);
  }
  .colors {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .colors button {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--c);
    border: 3px solid transparent;
    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.2);
  }
  .colors button.on {
    border-color: #fff;
  }
</style>
