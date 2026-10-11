<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../../app.svelte';
  import { isValidCode, normaliseCode } from '../../net/protocol';
  import Card from '../components/Card.svelte';

  let { code: initialCode = '' }: { code?: string } = $props();
  let code = $state(normaliseCode(untrack(() => initialCode)));
  let name = $state(app.name);
  const saved = app.savedHost;
  const canJoin = $derived(isValidCode(code) && name.trim().length > 0);

  function commitName() {
    app.setName(name.trim());
  }
  function host() {
    if (!name.trim()) return app.say('Pick a name first');
    commitName();
    app.createRoom();
  }
  function join(display = false) {
    if (!isValidCode(code)) return app.say('Table codes are 4 letters');
    if (!display && !name.trim()) return app.say('Pick a name first');
    commitName();
    app.go(`/${display ? 'display' : 'room'}/${code}`);
  }
</script>

<div class="home">
  <section class="hero">
    <div class="fan" aria-hidden="true">
      <div class="f f1"><Card id="AS" /></div>
      <div class="f f2"><Card id="KH" /></div>
      <div class="f f3"><Card id="QD" /></div>
      <div class="f f4"><Card id="JC" /></div>
    </div>
    <h1>Cards</h1>
    <p class="tag">Your phone is your hand. Gather round one table, play any game.</p>
  </section>

  <section class="form panel">
    <label class="field">
      <span class="eyebrow">Your name</span>
      <input bind:value={name} onblur={commitName} maxlength="20" placeholder="e.g. Sam" autocomplete="nickname" enterkeyhint="done" />
    </label>

    <button class="btn primary wide" onclick={host}>Host a table</button>

    <div class="or"><span>or join one</span></div>

    <div class="join">
      <input
        class="code"
        value={code}
        oninput={(e) => (code = normaliseCode(e.currentTarget.value))}
        onkeydown={(e) => e.key === 'Enter' && join()}
        placeholder="CODE"
        maxlength="4"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        aria-label="Table code"
      />
      <button class="btn" disabled={!canJoin} onclick={() => join()}>Join</button>
    </div>
    <button class="link" disabled={!isValidCode(code)} onclick={() => join(true)}>Use this device as the table display</button>

    {#if saved}
      <button class="resume" onclick={() => app.resumeRoom(saved.code)}>
        ↻ Resume your table <b>{saved.code}</b>
      </button>
    {/if}
  </section>

  <footer>
    Peer-to-peer: devices connect directly, and on the same WiFi your game never leaves the room. No accounts, no app store.
    · <a href="https://github.com/jackhale98/cards" target="_blank" rel="noreferrer">Open source</a>
  </footer>
</div>

<style>
  .home {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 1fr minmax(280px, 380px);
    grid-template-rows: 1fr auto;
    align-items: center;
    gap: 1rem 2rem;
    padding: calc(16px + var(--safe-t)) calc(24px + var(--safe-r)) calc(10px + var(--safe-b)) calc(24px + var(--safe-l));
    overflow: auto;
  }
  @media (orientation: portrait), (max-width: 620px) {
    .home {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
      align-content: center;
    }
  }
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .fan {
    position: relative;
    width: 200px;
    height: clamp(90px, 26vh, 150px);
    --cw: clamp(56px, 15vh, 86px);
  }
  .f {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform-origin: 50% 110%;
    margin-left: calc(var(--cw) / -2);
    animation: deal 0.9s var(--ease-spring) both;
  }
  .f1 {
    --r: -24deg;
    animation-delay: 0.05s;
  }
  .f2 {
    --r: -8deg;
    animation-delay: 0.15s;
  }
  .f3 {
    --r: 8deg;
    animation-delay: 0.25s;
  }
  .f4 {
    --r: 24deg;
    animation-delay: 0.35s;
  }
  .f {
    transform: rotate(var(--r));
  }
  @keyframes deal {
    from {
      transform: rotate(0deg) translateY(30px);
      opacity: 0;
    }
  }
  h1 {
    font-family: var(--font-card);
    font-size: clamp(2.4rem, 9vh, 4rem);
    margin: 0.4rem 0 0;
    letter-spacing: -0.02em;
    background: linear-gradient(180deg, #fff6dc, var(--gold));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tag {
    margin: 0.2rem 0 0;
    color: var(--ink-dim);
    max-width: 26rem;
  }
  .form {
    padding: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  input {
    width: 100%;
    min-height: 46px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: rgba(0, 0, 0, 0.25);
    padding: 0 0.9rem;
    font-size: 1rem;
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }
  input:focus {
    border-color: var(--gold);
  }
  .wide {
    width: 100%;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--ink-faint);
    font-size: 0.75rem;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .join {
    display: flex;
    gap: 0.5rem;
  }
  .code {
    font-family: var(--font-card);
    font-size: 1.4rem;
    letter-spacing: 0.35em;
    text-transform: uppercase;
    text-align: center;
  }
  .link {
    font-size: 0.78rem;
    color: var(--ink-dim);
    text-decoration: underline;
    text-underline-offset: 3px;
    align-self: center;
    padding: 0.2rem;
  }
  .link:disabled {
    opacity: 0.4;
  }
  .resume {
    margin-top: 0.2rem;
    padding: 0.6rem;
    border-radius: 12px;
    background: rgba(233, 196, 106, 0.1);
    border: 1px solid rgba(233, 196, 106, 0.35);
    color: var(--gold);
  }
  footer {
    grid-column: 1 / -1;
    text-align: center;
    font-size: 0.72rem;
    color: var(--ink-faint);
  }
  footer a {
    color: var(--ink-dim);
  }
</style>
