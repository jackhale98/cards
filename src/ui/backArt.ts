/**
 * Card back artwork. Each back is one small SVG drawn for the whole card (250 × 350, the card's
 * 5:7 shape): a white margin, a field pattern, a frame and a centre medallion. Like a real deck,
 * each is balanced to look right either way up (most are exactly the same turned upside down).
 * Built as strings at load time and used as CSS data URIs: nothing to download.
 */

const W = 250;
const H = 350;
const CX = W / 2;
const CY = H / 2;

// Suit shapes in a 100-unit box centred on the origin (same as GameIcon).
const SPADE =
  'M0,-44 C6,-32 46,-12 46,8 C46,22 35,30 23,30 C15,30 8,26 4,20 C5,30 9,38 16,44 L-16,44 C-9,38 -5,30 -4,20 C-8,26 -15,30 -23,30 C-35,30 -46,22 -46,8 C-46,-12 -6,-32 0,-44Z';
const HEART =
  'M0,40 C-16,26 -46,6 -46,-14 C-46,-30 -34,-40 -22,-40 C-11,-40 -3,-33 0,-25 C3,-33 11,-40 22,-40 C34,-40 46,-30 46,-14 C46,6 16,26 0,40Z';
const DIAMOND = 'M0,-46 C10,-28 24,-12 38,0 C24,12 10,28 0,46 C-10,28 -24,12 -38,0 C-24,-12 -10,-28 0,-46Z';
const CLUB =
  '<circle cx="0" cy="-20" r="20"/><circle cx="-22" cy="10" r="20"/><circle cx="22" cy="10" r="20"/><circle cx="0" cy="4" r="12"/><path d="M-6,4 L6,4 C6,24 10,36 16,44 L-16,44 C-10,36 -6,24 -6,4Z"/>';
const LEAF = 'M0,-7 C4,-3 4,3 0,7 C-4,3 -4,-3 0,-7Z';

type Suit = 'S' | 'H' | 'D' | 'C';
const suit = (k: Suit, x: number, y: number, size: number, fill: string, rot = 0) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${size / 100})" fill="${fill}">${
    k === 'C' ? CLUB : `<path d="${k === 'S' ? SPADE : k === 'H' ? HEART : DIAMOND}"/>`
  }</g>`;

/** The same drawing again, turned half a turn about the card's centre. */
const sym = (s: string) => `${s}<g transform="rotate(180 ${CX} ${CY})">${s}</g>`;
/** n copies spun around a point. */
const ring = (n: number, s: string, cx = CX, cy = CY, offset = 0) =>
  Array.from({ length: n }, (_, i) => `<g transform="rotate(${offset + (360 / n) * i} ${cx} ${cy})">${s}</g>`).join('');
/** An n-pointed star, outer radius r, inner radius ri. */
const star = (cx: number, cy: number, r: number, ri: number, n: number, fill: string, rot = 0) => {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (180 / n) * i - 90) * Math.PI) / 180;
    const rr = i % 2 ? ri : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

/** Small seeded random numbers, so scattered designs come out the same every time. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Art {
  /** Field colour. */
  base: string;
  /** Extra <defs> (patterns, gradients). */
  defs?: string;
  /** Everything drawn inside the margin, over the base colour. */
  body: string;
}

/** Wrap a design: the white margin, then the art clipped to the printed area. */
function card({ base, defs = '', body }: Art) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><defs><clipPath id="c"><rect x="11" y="11" width="228" height="328" rx="19"/></clipPath>${defs}</defs><rect width="${W}" height="${H}" fill="#fbf8f1"/><g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="${base}"/>${body}</g></svg>`;
}

/** Double frame line inside the printed area. */
const frame = (c: string, inner = 0.6) =>
  `<rect x="20" y="20" width="210" height="310" rx="12" fill="none" stroke="${c}" stroke-width="2.2"/><rect x="25.5" y="25.5" width="199" height="299" rx="8" fill="none" stroke="${c}" stroke-width="0.9" opacity="${inner}"/>`;

// ─── The decks ────────────────────────────────────────────────────────────────

const classic = (() => {
  const navy = '#1f3356';
  const gold = '#d4a640';
  const cream = '#f3e9d2';
  const pattern = `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0,6 L6,0 L12,6 L6,12 Z" fill="none" stroke="${gold}" stroke-opacity="0.32" stroke-width="0.8"/><circle cx="6" cy="6" r="1" fill="${gold}" fill-opacity="0.45"/></pattern>`;
  const corner = `<g transform="translate(37 37)"><path d="M-7,0 L0,-7 L7,0 L0,7Z" fill="${gold}"/><path d="M-3,0 L0,-3 L3,0 L0,3Z" fill="${navy}"/></g>`;
  const medallion =
    `<circle cx="${CX}" cy="${CY}" r="56" fill="${navy}" stroke="${gold}" stroke-width="2.2"/>` +
    `<circle cx="${CX}" cy="${CY}" r="50" fill="none" stroke="${gold}" stroke-width="0.8" stroke-dasharray="1.6 2.4"/>` +
    suit('S', CX, CY - 25, 28, cream) +
    suit('H', CX + 25, CY, 28, cream, 90) +
    suit('C', CX, CY + 25, 28, cream, 180) +
    suit('D', CX - 25, CY, 28, cream, 270) +
    star(CX, CY, 6, 2.4, 4, gold, 45);
  const diamondTips = sym(`<path d="M${CX},${CY - 56} L${CX + 7},${CY - 68} L${CX},${CY - 80} L${CX - 7},${CY - 68}Z" fill="${gold}"/>`);
  return card({
    base: navy,
    defs: pattern,
    body:
      `<rect x="20" y="20" width="210" height="310" fill="url(#p)"/>` +
      frame(gold) +
      sym(corner + `<g transform="translate(${W - 74} 0)">${corner}</g>`) +
      diamondTips +
      medallion,
  });
})();

const crimson = (() => {
  const red = '#8e1b26';
  const cream = '#f6ecdc';
  const pattern = `<pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0,0 H8 M0,0 V8" stroke="${cream}" stroke-opacity="0.38" stroke-width="0.9"/></pattern>`;
  const lozenge = (s: number, fill: string, stroke = 'none', sw = 0) =>
    `<path d="M${CX},${CY - 70 * s} L${CX + 42 * s},${CY} L${CX},${CY + 70 * s} L${CX - 42 * s},${CY}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  return card({
    base: red,
    defs: pattern,
    body:
      `<rect width="${W}" height="${H}" fill="url(#p)"/>` +
      frame(cream, 0.8) +
      lozenge(1, red, cream, 2.2) +
      lozenge(0.86, 'none', cream, 0.8) +
      suit('S', CX, CY - 15, 30, cream) +
      suit('S', CX, CY + 15, 30, cream, 180),
  });
})();

const forest = (() => {
  const green = '#1f4d36';
  const gold = '#e2c071';
  const sage = '#a9c7a0';
  const sprig = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0,9 L0,-9" stroke="${sage}" stroke-width="0.7"/><path d="${LEAF}" transform="translate(-3 -2) rotate(-35) scale(0.55)" fill="${sage}"/><path d="${LEAF}" transform="translate(3 2) rotate(35) scale(0.55)" fill="${sage}"/><path d="${LEAF}" transform="translate(0 -8) scale(0.5)" fill="${sage}"/></g>`;
  const pattern = `<pattern id="p" width="34" height="34" patternUnits="userSpaceOnUse"><g opacity="0.3">${sprig(8, 9, -20)}${sprig(25, 26, 160)}</g></pattern>`;
  const wreath = ring(22, `<path d="${LEAF}" transform="translate(${CX} ${CY - 48}) rotate(62) scale(1.15)" fill="${gold}"/>`) +
    ring(22, `<path d="${LEAF}" transform="translate(${CX} ${CY - 40}) rotate(118) scale(0.9)" fill="${gold}" opacity="0.75"/>`, CX, CY, 8);
  return card({
    base: green,
    defs: pattern,
    body:
      `<rect width="${W}" height="${H}" fill="url(#p)"/>` +
      frame(gold, 0.7) +
      `<circle cx="${CX}" cy="${CY}" r="58" fill="${green}"/>` +
      wreath +
      `<circle cx="${CX}" cy="${CY}" r="27" fill="none" stroke="${gold}" stroke-width="1.4"/>` +
      ring(4, `<path d="${LEAF}" transform="translate(${CX} ${CY - 11}) scale(1.35)" fill="${gold}"/>`) +
      `<circle cx="${CX}" cy="${CY}" r="3" fill="${green}" stroke="${gold}" stroke-width="1.2"/>` +
      sym(`<path d="${LEAF}" transform="translate(${CX} 44) rotate(90) scale(1.2)" fill="${gold}"/><circle cx="${CX - 14}" cy="44" r="1.6" fill="${gold}"/><circle cx="${CX + 14}" cy="44" r="1.6" fill="${gold}"/>`),
  });
})();

const deco = (() => {
  const ink = '#141519';
  const gold = '#d4af37';
  const fan = (() => {
    let s = '';
    for (let i = 0; i <= 12; i++) {
      const a = (Math.PI * i) / 12;
      s += `<line x1="${CX}" y1="20" x2="${(CX + Math.cos(a) * 110).toFixed(1)}" y2="${(20 + Math.sin(a) * 110).toFixed(1)}" stroke="${gold}" stroke-width="0.9" opacity="0.7"/>`;
    }
    for (const r of [34, 58, 82, 106]) s += `<path d="M${CX - r},20 A${r},${r} 0 0 0 ${CX + r},20" fill="none" stroke="${gold}" stroke-width="${r === 106 ? 2 : 1}"/>`;
    s += `<path d="M${CX - 18},20 A18,18 0 0 0 ${CX + 18},20Z" fill="${gold}"/>`;
    return s;
  })();
  const stepCorner = `<path d="M20,52 V20 H52 M28,52 V28 H52 M36,52 V36 H52" fill="none" stroke="${gold}" stroke-width="1.4"/>`;
  const diamond = (r: number, fill: string, stroke = 'none') =>
    `<path d="M${CX},${CY - r * 1.5} L${CX + r},${CY} L${CX},${CY + r * 1.5} L${CX - r},${CY}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`;
  return card({
    base: ink,
    body:
      `<rect x="20" y="20" width="210" height="310" fill="none" stroke="${gold}" stroke-width="2.2"/>` +
      sym(fan + stepCorner + `<g transform="translate(${W} 0) scale(-1 1)">${stepCorner}</g>`) +
      `<line x1="${CX}" y1="128" x2="${CX}" y2="222" stroke="${gold}" stroke-width="0.9"/>` +
      `<line x1="${CX - 70}" y1="${CY}" x2="${CX + 70}" y2="${CY}" stroke="${gold}" stroke-width="0.9"/>` +
      diamond(30, ink, gold) +
      diamond(22, 'none', gold) +
      diamond(12, gold),
  });
})();

const lamplight = (() => {
  const plum = '#2a1f3d';
  const gold = '#e9c46a';
  const r = rng(7);
  let sparks = '';
  for (let i = 0; i < 26; i++) {
    const x = 26 + r() * 198;
    const y = 26 + r() * 125;
    if (Math.hypot(x - CX, y - CY) < 80) continue;
    sparks += star(x, y, 1.2 + r() * 2.2, 0.5, 4, gold, 0).replace('/>', ` opacity="${(0.35 + r() * 0.5).toFixed(2)}"/>`);
  }
  const glow = `<radialGradient id="g"><stop offset="0" stop-color="#ffe2a0" stop-opacity="0.75"/><stop offset="0.35" stop-color="#f2b84b" stop-opacity="0.3"/><stop offset="1" stop-color="#f2b84b" stop-opacity="0"/></radialGradient><radialGradient id="core"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.5" stop-color="#ffe7a3"/><stop offset="1" stop-color="#f2b84b"/></radialGradient>`;
  return card({
    base: plum,
    defs: glow,
    body:
      sym(sparks) +
      frame(gold, 0.6) +
      sym(`<path d="M${CX - 30},38 Q${CX},50 ${CX + 30},38" fill="none" stroke="${gold}" stroke-width="1"/>${star(CX, 34, 4, 1.4, 4, gold)}`) +
      `<circle cx="${CX}" cy="${CY}" r="95" fill="url(#g)"/>` +
      `<circle cx="${CX}" cy="${CY}" r="56" fill="none" stroke="${gold}" stroke-width="1.6"/>` +
      ring(32, `<circle cx="${CX}" cy="${CY - 62}" r="1.3" fill="${gold}"/>`) +
      ring(16, `<line x1="${CX}" y1="${CY - 50}" x2="${CX}" y2="${CY - 30}" stroke="${gold}" stroke-width="1.2" stroke-linecap="round"/>`, CX, CY, 11.25) +
      star(CX, CY, 46, 12, 8, gold) +
      star(CX, CY, 30, 9, 8, plum, 22.5) +
      `<circle cx="${CX}" cy="${CY}" r="13" fill="url(#core)"/>`,
  });
})();

const tartan = (() => {
  const red = '#7f1f26';
  const band = (o: string) =>
    `<rect x="0" y="6" width="40" height="11" fill="#163d2c" opacity="${o}"/><rect x="0" y="20" width="40" height="3" fill="#163d2c" opacity="${o}"/><rect x="0" y="30" width="40" height="1.2" fill="#e9c46a" opacity="0.7"/><rect x="0" y="1" width="40" height="1.2" fill="#10151d" opacity="0.5"/>`;
  const sett = `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse">${band('0.55')}<g transform="rotate(90 20 20)">${band('0.45')}</g></pattern><pattern id="t" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="3" fill="#000" opacity="0.12"/></pattern>`;
  const cream = '#f6ecdc';
  return card({
    base: red,
    defs: sett,
    body:
      `<rect width="${W}" height="${H}" fill="url(#p)"/><rect width="${W}" height="${H}" fill="url(#t)"/>` +
      `<rect x="20" y="20" width="210" height="310" rx="12" fill="none" stroke="${cream}" stroke-width="2" stroke-dasharray="5 3.5"/>` +
      `<ellipse cx="${CX}" cy="${CY}" rx="48" ry="62" fill="${cream}"/>` +
      `<ellipse cx="${CX}" cy="${CY}" rx="42" ry="56" fill="none" stroke="${red}" stroke-width="1.4" stroke-dasharray="4 3"/>` +
      suit('H', CX, CY - 14, 30, red) +
      suit('H', CX, CY + 14, 30, red, 180),
  });
})();

const stars = (() => {
  const night = '#111936';
  const pale = '#dfe6ff';
  const r = rng(42);
  let field = '';
  for (let i = 0; i < 70; i++) {
    const x = 18 + r() * 214;
    const y = 18 + r() * 140;
    if (Math.hypot(x - CX, y - CY) < 72) continue;
    const s = r();
    field +=
      s > 0.92
        ? star(x, y, 3.6, 0.8, 4, pale)
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.5 + s * 0.9).toFixed(2)}" fill="${pale}" opacity="${(0.4 + s * 0.6).toFixed(2)}"/>`;
  }
  const constellation = [
    [48, 60], [70, 52], [92, 66], [108, 58], [118, 82], [96, 92], [92, 66],
  ];
  const line = `<polyline points="${constellation.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${pale}" stroke-opacity="0.45" stroke-width="0.7"/>${constellation.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${pale}"/>`).join('')}`;
  // a ring of moon phases: full at the top, new at the bottom, waning down the left
  const phase = (i: number) => {
    const R = 6.5;
    const t = (i * 45 * Math.PI) / 180;
    const e = Math.abs(Math.cos(t)) * R;
    const right = i > 4; // waxing: lit on the right
    const gibbous = i === 1 || i === 7;
    if (i === 0) return `<circle r="${R}" fill="${pale}"/>`;
    if (i === 4) return `<circle r="${R}" fill="${night}" stroke="${pale}" stroke-width="0.8"/>`;
    const out = right ? 1 : 0;
    const back = gibbous ? out : 1 - out;
    return `<circle r="${R}" fill="${night}" stroke="${pale}" stroke-width="0.6" stroke-opacity="0.6"/><path d="M0,${-R} A${R},${R} 0 0 ${out} 0,${R} A${e.toFixed(2)},${R} 0 0 ${back} 0,${-R}Z" fill="${pale}"/>`;
  };
  const phases = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45 * Math.PI) / 180;
    return `<g transform="translate(${(CX - Math.sin(a) * 50).toFixed(1)} ${(CY - Math.cos(a) * 50).toFixed(1)})">${phase(i)}</g>`;
  }).join('');
  return card({
    base: night,
    body:
      sym(field + line) +
      frame(pale, 0.5) +
      `<circle cx="${CX}" cy="${CY}" r="62" fill="${night}" stroke="${pale}" stroke-width="1.2"/>` +
      `<circle cx="${CX}" cy="${CY}" r="38" fill="none" stroke="${pale}" stroke-opacity="0.5" stroke-width="0.7"/>` +
      phases +
      `<circle cx="${CX}" cy="${CY}" r="22" fill="${pale}"/><circle cx="${CX - 6}" cy="${CY - 5}" r="4" fill="${night}" opacity="0.12"/><circle cx="${CX + 7}" cy="${CY + 6}" r="2.6" fill="${night}" opacity="0.12"/>`,
  });
})();

const ocean = (() => {
  const teal = '#0f5c6b';
  const foam = '#eaf4f1';
  const s = 14;
  const arcs = (cx: number, cy: number) =>
    [1, 0.7, 0.4].map((k) => `<path d="M${cx - s * k},${cy} A${s * k},${s * k} 0 0 1 ${cx + s * k},${cy}" fill="none" stroke="${foam}" stroke-opacity="${k === 1 ? 0.5 : 0.28}" stroke-width="0.9"/>`).join('');
  const pattern = `<pattern id="p" width="${2 * s}" height="${2 * s}" patternUnits="userSpaceOnUse">${arcs(s, s)}${arcs(0, 2 * s)}${arcs(2 * s, 2 * s)}</pattern>`;
  const waveLine = (y: number, w: number) => {
    let d = `M${CX - w},${y}`;
    for (let x = -w; x < w; x += 16) d += ` q4,-7 8,0 t8,0`;
    return `<path d="${d}" fill="none" stroke="${foam}" stroke-width="2.4" stroke-linecap="round"/>`;
  };
  const wave = waveLine(CY - 13, 32) + waveLine(CY, 40) + waveLine(CY + 13, 32);
  return card({
    base: teal,
    defs: pattern,
    body:
      `<rect width="${W}" height="${H}" fill="url(#p)"/>` +
      frame(foam, 0.6) +
      `<circle cx="${CX}" cy="${CY}" r="54" fill="${teal}" stroke="${foam}" stroke-width="2"/>` +
      `<circle cx="${CX}" cy="${CY}" r="48" fill="none" stroke="${foam}" stroke-width="0.8" stroke-opacity="0.7"/>` +
      wave +
      ring(24, `<circle cx="${CX}" cy="${CY - 58}" r="1.4" fill="${foam}"/>`),
  });
})();

const rose = (() => {
  const rose = '#9c3f63';
  const cream = '#fbeef2';
  const blossom = (x: number, y: number, r: number, fill: string, centre: string) =>
    ring(5, `<ellipse cx="${x}" cy="${y - r * 0.55}" rx="${r * 0.42}" ry="${r * 0.55}" fill="${fill}"/>`, x, y) + `<circle cx="${x}" cy="${y}" r="${r * 0.22}" fill="${centre}"/>`;
  const pattern = `<pattern id="p" width="30" height="30" patternUnits="userSpaceOnUse"><g opacity="0.32">${blossom(8, 8, 6, cream, rose)}${blossom(23, 23, 6, cream, rose)}</g><path d="${LEAF}" transform="translate(23 8) rotate(40) scale(0.45)" fill="${cream}" opacity="0.25"/><path d="${LEAF}" transform="translate(8 23) rotate(-40) scale(0.45)" fill="${cream}" opacity="0.25"/></pattern>`;
  const petals = (n: number, d: number, rx: number, ry: number, fill: string, off = 0) =>
    ring(n, `<ellipse cx="${CX}" cy="${CY - d}" rx="${rx}" ry="${ry}" fill="${fill}"/>`, CX, CY, off);
  return card({
    base: rose,
    defs: pattern,
    body:
      `<rect width="${W}" height="${H}" fill="url(#p)"/>` +
      frame(cream, 0.6) +
      `<circle cx="${CX}" cy="${CY}" r="60" fill="${rose}"/>` +
      petals(12, 40, 9, 17, cream) +
      petals(12, 40, 5, 11, rose) +
      petals(8, 22, 8, 13, cream, 22.5) +
      `<circle cx="${CX}" cy="${CY}" r="11" fill="${rose}" stroke="${cream}" stroke-width="1.5"/><circle cx="${CX}" cy="${CY}" r="4" fill="${cream}"/>`,
  });
})();

const knit = (() => {
  const berry = '#8f2a37';
  const cream = '#f3e6d3';
  const st = (c: string, o: number) =>
    `<ellipse cx="2.4" cy="4" rx="1.9" ry="3.7" transform="rotate(-28 2.4 4)" fill="${c}" opacity="${o}"/><ellipse cx="7.6" cy="4" rx="1.9" ry="3.7" transform="rotate(28 7.6 4)" fill="${c}" opacity="${o}"/>`;
  const defs = `<pattern id="p" width="10" height="8" patternUnits="userSpaceOnUse">${st('#ffffff', 0.09)}</pattern>`;
  // fair-isle band across the middle: a row of stars between zig-zags
  const zig = (y: number, flip: number) => {
    let d = `M0,${y}`;
    for (let x = 0; x <= W; x += 10) d += ` L${x + 5},${y + 6 * flip} L${x + 10},${y}`;
    return `<path d="${d}" fill="none" stroke="${cream}" stroke-width="2.2" stroke-linejoin="round"/>`;
  };
  const snow = (x: number, y: number, s: number) =>
    ring(6, `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - s}" stroke="${cream}" stroke-width="1.6" stroke-linecap="round"/><line x1="${x}" y1="${y - s * 0.6}" x2="${x + s * 0.28}" y2="${y - s * 0.85}" stroke="${cream}" stroke-width="1.1" stroke-linecap="round"/><line x1="${x}" y1="${y - s * 0.6}" x2="${x - s * 0.28}" y2="${y - s * 0.85}" stroke="${cream}" stroke-width="1.1" stroke-linecap="round"/>`, x, y);
  const dots = (y: number) => Array.from({ length: 13 }, (_, i) => `<rect x="${i * 20 + 4}" y="${y - 2}" width="4" height="4" transform="rotate(45 ${i * 20 + 6} ${y})" fill="${cream}"/>`).join('');
  return card({
    base: berry,
    defs,
    body:
      `<rect width="${W}" height="${H}" fill="url(#p)"/>` +
      `<rect x="0" y="${CY - 44}" width="${W}" height="88" fill="#6d1c28"/>` +
      zig(CY - 44, 1) + zig(CY + 44, -1) +
      snow(CX, CY, 24) + snow(CX - 58, CY, 14) + snow(CX + 58, CY, 14) +
      `<circle cx="${CX - 29}" cy="${CY}" r="2.4" fill="${cream}"/><circle cx="${CX + 29}" cy="${CY}" r="2.4" fill="${cream}"/>` +
      sym(dots(CY - 62) + dots(CY - 140) + zig(CY - 122, 1)) +
      `<rect x="20" y="20" width="210" height="310" rx="12" fill="none" stroke="${cream}" stroke-width="2"/>`,
  });
})();

const groovy = (() => {
  const base = '#f0c26a';
  const bands = ['#c4552b', '#e08a3a', '#7a3b1f', '#f4dfa8'];
  const arch = (cy: number, flip: boolean) => {
    let s = '';
    bands.forEach((c, i) => {
      const r = 96 - i * 20;
      s += `<path d="M${CX - r},${cy} A${r},${r} 0 0 ${flip ? 1 : 0} ${CX + r},${cy}Z" fill="${c}"/>`;
    });
    return s;
  };
  return card({
    base,
    body:
      arch(11, false) +
      arch(339, true) +
      `<circle cx="${CX}" cy="${CY}" r="38" fill="#7a3b1f"/>` +
      ring(12, `<path d="M${CX - 5},${CY - 42} L${CX},${CY - 56} L${CX + 5},${CY - 42}Z" fill="#c4552b"/>`) +
      `<circle cx="${CX}" cy="${CY}" r="30" fill="#e08a3a"/><circle cx="${CX}" cy="${CY}" r="20" fill="#f4dfa8"/>` +
      `<rect x="20" y="20" width="210" height="310" rx="12" fill="none" stroke="#7a3b1f" stroke-width="2"/>`,
  });
})();

const bauhaus = (() => {
  const ink = '#1c2530';
  const c = { red: '#d1495b', yel: '#edae49', blu: '#3d7ea6', cream: '#f2e8d5' };
  // a 4 × 6 grid of 50-unit tiles, each a quarter circle, half circle or block
  const tiles: string[] = [];
  const x0 = 25, y0 = 25, t = 50;
  const shapes = [
    (x: number, y: number, f: string) => `<path d="M${x},${y + t} A${t},${t} 0 0 1 ${x + t},${y}L${x + t},${y + t}Z" fill="${f}"/>`,
    (x: number, y: number, f: string) => `<path d="M${x},${y + t} A${t / 2},${t / 2} 0 0 1 ${x + t},${y + t}Z" fill="${f}"/>`,
    (x: number, y: number, f: string) => `<circle cx="${x + t / 2}" cy="${y + t / 2}" r="${t / 2 - 4}" fill="${f}"/>`,
    (x: number, y: number, f: string) => `<rect x="${x + 8}" y="${y}" width="${t - 16}" height="${t}" fill="${f}"/>`,
  ];
  const fills = [c.red, c.yel, c.blu, c.cream];
  const r = rng(11);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) {
      const x = x0 + col * t;
      const y = y0 + row * t;
      if (row === 2 && (col === 1 || col === 2)) continue; // leave the centre open
      const k = Math.floor(r() * shapes.length);
      const f = fills[Math.floor(r() * fills.length)];
      const rot = Math.floor(r() * 4) * 90;
      tiles.push(`<g transform="rotate(${rot} ${x + t / 2} ${y + t / 2})">${shapes[k](x, y, f)}</g>`);
    }
  return card({
    base: ink,
    body:
      sym(tiles.join('')) +
      `<circle cx="${CX}" cy="${CY}" r="44" fill="${c.yel}"/><path d="M${CX},${CY} L${CX - 44},${CY} A44,44 0 0 1 ${CX},${CY - 44}Z" fill="${c.red}"/><path d="M${CX},${CY} L${CX + 44},${CY} A44,44 0 0 1 ${CX},${CY + 44}Z" fill="${c.red}"/><circle cx="${CX}" cy="${CY}" r="14" fill="${ink}"/>`,
  });
})();

export interface BackArt {
  id: string;
  name: string;
  /** Field colour, used behind the art and for anything that needs a flat colour. */
  colour: string;
  svg: string;
}

export const BACK_ART: BackArt[] = [
  { id: 'classic', name: 'Classic', colour: '#1f3356', svg: classic },
  { id: 'lamplight', name: 'Lamplight', colour: '#2a1f3d', svg: lamplight },
  { id: 'crimson', name: 'Crimson', colour: '#8e1b26', svg: crimson },
  { id: 'deco', name: 'Art Deco', colour: '#141519', svg: deco },
  { id: 'stars', name: 'Moon & Stars', colour: '#111936', svg: stars },
  { id: 'forest', name: 'Botanical', colour: '#1f4d36', svg: forest },
  { id: 'ocean', name: 'Tide', colour: '#0f5c6b', svg: ocean },
  { id: 'rose', name: 'Rosette', colour: '#9c3f63', svg: rose },
  { id: 'tartan', name: 'Tartan', colour: '#7f1f26', svg: tartan },
  { id: 'knit', name: 'Sweater', colour: '#8f2a37', svg: knit },
  { id: 'groovy', name: 'Groovy', colour: '#f0c26a', svg: groovy },
  { id: 'bauhaus', name: 'Bauhaus', colour: '#1c2530', svg: bauhaus },
];

/** The art as a CSS background image. */
export const backImage = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
