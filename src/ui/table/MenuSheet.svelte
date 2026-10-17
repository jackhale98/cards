<script lang="ts">
  import { app, inviteUrl } from '../../app.svelte';
  import type { GameInfo } from '../../games';
  import { SCREEN_SOUND } from '../../net/host/limits';
  import type { View } from '../../net/protocol';
  import Sheet from '../components/Sheet.svelte';
  import { bugReportLink } from '../contact';
  import { HAND_SORT_LABEL } from '../handOrder';
  import { canNotify } from '../turnAlert';
  import type { TableSettings } from './settings.svelte';

  /** The table's menu: this device's settings, the table's own, saving and sharing, leaving; then How to play. */
  let {
    view,
    game,
    rules,
    settings,
    display,
    replay,
    onsheet,
    onsort,
    onclose,
  }: {
    view: View;
    game: GameInfo;
    /** The game's How to play lines, for this many players. */
    rules: string[];
    settings: TableSettings;
    display: boolean;
    /** A finished hand's replay is on screen. */
    replay: boolean;
    /** Open another sheet in its place. */
    onsheet: (sheet: 'save' | 'tv' | 'look') => void;
    /** The hand's order changed (cards you'd moved go back into it). */
    onsort: () => void;
    onclose: () => void;
  } = $props();

  let fullscreen = $state(!!document.fullscreenElement);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as any).lock?.('landscape').catch(() => {});
      }
    } catch {
      // (Safari on iPhone has no full screen for websites; an app added to the Home Screen does)
      app.say('Full screen isn’t available here — on iPhone, tap Share, then Add to Home Screen');
    }
  }
  const screenSoundOn = $derived(view.lobby.screenSound !== false);
</script>

<svelte:window onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />

<Sheet title="Table {view.lobby.code}" {onclose}>
  <div class="menu-list">
    <button class="btn" onclick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
    <button class="btn" onclick={() => settings.toggleSound()}
      >{display ? (settings.sound ? 'Sound here: on' : 'Sound here: off') : settings.sound ? 'Sound: on' : 'Sound: off'}</button
    >
    {#if !display}
      <button class="btn" onclick={() => settings.toggleFourColour()}>{settings.fourColour ? 'Four-colour suits: on' : 'Four-colour suits: off'}</button>
      <button class="btn" onclick={() => settings.toggleHints()}>{settings.hints ? 'Show playable cards: on' : 'Show playable cards: off'}</button>
      {#if canNotify()}
        <button class="btn" onclick={() => settings.toggleTurnAlerts()}>{settings.turnAlerts ? 'Turn notifications: on' : 'Turn notifications: off'}</button>
      {/if}
      <button
        class="btn"
        onclick={() => {
          settings.nextHandSort();
          onsort();
        }}>Hand: {HAND_SORT_LABEL[settings.handSort]}</button
      >
    {/if}
    {#if view.lobby.displays && !display}
      <button class="btn" onclick={() => app.act({ type: SCREEN_SOUND, amount: screenSoundOn ? 0 : 1 })}
        >{screenSoundOn ? 'TV sound: on' : 'TV sound: off'}</button
      >
    {/if}
    {#if view.lobby.displays && !display}
      <button
        class="btn"
        onclick={() => {
          app.setHandMode(!app.handMode);
          onclose();
        }}
      >
        {app.handMode ? 'Show whole table' : 'Just my hand'}
      </button>
    {/if}
    {#if view.replays && !display && !replay}
      <button
        class="btn"
        onclick={() => {
          app.showReplay(0, 0);
          onclose();
        }}>Replay the last hand</button
      >
    {/if}
    {#if !display && !game.realtime}<button class="btn" onclick={() => onsheet('save')}>Save this game</button>{/if}
    {#if !display}<button class="btn" onclick={() => onsheet('tv')}>Show on a TV</button>{/if}
    {#if app.controls}<button class="btn" onclick={() => onsheet('look')}>Card backs & cloth</button>{/if}
    <button
      class="btn"
      onclick={() => {
        navigator.clipboard?.writeText(inviteUrl(view.lobby.code));
        app.say('Invite link copied');
      }}>Copy invite link</button
    >
    {#if app.controls}
      <button
        class="btn good"
        onclick={() => {
          app.controls?.endGame();
          onclose();
        }}>Back to lobby</button
      >
    {/if}
    <a class="btn" href={bugReportLink({ game: game.config.name, table: view.lobby.code })}>Report a problem</a>
    {#if import.meta.env.DEV}
      <!-- (development builds: the table as it stands, to load back with the home screen's "Load debug snapshot") -->
      <button
        class="btn"
        onclick={() => {
          navigator.clipboard?.writeText(app.debugSnapshot());
          app.say('Debug snapshot copied');
        }}>Copy debug snapshot</button
      >
    {/if}
    <button
      class="btn danger"
      onclick={() => {
        app.leave();
        app.go('/');
      }}>{app.isHost ? 'Close table' : 'Leave table'}</button
    >
  </div>
  {#if rules.length}
    <div class="eyebrow">How to play {game.config.name}</div>
    <ul class="rules">
      {#each rules as r, k (k)}<li>{r}</li>{/each}
    </ul>
  {/if}
</Sheet>

<style>
  .menu-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  /* (a label too long for its button wraps rather than spilling over the next one) */
  .menu-list > .btn {
    min-width: 0;
    white-space: normal;
    text-align: center;
  }
  /* (a phone on its side: four across, so the whole menu fits without scrolling) */
  @media (max-height: 440px) and (min-width: 560px) {
    .menu-list {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.4rem;
      margin-bottom: 0.4rem;
    }
    .menu-list > .btn {
      padding: 0.4em 0.5em;
      font-size: 0.85rem;
    }
  }
  .rules {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
    color: var(--ink-dim);
    font-size: 0.88rem;
    line-height: 1.45;
  }
</style>
