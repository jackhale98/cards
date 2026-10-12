<script lang="ts">
  import { bugReportLink, CONTACT_EMAIL, gameRequestLink, SUPPORT_URL } from '../contact';
  import { untrack } from 'svelte';
  import { app } from '../../app.svelte';
  import { CODE_LENGTH, isValidCode, normaliseCode } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import AvatarPicker from '../components/AvatarPicker.svelte';
  import Card from '../components/Card.svelte';
  import Sheet from '../components/Sheet.svelte';

  let { code: initialCode = '' }: { code?: string } = $props();
  let code = $state(normaliseCode(untrack(() => initialCode)));
  /** Arrived by an invite link (`#/join/ABCD`). */
  const invited = untrack(() => (isValidCode(normaliseCode(initialCode)) ? normaliseCode(initialCode) : ''));
  let name = $state(app.name);
  const saved = app.savedHost;
  // the button lights up as soon as the code is complete; a missing name is asked for on tap
  const canJoin = $derived(isValidCode(code));
  let nameInput: HTMLInputElement;
  let needName = $state(false);
  /** No name yet: point at the name box instead of silently doing nothing. */
  function askForName() {
    needName = true;
    nameInput?.focus();
    app.say('Add your name first, so everyone knows who you are');
  }
  let picking = $state(false);
  let about = $state(false);

  function commitName() {
    app.setName(name.trim());
  }
  function host() {
    if (!name.trim()) return askForName();
    commitName();
    app.createRoom();
  }
  function join(display = false) {
    if (!isValidCode(code)) return app.say(`Table codes are ${CODE_LENGTH} letters`);
    if (!display && !name.trim()) return askForName();
    commitName();
    app.go(`/${display ? 'display' : 'room'}/${code}`);
  }
</script>

{#if picking}
  <Sheet title="Pick your look" onclose={() => (picking = false)}>
    <AvatarPicker value={app.avatar} {name} onpick={(a) => app.setProfile(name.trim(), a)} />
  </Sheet>
{/if}

{#if about}
  <Sheet title="How Lamplight works" onclose={() => (about = false)}>
    <div class="about">
      <h4>Playing together</h4>
      <ol>
        <li><b>One person starts a table</b> and picks the game.</li>
        <li><b>Everyone else joins</b> by scanning the QR code, typing the five-letter table code, or tapping the invite link (it works from anywhere, not just the same room).</li>
        <li><b>Your phone is your hand.</b> Turn it sideways: your cards at the bottom, the table in the middle. Each phone only ever gets its own cards.</li>
        <li><b>Short of players?</b> Bots fill empty seats, Easy, Normal or Hard.</li>
        <li><b>A game we don't have?</b> Pick <b>Free Table</b>, at the end of the game list: a real deck with no rules enforced. Deal, draw, play, pass and bet however your game goes, house rules welcome, and anyone can undo a slip.</li>
      </ol>

      <h4>Game night</h4>
      <ul>
        <li>Every finished game adds to the evening's <b>scoreboard</b>: 3, 2 and 1 points for the podium, and partners share.</li>
        <li><b>More people than the game seats?</b> Everyone still gets a seat at the table. The host taps <b>In / Out</b> to choose who plays; the rest watch, and whoever sat out plays next.</li>
        <li><b>Split the table</b> to run two games at once: the host picks a group and whose phone hosts their new table. They take the scoreboard with them, and <b>Everyone back</b> brings them home with their games added.</li>
      </ul>

      <h4>Go full screen</h4>
      <ul>
        <li><b>Android:</b> tap <b>Full screen</b> in the table menu (☰) — the browser's bars disappear and the table fills the phone.</li>
        <li><b>iPhone:</b> Safari doesn't allow full screen for websites, so add Lamplight to your Home Screen: tap <b>Share</b>, then <b>Add to Home Screen</b>. Open it from that icon and it fills the screen like an app.</li>
      </ul>

      <h4>On a TV or a big screen</h4>
      <ul>
        <li><b>Chromecast or Google TV:</b> tap <b>📺 TV</b> in the lobby (or <b>Show on a TV</b> in the table menu), then <b>Cast</b>. Cast from Chrome or Edge on any device at the table — a player's Android phone, or a laptop.</li>
        <li><b>Any TV with a web browser:</b> open <b>lamplight.cards/tv</b> on it, and type the code it shows into <b>Show on a TV</b> on a phone.</li>
        <li><b>A laptop or tablet in the middle:</b> open the site and choose <b>Use this device as the table display</b>. A laptop doing this can cast it on to the TV too.</li>
        <li>With a table screen on, phones switch to a bigger hand. Mute the TV from any phone's table menu (<b>TV sound</b>).</li>
        <li><b>Apple TV:</b> use Screen Mirroring from a spare iPad or phone showing the table display — not your own phone, or everyone sees your hand.</li>
      </ul>

      <h4>Make it yours</h4>
      <ul>
        <li>Tap your avatar to pick an emoji and colour.</li>
        <li>The host chooses the <b>card backs and table cloth</b> for everyone (🎴 in the lobby, or the table menu mid-game).</li>
      </ul>

      <h4>Good to know</h4>
      <ul>
        <li>Refresh or lose signal and you keep your seat. If the host's phone drops out, any player can <b>take over hosting</b> and the game carries on.</li>
        <li>Rules follow <a href="https://www.pagat.com" target="_blank" rel="noreferrer">pagat.com</a>; each game's rules are in its table menu.</li>
        <li>No accounts, no ads, nothing to install.</li>
        <li>Found a bug, or want a game we don't have? Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</li>
        <li>Lamplight is free. If it makes your game nights better, you can <a href={SUPPORT_URL} target="_blank" rel="noreferrer">buy us a beer on Ko-fi</a> 🍺</li>
      </ul>
    </div>
  </Sheet>
{/if}

<div class="home">
  <button class="info" onclick={() => (about = true)} aria-label="How Lamplight works">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6" />
      <circle cx="12" cy="7.6" r="1.25" fill="currentColor" />
      <path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  </button>
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
        <input
          bind:this={nameInput}
          class:need={needName && !name.trim()}
          bind:value={name}
          oninput={() => (needName = false)}
          onblur={commitName} maxlength="20" placeholder="e.g. Sam" autocomplete="nickname" enterkeyhint="done" aria-label="Your name" />
      </div>
    </div>

    <!-- arriving by an invite, joining is the main thing to do -->
    <button class="btn wide" class:primary={!invited} class:light={!invited} onclick={host}>Start a table</button>

    {#if invited}
      <p class="invited">You're invited to table <b>{invited}</b> — add your name and deal yourself in.</p>
    {/if}
    <div class="or"><span>or join one</span></div>

    <div class="join">
      <input
        class="code"
        value={code}
        oninput={(e) => (code = normaliseCode(e.currentTarget.value))}
        onkeydown={(e) => e.key === 'Enter' && join()}
        placeholder="CODE"
        maxlength={CODE_LENGTH}
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        aria-label="Table code"
      />
      <button class="btn" class:primary={!!invited} class:light={!!invited} disabled={!canJoin} onclick={() => join()}>Deal me in</button>
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
    · <a href={bugReportLink()}>Report a bug</a>
    · <a href={gameRequestLink()}>Request a game</a>
    · <a href={SUPPORT_URL} target="_blank" rel="noreferrer">🍺 Support Lamplight</a>
  </footer>
</div>

<style>
  .info {
    position: absolute;
    z-index: 2;
    top: calc(10px + var(--safe-t));
    right: calc(12px + var(--safe-r));
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--glass);
    border: 1px solid var(--line);
    color: var(--ink-dim);
  }
  .about h4 {
    margin: 1rem 0 0.35rem;
    font-family: var(--font-card);
    font-size: 1.02rem;
    color: var(--gold);
  }
  .about h4:first-child {
    margin-top: 0.2rem;
  }
  .about li {
    margin: 0 0 0.45rem;
    line-height: 1.45;
    color: var(--ink-dim);
  }
  .about b {
    color: var(--ink);
  }
  .about ol,
  .about ul {
    margin: 0;
    padding-left: 1.2rem;
  }
  .about a {
    color: inherit;
  }
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
  input.need {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px rgba(233, 196, 106, 0.35);
  }
  .invited {
    margin: 0.2rem 0 0;
    padding: 0.5rem 0.7rem;
    border-radius: 12px;
    background: rgba(233, 196, 106, 0.12);
    border: 1px solid rgba(233, 196, 106, 0.3);
    font-size: 0.85rem;
    text-align: center;
  }
</style>
