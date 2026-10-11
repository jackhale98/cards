import type { ActionSpec } from '../engine/types';

export type AmountSpec = NonNullable<ActionSpec['amount']>;

/** Snap a value onto the spec's grid (min + k·step), always allowing exactly `max` (all in). */
export function snap(v: number, a: AmountSpec): number {
  if (!Number.isFinite(v)) return a.min;
  if (v >= a.max) return a.max;
  if (v <= a.min) return a.min;
  const k = Math.round((v - a.min) / a.step);
  return Math.min(a.max, a.min + k * a.step);
}

/** Wide ranges get a curved slider: fine control near the minimum, faster toward all in. */
const curve = (a: AmountSpec) => ((a.max - a.min) / a.step > 40 ? 2.5 : 1);
export const SLIDER_STEPS = 1000;

export function sliderToValue(p: number, a: AmountSpec): number {
  const f = Math.min(1, Math.max(0, p / SLIDER_STEPS)) ** curve(a);
  return snap(a.min + (a.max - a.min) * f, a);
}

export function valueToSlider(v: number, a: AmountSpec): number {
  if (a.max <= a.min) return 0;
  const f = Math.min(1, Math.max(0, (v - a.min) / (a.max - a.min)));
  return Math.round(SLIDER_STEPS * f ** (1 / curve(a)));
}

/** "+5 / +25 / +100"-style quick adds that make sense for this range. */
export function quickAdds(a: AmountSpec): number[] {
  const span = a.max - a.min;
  return [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000]
    .filter((c) => c >= a.step && c % a.step === 0 && c <= span / 2)
    .slice(-3);
}

/** Validate typed text: returns the amount to send (exactly as typed), or why it can't be used. */
export function parseTyped(text: string, a: AmountSpec): { value: number } | { error: string } {
  const n = Number(text.replace(/[^\d]/g, ''));
  if (!text.trim() || !Number.isFinite(n)) return { error: 'Enter an amount' };
  if (n < a.min) return { error: `Minimum ${a.min.toLocaleString()}` };
  if (n > a.max) return { error: `Maximum ${a.max.toLocaleString()}` };
  return { value: Math.floor(n) };
}
