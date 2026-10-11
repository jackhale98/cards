<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../../app.svelte';
  import { isValidCode, normaliseCode } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import AvatarPicker from '../components/AvatarPicker.svelte';
  import Card from '../components/Card.svelte';
  import Sheet from '../components/Sheet.svelte';

  let { code: initialCode = '' }: { code?: string } = $props();
  let code = $state(normaliseCode(untrack(() => initialCode)));
  let name = $state(app.name);
  const saved = app.savedHost;
  const canJoin = $derived(isValidCode(code) && name.trim().length > 0);
  let picking = $state(false);

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

{#if picking}
  <Sheet title="Pick your look" onclose={() => (picking = false)}>
    <AvatarPicker value={app.avatar} {name} onpick={(a) => app.setProfile(name.trim(), a)} />
  </Sheet>
{/if}

<div class="home">
  <section class="hero">
    <div class="fan" aria-hidden="true">
      <div class="f f1"><Card id="AS" /></div>
      <div class="f f2"><Card id="KH" /></div>
      <div class="f f3"><Card id="QD" /></div>
      <div class="f f4"><Card id="JC" /></div>
    </div>
    <h1>Lamplight</h1>
    <p class="tag">Pull up a chair. Your phone is your hand.</p>
  </section>

  <section class="form panel">
    <div class="field">
      <span class="eyebrow">You</span>
      <div class="who">
        <button class="avatar-btn" onclick={() => (picking = true)} aria-label="Choose your avatar">
          <AvatarBadge avatar={app.avatar} {name} size={46} />
          <span class="edit">✎</span>
        </button>
        <input bind:value={name} onblur={commitName} maxlength="20" placeholder="e.g. Sam" autocomplete="nickname" enterkeyhint="done" aria-label="Your name" />
      </div>
    </div>

    <button class="btn primary wide light" onclick={host}>Start a table</button>

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
      <button class="btn" disabled={!canJoin} onclick={() => join()}>Deal me in</button>
    </div>
    <button class="link" disabled={!isValidCode(code)} onclick={() => join(true)}>Use this device as the table display</button>

    {#if saved}
      <button class="resume" onclick={() => app.resumeRoom(saved.code)}>
        ↻ Resume your table <b>{saved.code}</b>
      </button>
    {/if}
  </section>

  <footer>
    Devices link directly whenever they can, so on the same WiFi your game stays in the room. No accounts, no app store.
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
    /* Lamplight: a warm lamp just out of frame, upper left, over a warmer felt */
    --glow: rgba(255, 196, 118, 0.51);
    background:
      radial-gradient(ellipse 85% 150% at -6% -12%, var(--glow) 0%, rgba(255, 186, 104, 0.14) 40%, rgba(255, 186, 104, 0) 78%),
      radial-gradient(ellipse 130% 125% at 18% 10%, rgba(30, 12, 0, 0) 45%, rgba(30, 12, 0, 0.42) 100%),
      linear-gradient(rgba(255, 160, 80, 0.07), rgba(255, 160, 80, 0.07)),
      radial-gradient(ellipse 80% 70% at 50% 42%, #2f5e3e 0%, #1b3b28 55%, #0d1a10 100%);
  }
  @media (orientation: portrait), (max-width: 620px) {
    .home {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
      align-content: center;
      background:
        radial-gradient(ellipse 150% 75% at -14% -8%, var(--glow) 0%, rgba(255, 186, 104, 0.14) 40%, rgba(255, 186, 104, 0) 78%),
        radial-gradient(ellipse 150% 110% at 15% 5%, rgba(30, 12, 0, 0) 45%, rgba(30, 12, 0, 0.42) 100%),
        linear-gradient(rgba(255, 160, 80, 0.07), rgba(255, 160, 80, 0.07)),
        radial-gradient(ellipse 80% 70% at 50% 42%, #2f5e3e 0%, #1b3b28 55%, #0d1a10 100%);
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
    font-weight: 400;
    margin: 0.4rem 0 0;
    letter-spacing: -0.01em;
    color: #fbe7b2;
    text-shadow: 0 0 24px rgba(255, 200, 110, 0.35);
  }
  .tag {
    margin: 0.2rem 0 0;
    color: var(--ink-dim);
    max-width: 26rem;
  }
  .form {
    background: rgba(26, 24, 14, 0.58);
    border-color: rgba(255, 214, 140, 0.22);
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
  .who {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .avatar-btn {
    position: relative;
    padding: 0;
    border-radius: 50%;
  }
  .edit {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.7rem;
    background: var(--ink);
    color: #10231c;
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
  .light {
    background: linear-gradient(180deg, #ffe7a3, #f2b84b);
    box-shadow: 0 6px 24px rgba(242, 184, 75, 0.35);
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
