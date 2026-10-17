<script lang="ts">
  import { app } from '../../app.svelte';
  import Sheet from './Sheet.svelte';

  /**
   * A standby director: a second device (a laptop, a spare phone) opens this link and keeps a
   * sealed copy of the tournament; if this device stops, it can take over directing. Whoever has
   * the link can, so it goes only to a device you trust.
   */
  let { standby, onclose }: { standby: { link: string; linked: number; copiedAt: number | null; tooBig: boolean }; onclose: () => void } = $props();

  let qr = $state('');
  $effect(() => {
    import('qrcode')
      .then((QR) => QR.toDataURL(standby.link, { margin: 1, width: 320, color: { dark: '#0b2a21', light: '#fbf8f1' } }))
      .then((x) => (qr = x))
      .catch(() => {});
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(standby.link);
      app.say('Link copied');
    } catch {
      app.say('Couldn’t copy the link — select it and copy it instead');
    }
  }
</script>

<Sheet title="A standby director" {onclose}>
  <div class="standby">
    <p>
      If this device stops — a flat battery, a closed lid — a standby can carry on directing. Open this link on a second device you trust and leave it showing;
      it keeps a sealed copy of the tournament, which opens only if it has to take over.
    </p>
    {#if qr}<img src={qr} alt="QR code for the standby link" />{/if}
    <div class="link">
      <input readonly value={standby.link} aria-label="Standby link" onfocus={(e) => e.currentTarget.select()} />
      <button class="btn" onclick={copy}>Copy</button>
    </div>
    <p class="state" role="status">
      {#if standby.tooBig}
        The tournament has grown too big to copy to a standby.
      {:else if standby.linked}
        {standby.linked === 1 ? 'A device is' : `${standby.linked} devices are`} standing by{standby.copiedAt ? ', with a copy' : ''}.
      {:else}
        No device is standing by yet.
      {/if}
    </p>
  </div>
</Sheet>

<style>
  .standby {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.7rem;
  }
  p {
    margin: 0;
    line-height: 1.45;
    color: var(--ink-dim);
  }
  img {
    width: 11rem;
    justify-self: center;
    border-radius: 0.5rem;
  }
  .link {
    display: flex;
    gap: 0.5rem;
    min-width: 0;
  }
  .link input {
    flex: 1;
    min-width: 0;
    font-size: 0.8rem;
  }
  .link .btn {
    flex: none;
  }
  .state {
    color: var(--ink);
    font-weight: 600;
  }
</style>
