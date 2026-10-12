<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();

  // focus moves into the sheet, and back to whatever opened it on close
  function focusIn(x: HTMLElement) {
    const back = document.activeElement as HTMLElement | null;
    x.focus({ preventScroll: true });
    return { destroy: () => back?.isConnected && back.focus({ preventScroll: true }) };
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<button class="scrim" onclick={onclose} aria-label="Close" tabindex="-1"></button>
<div class="sheet panel" role="dialog" aria-modal="true" aria-label={title}>
  <div class="head">
    <h3>{title}</h3>
    <button class="x" onclick={onclose} aria-label="Close" use:focusIn>×</button>
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
    background: rgba(8, 26, 20, 0.92);
    background: color-mix(in srgb, var(--felt-3) 92%, transparent);
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
