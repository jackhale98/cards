<script lang="ts">
  import { untrack } from 'svelte';
  import type { LogEntry } from '../../engine/types';
  import { isHidden } from '../../engine/redact';
  import { type Frames, type Frame, LAYER } from '../layout/frames.svelte';
  import { offstage, placement, travel, type Placement } from '../layout/motion';
  import type { Box } from '../layout/types';
  import Card from './Card.svelte';

  /**
   * Every card on the table, in one layer. Each zone (and your hand) lays its cards out in a frame
   * of its own (see layout/ and Zone.svelte); this draws them all, each card one element for as
   * long as it's anywhere on the table, eased from place to place by its own transition. A card
   * played from your hand is the same element that lands on the pile, so nothing is swapped, and
   * nothing jumps when the page around it reflows: only where it's going changes.
   *
   * The layer only draws. What you tap is in the frames underneath (the cards' places, in order,
   * for the keyboard and screen readers too): the layer lets every touch through to them.
   */
  interface Props {
    frames: Frames;
    you: number;
    /** The latest move: where cards that weren't on the table come from, and leaving ones go. */
    entry: LogEntry | undefined;
  }
  let { frames, you, entry }: Props = $props();

  let el: HTMLDivElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** A card on screen. */
  interface Shown {
    key: string;
    /** The frame it's in (gone: where it was). */
    frame: string;
    at: Placement;
    /** How long its move takes (ms; 0 snaps). */
    ms: number;
    /** Where a new card starts (it eases from there to `at` as it's first drawn). */
    from: Placement | null;
    /** Clipped to what shows of a row that scrolls. */
    clip: string | undefined;
    leaving: boolean;
    /** On its way to another frame: over everything until it lands. */
    flying: boolean;
    /** Trading places quietly (see Frames.calm): it fades out here and in there. */
    swap: boolean;
  }
  let shown = $state<Shown[]>([]);
  /** Cards are moving, or the layer will look again shortly (`data-busy`, for tests to wait on). */
  let busy = $state(false);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const later = (key: string, ms: number, run: () => void) => {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        run();
      }, ms),
    );
  };
  const settle = (key: string, change: Partial<Shown>) => (shown = shown.map((x) => (x.key === key ? { ...x, ...change } : x)));
  $effect(() => () => timers.forEach((t) => clearTimeout(t)));

  // ---- where the frames are ----------------------------------------------------------------

  interface Seen {
    box: Box;
    /** The frame's px to the layer's (the middle is scaled to fit). */
    k: number;
    /** What shows of it, when it's in a row that scrolls. */
    clip: Box | null;
  }
  /** Where an element is, relative to the layer. */
  function boxOf(target: Element | null | undefined): Box | null {
    if (!target || !el) return null;
    const r = target.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const o = el.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }
  const intersect = (a: Box, b: Box): Box => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
  };
  function see(f: Frame): Seen | null {
    const box = boxOf(f.el);
    if (!box || !f.el.offsetWidth) return null;
    let clip: Box | null = null;
    for (let p = f.el.parentElement; p && p !== el.parentElement; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (!/(auto|scroll)/.test(st.overflowX + st.overflowY)) continue;
      const b = boxOf(p);
      if (b) clip = clip ? intersect(clip, b) : b;
    }
    return { box, k: box.w / f.el.offsetWidth, clip };
  }
  /** The part of a card at `p` inside `clip`, as its own clip-path (none when it all shows). */
  function clipFor(p: Placement, clip: Box | null): string | undefined {
    if (!clip) return undefined;
    const h = p.w * 1.4;
    const t = clip.y - (p.y - h / 2);
    const l = clip.x - (p.x - p.w / 2);
    const r = p.x + p.w / 2 - (clip.x + clip.w);
    const b = p.y + h / 2 - (clip.y + clip.h);
    if (t <= 0 && l <= 0 && r <= 0 && b <= 0) return undefined;
    return `inset(${Math.max(0, t)}px ${Math.max(0, r)}px ${Math.max(0, b)}px ${Math.max(0, l)}px)`;
  }

  // ---- when to look ------------------------------------------------------------------------

  let queued = false;
  /** Look again soon (once, however many frames changed meanwhile). */
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      update();
    });
  }
  $effect(() => {
    void frames.all;
    void frames.calm;
    schedule();
    // (and once the page has settled: the middle scales to fit a frame later, labels slide)
    const frame = requestAnimationFrame(schedule);
    const settled = setTimeout(schedule, 380);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
    };
  });
  /** A row just scrolled: its cards follow it at once. */
  let scrolled: Element | null = null;
  $effect(() => {
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    const table = el.parentElement!;
    // anything that changes on the table may move a frame without changing its cards (a headline
    // growing a line, the middle scaled to fit): look again after any change but the layer's own
    const mo = new MutationObserver((records) => {
      if (records.some((m) => !el.contains(m.target))) schedule();
    });
    mo.observe(table, { subtree: true, childList: true, attributes: true, characterData: true });
    // (and once anything around the cards has finished easing somewhere)
    const eased = (e: Event) => e.target instanceof Element && !el.contains(e.target) && schedule();
    table.addEventListener('transitionend', eased);
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element)) return;
      scrolled = e.target;
      update();
      scrolled = null;
    };
    table.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      table.removeEventListener('transitionend', eased);
      table.removeEventListener('scroll', onScroll, { capture: true });
    };
  });

  // ---- what changed ------------------------------------------------------------------------

  /** Each frame's card count last time: a frame that didn't grow didn't get a card from anywhere. */
  let counts = new Map<string, number>();
  let calm = '';

  /** Just above the screen, in the middle: where the table is, from a phone that shows only your hand. */
  const offTop = (): Box => ({ x: el.clientWidth / 2 - 24, y: -80, w: 48, h: 67 });
  /** A seat's place (yours: your hand), to come from or go to. */
  function seatBox(seat: number | undefined): Box | null {
    if (seat == null || seat < 0) return null;
    const table = el.parentElement!;
    if (seat === you) return boxOf(frames.all.hand?.el) ?? boxOf(table.querySelector('.me'));
    return boxOf(table.querySelector(`[data-seat="${seat}"]`));
  }

  function update() {
    if (!el) return;
    const all = frames.all;
    const move = untrack(() => entry);
    // every frame's cards, where they are on screen now
    const seen = new Map<string, Seen>();
    const now = new Map<string, { frame: string; at: Placement; clip: string | undefined }>();
    for (const [name, f] of Object.entries(all)) {
      const s = see(f);
      if (!s) continue;
      seen.set(name, s);
      for (const p of f.spots) {
        const at = placement({ ...p, x: s.box.x + p.x * s.k, y: s.box.y + p.y * s.k, w: p.w * s.k, z: p.held ? LAYER.held : f.layer + p.z });
        now.set(p.key, { frame: name, at, clip: clipFor(at, s.clip) });
      }
    }
    const frameOfZone = (zone: string | undefined) => (zone ? Object.keys(all).find((k) => all[k].zone === zone && seen.has(k)) : undefined);
    /** A frame's top card (where a card put on it lands), or its middle. */
    const topOf = (name: string): { box: Box; w: number } => {
      const s = seen.get(name)!;
      const top = [...all[name].spots].sort((a, b) => a.z - b.z).at(-1);
      if (!top) return { box: s.box, w: Math.min(s.box.w, s.box.h / 1.4) };
      const w = top.w * s.k;
      return { box: { x: s.box.x + top.x * s.k - w / 2, y: s.box.y + top.y * s.k - w * 0.7, w, h: w * 1.4 }, w };
    };
    const buried = new Set(Object.values(all).flatMap((f) => f.ids));
    const swapping = frames.calm !== calm;
    calm = frames.calm;

    const out: Shown[] = [];
    const had = new Set<string>();
    /** Frames that cards were just put on (and how long they take to get there). */
    const landing = new Map<string, number>();
    for (const c of shown) {
      had.add(c.key);
      const next = now.get(c.key);
      if (next) {
        // staying, or moving: the same element eases there
        const moved = next.frame !== c.frame;
        if (moved && swapping && !still) {
          out.push({ ...c, frame: next.frame, at: { ...next.at, delay: 260 }, ms: 0, from: null, clip: next.clip, leaving: false, flying: false, swap: true });
          later(c.key, 600, () => settle(c.key, { swap: false }));
          continue;
        }
        const snap = !!scrolled && scrolled.contains(all[next.frame].el);
        const ms = snap ? 0 : travel(c.at, next.at);
        if (moved) later(c.key, ms + 40, () => settle(c.key, { flying: false }));
        else if (c.leaving) clearTimeout(timers.get(c.key));
        out.push({
          key: c.key,
          frame: next.frame,
          at: next.at,
          ms,
          from: null,
          clip: next.clip,
          leaving: false,
          flying: moved || (c.flying && !c.leaving),
          swap: false,
        });
        continue;
      }
      if (c.leaving) {
        out.push(c);
        continue;
      }
      // gone from every frame: under a pile's top, onto a pile, or to someone's hand
      let away: Placement;
      let ms: number;
      if (buried.has(c.at.id)) {
        away = { ...c.at, z: 1, opacity: 0 };
        ms = 200;
      } else {
        const toFrame = frameOfZone(move?.toZone);
        if (toFrame && toFrame !== c.frame) {
          const top = topOf(toFrame);
          away = offstage(c.at, top.box, { arriving: false, pile: { w: top.w } });
        } else {
          const seat = move?.to ?? move?.seat;
          // (from your hand to a pile not on this screen, the phone beside a table screen: up, toward the table)
          away = offstage(c.at, c.frame === 'hand' && (seat == null || seat === you) ? offTop() : seatBox(seat), { arriving: false });
        }
        away.z = LAYER.leaving + (c.at.z % 100);
        ms = still ? 0 : travel(c.at, away);
        if (toFrame) landing.set(toFrame, Math.max(landing.get(toFrame) ?? 0, ms));
      }
      out.push({ ...c, at: away, ms, from: null, leaving: true, flying: false, swap: false });
      later(c.key, ms + 80, () => (shown = shown.filter((x) => x.key !== c.key || !x.leaving)));
    }

    // cards new to the table: where each comes from
    const arriving = [...now].filter(([key]) => !had.has(key));
    const perFrame = new Map<string, number>();
    for (const [, n] of arriving) perFrame.set(n.frame, (perFrame.get(n.frame) ?? 0) + 1);
    const dealt = new Map<string, number>();
    for (const [key, n] of arriving) {
      const f = all[n.frame];
      const grew = !counts.has(n.frame) || f.ids.length > (counts.get(n.frame) ?? 0);
      const hidden = isHidden(n.at.id);
      let start: Placement;
      let at = n.at;
      let ms: number;
      if (still) {
        start = { ...at, opacity: 0 };
        ms = 0;
      } else if (hidden && landing.has(n.frame)) {
        // put there face down: it shows once the card going there has landed
        start = { ...at, opacity: 0 };
        at = { ...at, delay: landing.get(n.frame)! };
        ms = 1;
      } else if (hidden && !grew) {
        // (it was there already, under another name: the pile's next card)
        start = { ...at, opacity: 0 };
        ms = 120;
      } else {
        const fromFrame = frameOfZone(move?.fromZone);
        if (fromFrame === n.frame) start = { ...at, opacity: 0 };
        else if (fromFrame) {
          const top = topOf(fromFrame);
          start = offstage(at, top.box, { arriving: true, pile: { w: top.w } });
        } else {
          // (a player's own zone, their melds or their hand shown down: from their seat)
          const seat = f.owner != null && f.owner !== you && n.frame !== 'hand' ? f.owner : move?.seat;
          // (into your hand from a pile not on this screen: down from the table, not up out of your own hand)
          const fromAbove = n.frame === 'hand' && !!move?.fromZone && (seat == null || seat === you);
          start = offstage(at, fromAbove ? offTop() : seatBox(seat), { arriving: true });
        }
        ms = travel(start, at);
        // a new hand comes in a card at a time
        if ((perFrame.get(n.frame) ?? 0) >= 5) {
          const i = dealt.get(n.frame) ?? 0;
          dealt.set(n.frame, i + 1);
          at = { ...at, delay: Math.min(600, i * 30) };
        }
      }
      const flying = !still && ms > 1;
      out.push({ key, frame: n.frame, at, ms, from: start, clip: n.clip, leaving: false, flying, swap: false });
      if (flying) later(key, ms + at.delay + 40, () => settle(key, { flying: false }));
    }
    counts = new Map(Object.entries(all).map(([k, f]) => [k, f.ids.length]));
    // (nothing moved: leave it all be, so a look that finds nothing new costs nothing)
    if (out.length === shown.length && out.every((c, i) => same(c, shown[i]))) return;
    shown = out;
    // (busy until the longest move ends, and the second look after a change has been taken)
    const longest = Math.max(400, ...out.map((c) => c.ms + c.at.delay));
    busy = true;
    later('', longest + 60, () => (busy = false));
  }

  /** The same card in the same place, looking the same. */
  function same(a: Shown, b: Shown): boolean {
    if (a.key !== b.key || a.frame !== b.frame || a.leaving !== b.leaving || a.flying !== b.flying || a.swap !== b.swap || a.clip !== b.clip) return false;
    const p = a.at;
    const q = b.at;
    return (
      Math.abs(p.x - q.x) < 0.5 &&
      Math.abs(p.y - q.y) < 0.5 &&
      Math.abs(p.w - q.w) < 0.5 &&
      p.rot === q.rot &&
      p.z === q.z &&
      p.opacity === q.opacity &&
      p.id === q.id &&
      p.down === q.down &&
      p.selected === q.selected &&
      p.playable === q.playable &&
      p.dim === q.dim &&
      p.fresh === q.fresh &&
      p.glow === q.glow &&
      p.count === q.count &&
      p.held === q.held
    );
  }

  // ---- drawing -----------------------------------------------------------------------------

  const place = (p: Placement) => `translate(${p.x - p.w / 2}px, ${p.y - p.w * 0.7}px) rotate(${p.rot}deg)`;
  /** A new card starts where it comes from, and then eases to its place (set before it's first drawn). */
  function arrive(node: HTMLElement, from: Placement | null) {
    if (!from) return;
    const keep = { transform: node.style.transform, opacity: node.style.opacity, cw: node.style.getPropertyValue('--cw') };
    // (the property only: the inline duration and delay stay as they are)
    node.style.transitionProperty = 'none';
    node.style.transform = place(from);
    node.style.opacity = String(from.opacity);
    node.style.setProperty('--cw', `${from.w}px`);
    void node.offsetWidth;
    node.style.transitionProperty = '';
    node.style.transform = keep.transform;
    node.style.opacity = keep.opacity;
    node.style.setProperty('--cw', keep.cw);
  }
  /** Trading places quietly: out where it was, in where it's going (the move itself waits for the middle of it). */
  function fadeSwap(node: HTMLElement, on: boolean) {
    const run = (yes: boolean) => {
      if (yes)
        node.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: 560, easing: 'ease-in-out' });
    };
    run(on);
    return { update: run };
  }
</script>

<!-- (only pictures: what you tap, and what a screen reader reads, is in the frames underneath) -->
<div class="layer" bind:this={el} aria-hidden="true" data-busy={busy || undefined}>
  {#each shown as c (c.key)}
    {@const p = c.at}
    <div
      class="layer-card"
      class:held={p.held}
      class:glow={p.glow}
      data-key={c.key}
      data-card={p.id}
      data-frame={c.frame}
      data-in={frames.all[c.frame]?.zone ?? c.frame}
      data-leaving={c.leaving || undefined}
      style:transform={place(p)}
      style:--cw="{p.w}px"
      style:z-index={c.flying ? LAYER.flying + (p.z % 100) : p.z}
      style:opacity={p.opacity}
      style:transition-duration="{c.ms}ms"
      style:transition-delay="{p.delay}ms"
      style:clip-path={c.clip}
      use:arrive={c.from}
      use:fadeSwap={c.swap}
    >
      <Card id={p.id} down={p.down} selected={p.selected} playable={p.playable} dim={p.dim} fresh={p.fresh} />
      {#if p.count}<span class="count">{p.count}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    overflow: hidden;
  }
  .layer-card {
    position: absolute;
    left: 0;
    top: 0;
    transition-property: transform, --cw, opacity;
    transition-timing-function: var(--ease-out);
  }
  .layer-card.held {
    transition: none;
  }
  /* (the pile's yours to tap now) */
  .layer-card.glow {
    filter: drop-shadow(0 0 8px rgba(233, 196, 106, 0.8));
  }
  /* a squared pile's size, on its corner */
  .count {
    position: absolute;
    left: calc(var(--cw) * -0.08);
    bottom: calc(var(--cw) * -0.08);
    min-width: 1.5em;
    padding: 0.05em 0.35em;
    border-radius: 999px;
    background: var(--gold);
    color: #1a1408;
    font-size: max(11px, calc(var(--cw) * 0.22));
    font-weight: 800;
    line-height: 1.3;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  @media (prefers-reduced-motion: reduce) {
    .layer-card {
      transition: none;
    }
  }
</style>
