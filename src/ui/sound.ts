/**
 * Table sounds, made on the fly with Web Audio (no files to download): a card snapping down, a
 * shuffle-and-deal, chips, a soft chime when it's your turn, and a little fanfare at the end.
 * Phones only allow sound after a tap, so the audio starts on the first touch; muting is remembered
 * per device.
 */

export type Sound = 'card' | 'deal' | 'chips' | 'turn' | 'win' | 'end';

const KEY = 'cards.sound';
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
})();

export const soundOn = () => !muted;
export function setSound(on: boolean) {
  muted = !on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
  if (on) play('turn');
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  rest();
  return ctx;
}

// a running AudioContext keeps the phone's audio hardware awake: let it sleep when the table is
// quiet or hidden, and wake it on the next touch (some browsers only resume from a gesture)
let restTimer: ReturnType<typeof setTimeout> | undefined;
function rest(after = 20_000) {
  clearTimeout(restTimer);
  restTimer = setTimeout(() => {
    if (ctx?.state !== 'running') return;
    void ctx.suspend();
    listen();
  }, after);
}

// browsers only start audio from a user gesture: wake it on the first touch
function listen() {
  const unlock = () => {
    if (!muted) audio();
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}
if (typeof window !== 'undefined') {
  listen();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rest(0);
  });
}

function noiseBuffer(c: AudioContext) {
  if (noise) return noise;
  noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.2), c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** A short filtered burst of noise: a card landing on felt. */
function snap(c: AudioContext, at: number, gain = 0.5, freq = 2400) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
  src.connect(band).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + 0.08);
}

/** A soft tone with a quick attack and gentle fade. */
function tone(c: AudioContext, at: number, freq: number, dur: number, gain = 0.12, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

let lastAt = 0;

export function play(sound: Sound) {
  if (muted) return;
  // (dev builds: tests can listen in)
  if (import.meta.env.DEV) (window as unknown as { __sounds?: Sound[] }).__sounds?.push(sound);
  const c = audio();
  if (!c) return;
  // asleep: play once it has woken (audio() asked it to)
  if (c.state === 'suspended')
    void c.resume().then(
      () => c.state === 'running' && render(c, sound),
      () => {},
    );
  else if (c.state === 'running') render(c, sound);
}

function render(c: AudioContext, sound: Sound) {
  const t = c.currentTime + 0.01;
  // (never a pile-up: two sounds within 40ms collapse into one)
  if (sound !== 'turn' && t - lastAt < 0.04) return;
  lastAt = t;
  switch (sound) {
    case 'card':
      return snap(c, t);
    case 'deal':
      for (let i = 0; i < 5; i++) snap(c, t + i * 0.065, 0.35, 2200 + Math.random() * 600);
      return;
    case 'chips':
      // two clay chips clicking together
      tone(c, t, 2900, 0.05, 0.06, 'triangle');
      tone(c, t + 0.045, 3500, 0.06, 0.05, 'triangle');
      snap(c, t, 0.15, 5000);
      return;
    case 'turn':
      tone(c, t, 659, 0.22);
      tone(c, t + 0.13, 988, 0.32);
      return;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.1, f, 0.35, 0.1));
      return;
    case 'end':
      tone(c, t, 523, 0.3, 0.09);
      tone(c, t + 0.15, 392, 0.45, 0.09);
      return;
  }
}
