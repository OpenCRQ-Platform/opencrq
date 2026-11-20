import type { CsfFunction } from '@app/module/client';
import { CSF_FUNCTIONS } from '@app/module/client';
import type { BudgetLineNature } from './budget-review-utils';

export interface CsfLine {
  id: string,
  name: string,
  nature: BudgetLineNature,
  amountSpent: number,
  csfFunctions: ReadonlyArray<CsfFunction>,
}

export interface CsfFunctionSpend {
  csfFunction: CsfFunction,
  lines: Array<CsfLine>,
  build: number,
  run: number,
  /** The whole spend of every line touching the function: it does not add up across functions. */
  touched: number,
}

const spentOn = (lines: ReadonlyArray<CsfLine>, nature: BudgetLineNature): number => lines
  .filter((line) => line.nature === nature)
  .reduce((total, line) => total + line.amountSpent, 0);

export const csfFunctionSpend = (lines: ReadonlyArray<CsfLine>): Array<CsfFunctionSpend> => CSF_FUNCTIONS.map((csfFunction) => {
  const touching = lines.filter((line) => line.csfFunctions.includes(csfFunction));
  const build = spentOn(touching, 'build');
  const run = spentOn(touching, 'run');
  return { csfFunction, lines: touching, build, run, touched: build + run };
});

/** NIST's published colours for the CSF 2.0 function wheel: they name the functions, so both themes keep them. */
export const CSF_FUNCTION_COLORS: Readonly<Record<CsfFunction, string>> = {
  GV: '#f9f49d',
  ID: '#4bb2e0',
  PR: '#9292ea',
  DE: '#fab746',
  RS: '#f97367',
  RC: '#7df49f',
};

/** CSF 2.0 draws Govern at the centre of its wheel and the five others around it, clockwise from the top. */
export const CSF_WHEEL_RING: ReadonlyArray<CsfFunction> = ['ID', 'PR', 'DE', 'RS', 'RC'];

export interface WheelWedge {
  csfFunction: CsfFunction,
  path: string,
  /** The same wedge reaching further out, for the function being read. */
  raisedPath: string,
  /** The arc its label follows, running so that the label reads upright. */
  labelPath: string,
}

export interface CsfWheel {
  wedges: Array<WheelWedge>,
  /** Govern's ring, two circles to fill with the even-odd rule. */
  governPath: string,
  governLabelPath: string,
  centreRadius: number,
}

const RING_WIDTH = 60;
const RING_GAP = 5;
const SEPARATOR_WIDTH = 5;
const GOVERN_WIDTH = 32;
const RAISE = 10;
const LABEL_TRIM_RADIANS = 0.06;
const GOVERN_LABEL_HALF_ANGLE = 0.9;

// eslint-disable-next-line no-restricted-syntax -- SVG path data, which SVG reads with a `.` whatever the application language
const round = (value: number): string => value.toFixed(1);

/**
 * The wheel as NIST draws it, in a square of `size`: five equal wedges split by straight gaps of
 * constant width, left empty so the card shows through, Govern a ring inside them, labels along the arcs. `labelSize` is the labels' font size, by which
 * their arcs are shifted so the text sits in the middle of its band. A label whose arc runs along
 * the bottom of the wheel is drawn right to left, so it does not read upside down.
 */
export const csfWheel = (size: number, labelSize: number): CsfWheel => {
  const centre = size / 2;
  const outer = centre - RAISE - 2;
  const inner = outer - RING_WIDTH;
  const governOuter = inner - RING_GAP;
  const governInner = governOuter - GOVERN_WIDTH;
  const top = -Math.PI / 2;
  const step = (2 * Math.PI) / CSF_WHEEL_RING.length;
  const point = (angle: number, radius: number): string => `${round(centre + radius * Math.cos(angle))} ${round(centre + radius * Math.sin(angle))}`;
  const svgPath = (...commands: Array<string | number>): string => commands.join(' ');
  /** Shifting each end by the angle a half-gap spans at that radius keeps both edges parallel to the dividing ray. */
  const sector = (from: number, to: number, innerRadius: number, outerRadius: number): string => {
    const halfGap = (radius: number): number => Math.asin(SEPARATOR_WIDTH / 2 / radius);
    return svgPath(
      'M', point(from + halfGap(outerRadius), outerRadius),
      'A', outerRadius, outerRadius, 0, 0, 1, point(to - halfGap(outerRadius), outerRadius),
      'L', point(to - halfGap(innerRadius), innerRadius),
      'A', innerRadius, innerRadius, 0, 0, 0, point(from + halfGap(innerRadius), innerRadius),
      'Z',
    );
  };
  const arc = (from: number, to: number, radius: number, reversed: boolean): string => (reversed
    ? svgPath('M', point(to, radius), 'A', radius, radius, 0, 0, 0, point(from, radius))
    : svgPath('M', point(from, radius), 'A', radius, radius, 0, 0, 1, point(to, radius)));
  const circle = (radius: number): string => svgPath(
    'M', point(Math.PI, radius),
    'A', radius, radius, 0, 1, 0, point(0, radius),
    'A', radius, radius, 0, 1, 0, point(Math.PI, radius),
    'Z',
  );

  const wedges = CSF_WHEEL_RING.map((csfFunction, index) => {
    const from = top + index * step;
    const to = from + step;
    const middleFromTop = (index + 0.5) * step;
    const reversed = middleFromTop > (2 * Math.PI) / 3 && middleFromTop < (4 * Math.PI) / 3;
    const labelRadius = (outer + inner) / 2 + (reversed ? 1 : -1) * labelSize * 0.35;
    return {
      csfFunction,
      path: sector(from, to, inner, outer),
      raisedPath: sector(from, to, inner, outer + RAISE),
      labelPath: arc(from + LABEL_TRIM_RADIANS, to - LABEL_TRIM_RADIANS, labelRadius, reversed),
    };
  });
  return {
    wedges,
    governPath: `${circle(governOuter)} ${circle(governInner)}`,
    governLabelPath: arc(top - GOVERN_LABEL_HALF_ANGLE, top + GOVERN_LABEL_HALF_ANGLE, (governOuter + governInner) / 2 - labelSize * 0.3, false),
    centreRadius: governInner,
  };
};
