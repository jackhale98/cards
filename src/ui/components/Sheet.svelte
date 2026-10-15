<script lang="ts">
  import type { Snippet } from 'svelte';
  import { dialog } from '../dialog';
  /** `full`: nearly the whole screen, for something to browse (everyone's melds on a phone). */
  let { title, full = false, onclose, children }: { title: string; full?: boolean; onclose: () => void; children: Snippet } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<button class="scrim" onclick={onclose} aria-label="Close" tabindex="-1"></button>
<!-- (focus moves in, to the close button, and stays inside until it closes: see dialog.ts) -->
<div class="sheet panel" class:full role="dialog" aria-modal="true" aria-label={title} use:dialog={onclose}>
  <div class="head">
    <h3>{title}</h3>
    <button class="x" onclick={onclose} aria-label="Close" data-autofocus>×</button>
  </div>
  <div class="body">{@render children()}</div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.45);
    animation: fade 0.2s;
  }
  .sheet {
    position: fixed;
    z-index: 51;
    /* centred in the part of the screen clear of the status bar, notch and home bar (an app added
       to the Home Screen draws under them) */
    top: calc(50% + (var(--safe-t) - var(--safe-b)) / 2);
    left: calc(50% + (var(--safe-l) - var(--safe-r)) / 2);
    transform: translate(-50%, -50%);
    width: min(34rem, calc(100vw - 24px - var(--safe-l) - var(--safe-r)));
    max-height: calc(100vh - 24px - var(--safe-t) - var(--safe-b));
    max-height: calc(100dvh - 24px - var(--safe-t) - var(--safe-b));
    display: flex;
    flex-direction: column;
    animation: pop 0.22s var(--ease-out);
    /* (nearly solid: a game-over banner behind mustn't show through the text) */
    background: rgba(8, 26, 20, 0.97);
    background: color-mix(in srgb, var(--felt-3) 97%, transparent);
  }
  .sheet.full {
    width: calc(100vw - 16px - var(--safe-l) - var(--safe-r));
    height: calc(100vh - 16px - var(--safe-t) - var(--safe-b));
    height: calc(100dvh - 16px - var(--safe-t) - var(--safe-b));
    max-height: none;
  }
  .full .head {
    padding-top: 0.3rem;
  }
  .full .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0 0.8rem 0.6rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.8rem 1rem 0.2rem 1.2rem;
  }
  h3 {
    margin: 0;
    font-family: var(--font-card);
    font-size: 1.2rem;
  }
  .x {
    width: 40px;
    height: 40px;
    font-size: 1.5rem;
    color: var(--ink-dim);
  }
  .body {
    padding: 0.4rem 1.2rem 1.2rem;
    overflow: auto;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -46%) scale(0.97);
    }
  }
</style>
