<script lang="ts">
  import type { ScoreHistory } from '../../net/protocol';

  /**
   * How the game has gone, hand by hand: each player's (or team's) running total as a line, with
   * a legend, the names at the line ends when there are only a few, a tap or hover to read any
   * hand, and the same numbers as a table below.
   */
  let { history }: { history: ScoreHistory } = $props();

  /**
   * The lines' colours, in row order (a colour follows the player, never their place). Chosen
   * for the dark felt and checked for colour-blind readers: neighbours stay apart, and each
   * stands at least 3:1 off the background. More than eight: the table alone.
   */
  const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#008300'];

  let w = $state(0);
  const H = 170;
  const names = $derived(history.names);
  const rows = $derived(history.totals);
  const n = $derived(rows.length);
  const charted = $derived(n >= 2 && names.length <= COLORS.length && names.length > 0);
  /** Names at the line ends: only with a few lines (the legend carries the rest). */
  const endLabels = $derived(names.length <= 4);
  const pad = $derived({ l: 40, r: endLabels ? Math.min(90, 14 + Math.max(...names.map((x) => x.length)) * 6.5) : 12, t: 10, b: 22 });

  /** Round tick steps (1, 2, 5 × 10ⁿ), about four of them. */
  const scale = $derived.by(() => {
    const all = rows.flat();
    let lo = Math.min(0, ...all);
    let hi = Math.max(0, ...all);
    if (hi === lo) hi = lo + 1;
    const raw = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    return { lo, hi, ticks };
  });
  const x = (i: number) => pad.l + (n > 1 ? (i * (w - pad.l - pad.r)) / (n - 1) : 0);
  const y = (v: number) => pad.t + ((scale.hi - v) / (scale.hi - scale.lo)) * (H - pad.t - pad.b);
  const compact = (v: number) =>
    Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(v);
  const line = (j: number) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[j]).toFixed(1)}`).join('');

  /** End labels, nudged apart so they never overlap. */
  const ends = $derived.by(() => {
    const out = names.map((name, j) => ({ name, j, y: y(rows[n - 1][j]) }));
    out.sort((a, b) => a.y - b.y);
    for (let k = 1; k < out.length; k++) out[k].y = Math.max(out[k].y, out[k - 1].y + 12);
    return out;
  });

  /** The hand being read (hover or tap), if any. */
  let at = $state<number | null>(null);
  function point(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    at = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / Math.max(1, w - pad.l - pad.r)) * (n - 1))));
  }
  const handName = (i: number) => (i === 0 ? 'The deal' : `Hand ${i}`);
  const delta = (i: number, j: number) => (i > 0 ? rows[i][j] - rows[i - 1][j] : null);
  const signed = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0');

  const leader = $derived.by(() => {
    const last = rows[n - 1] ?? [];
    let best = 0;
    last.forEach((v, j) => v > last[best] && (best = j));
    return names[best];
  });
</script>

<div class="score-chart">
  {#if charted}
    <div class="plot" bind:clientWidth={w}>
      {#if w}
        <svg
          width={w}
          height={H}
          role="img"
          aria-label="Score chart over {n - 1} hand{n === 2 ? '' : 's'}; the numbers are in the table below"
          onpointermove={point}
          onpointerdown={point}
          onpointerleave={() => (at = null)}
        >
          {#each scale.ticks as t (t)}
            <line class="grid" x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />
            <text class="tick" x={pad.l - 6} y={y(t) + 4} text-anchor="end">{compact(t)}</text>
          {/each}
          <text class="tick" x={pad.l} y={H - 5}>Deal</text>
          <text class="tick" x={w - pad.r} y={H - 5} text-anchor="end">Hand {n - 1}</text>
          {#if at !== null}<line class="cross" x1={x(at)} x2={x(at)} y1={pad.t} y2={H - pad.b} />{/if}
          {#each names as _, j (j)}
            <path d={line(j)} stroke={COLORS[j]} class="series" />
          {/each}
          {#each names as _, j (j)}
            {@const i = at ?? n - 1}
            <circle cx={x(i)} cy={y(rows[i][j])} r="4" fill={COLORS[j]} class="dot" />
          {/each}
          {#if endLabels}
            {#each ends as e (e.j)}<text class="end" x={w - pad.r + 8} y={e.y + 4}>{e.name}</text>{/each}
          {/if}
        </svg>
        {#if at !== null}
          <div class="tip panel" style:left="{x(at) > w / 2 ? x(at) - 8 : x(at) + 8}px" class:flip={x(at) > w / 2} aria-hidden="true">
            <b>{handName(at)}</b>
            {#each names as name, j (j)}
              <span
                ><i style:background={COLORS[j]}></i>{name} <b>{rows[at][j].toLocaleString()}</b>{#if delta(at, j) !== null}<small>
                    {signed(delta(at, j)!)}</small
                  >{/if}</span
              >
            {/each}
          </div>
        {/if}
      {/if}
    </div>
    {#if names.length >= 2}
      <ul class="legend" aria-hidden="true">
        {#each names as name, j (j)}<li><i style:background={COLORS[j]}></i>{name}</li>{/each}
      </ul>
    {/if}
    <p class="sr-only">{leader} leads after {n - 1} hand{n === 2 ? '' : 's'}.</p>
  {/if}
  {#if n >= 2}
    <div class="table-wrap">
      <table class="hands">
        <caption class="sr-only">Hand by hand</caption>
        <thead>
          <tr
            ><th scope="col"></th>{#each names as name, j (j)}<th scope="col">{name}</th>{/each}</tr
          >
        </thead>
        <tbody>
          {#each rows.map((_, i) => i).reverse() as i (i)}
            <tr>
              <th scope="row">{i === 0 ? 'Deal' : i}</th>
              {#each names as _, j (j)}
                <td
                  >{rows[i][j].toLocaleString()}{#if delta(i, j)}<small>{signed(delta(i, j)!)}</small>{/if}</td
                >
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .score-chart {
    margin: 0.2rem 0 0.8rem;
  }
  .plot {
    position: relative;
    width: 100%;
    touch-action: pan-y;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: rgba(255, 255, 255, 0.1);
    stroke-width: 1;
  }
  .cross {
    stroke: rgba(255, 255, 255, 0.35);
    stroke-width: 1;
  }
  .tick {
    fill: var(--ink-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .end {
    fill: var(--ink-dim);
    font-size: 11.5px;
    font-weight: 600;
  }
  .series {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  /* (a ring of the sheet's own colour keeps crossing dots apart) */
  .dot {
    stroke: rgb(8, 26, 20);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0.4rem 0.6rem;
    border-radius: 10px;
    font-size: 0.78rem;
    white-space: nowrap;
    pointer-events: none;
  }
  .tip.flip {
    transform: translateX(-100%);
  }
  .tip span {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--ink-dim);
  }
  .tip span b {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .tip small {
    color: var(--ink-faint);
  }
  i {
    display: inline-block;
    width: 12px;
    height: 3px;
    border-radius: 2px;
    flex: none;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.9rem;
    margin: 0.3rem 0 0.6rem;
    padding: 0;
    list-style: none;
    font-size: 0.78rem;
    color: var(--ink-dim);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .table-wrap {
    max-height: 12rem;
    overflow: auto;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.18);
  }
  .hands {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .hands th,
  .hands td {
    padding: 0.3rem 0.5rem;
    text-align: right;
    white-space: nowrap;
  }
  .hands thead th {
    position: sticky;
    top: 0;
    background: rgb(12, 34, 27);
    color: var(--ink-dim);
    font-weight: 600;
  }
  .hands tbody th {
    color: var(--ink-faint);
    font-weight: 500;
    text-align: left;
  }
  .hands small {
    margin-left: 0.3rem;
    color: var(--ink-faint);
  }
</style>
