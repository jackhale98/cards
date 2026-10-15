/** Suit lengths in rank order (spades, hearts, diamonds, clubs): "4414" is four spades, four hearts, a diamond, four clubs. */
export type Shape = [number, number, number, number];
export const S = 0;
export const H = 1;
export const D = 2;
export const C = 3;

/** Every shape thirteen cards can have. */
export const ALL_SHAPES: Shape[] = (() => {
  const out: Shape[] = [];
  for (let s = 0; s <= 13; s++) for (let h = 0; h <= 13 - s; h++) for (let d = 0; d <= 13 - s - h; d++) out.push([s, h, d, 13 - s - h - d]);
  return out;
})();
