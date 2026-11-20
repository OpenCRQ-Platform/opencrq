/** Degrees of arc the scale spans. The bottom stays open, so the two ends read as 0 and 100. */
const SWEEP_DEGREES = 240;

/** Stroke thickness as a share of the box side, so every size of the gauge draws the same shape. */
const STROKE_RATIO = 0.1;

interface GaugeGeometry {
  strokeWidth: number,
  /** Half the box side: the arc is centred on it, and so is whatever is drawn inside the arc. */
  centre: number,
  /** Lowest point the stroke reaches, which is where a gauge cropped to its arc ends. */
  arcBottom: number,
  /** Horizontal distance from the centre to an arc end, where the scale labels sit. */
  endOffset: number,
  path: string,
}

const round = (value: number): number => Math.round(value * 100) / 100;

const pointFromTop = (centre: number, radius: number, degrees: number): { x: number, y: number } => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: centre + radius * Math.sin(radians),
    y: centre - radius * Math.cos(radians),
  };
};

/**
 * The arc of a gauge drawn in a square box of `size`, centred in it.
 *
 * The path sweeps more than a half turn, hence the large-arc flag, and runs clockwise from the
 * lower left to the lower right. It carries no scale of its own: a caller states how much of it is
 * filled through `pathLength`, which normalises the stroke dash to the score's own 0 to 100.
 */
export const gaugeGeometry = (size: number): GaugeGeometry => {
  const strokeWidth = size * STROKE_RATIO;
  const radius = (size - strokeWidth) / 2;
  const centre = size / 2;
  const half = SWEEP_DEGREES / 2;
  const start = pointFromTop(centre, radius, -half);
  const end = pointFromTop(centre, radius, half);
  return {
    strokeWidth: round(strokeWidth),
    centre,
    arcBottom: round(end.y + strokeWidth / 2),
    endOffset: round(end.x - centre),
    path: `M ${round(start.x)} ${round(start.y)} A ${round(radius)} ${round(radius)} 0 1 1 ${round(end.x)} ${round(end.y)}`,
  };
};
