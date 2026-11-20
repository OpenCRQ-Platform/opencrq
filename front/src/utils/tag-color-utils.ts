/**
 * The fallback for a tag no origin gives a colour — a hand-made one, or a connector that reports
 * none. A chip paints the reported hex when there is one, so the same tag reads alike in both
 * products; hashing the name covers the rest with something stable across pages and sessions,
 * rather than leaving every uncoloured tag sharing one default.
 */
const hashToInt = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

/** Standard HSL → RGB conversion (CSS Color 4 formula), packed straight into a hex triplet. */
const hslToHex = (hueDegrees: number, saturationPercent: number, lightnessPercent: number): string => {
  const s = saturationPercent / 100;
  const l = lightnessPercent / 100;
  const k = (n: number) => (n + hueDegrees / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n: number) => Math.round(channel(n) * 255).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
};

const HUE_RANGE = 360;
// `Chip` bounds a data colour to a 21% wash, where even an optimally spread palette holds only
// ~8 entries above ΔE00 8 — the hue aids recall, it is never what tells two tags apart. Quantising
// the range would not change that: a hashed hue lands beside a reported hex as readily as beside
// another hashed one, and no palette reaches the reported side.
const SATURATION_PERCENT = 65;
const LIGHTNESS_PERCENT = 55;

/** A stable hex for this tag name, for `Chip`'s `color` axis — the same name always paints the same hue. */
export const tagColorHex = (name: string): string => hslToHex(hashToInt(name) % HUE_RANGE, SATURATION_PERCENT, LIGHTNESS_PERCENT);
