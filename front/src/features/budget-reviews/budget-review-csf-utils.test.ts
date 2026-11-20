import { describe, expect, it } from 'vitest';
import type { CsfLine } from './budget-review-csf-utils';
import { csfFunctionSpend, csfWheel } from './budget-review-csf-utils';

const LINES: Array<CsfLine> = [
  { id: 'mfa', name: 'IDP', nature: 'build', amountSpent: 120, csfFunctions: ['PR'] },
  { id: 'edr', name: 'EDR', nature: 'build', amountSpent: 180, csfFunctions: ['PR', 'DE'] },
  { id: 'soc', name: 'SOC', nature: 'run', amountSpent: 480, csfFunctions: ['ID', 'PR', 'DE'] },
];

describe('csfFunctionSpend', () => {
  it('counts a line\'s whole spend in every function it touches, split by nature', () => {
    const spend = csfFunctionSpend(LINES);
    const of = (csfFunction: string) => spend.find((entry) => entry.csfFunction === csfFunction)!;

    expect(of('PR')).toMatchObject({ build: 300, run: 480, touched: 780 });
    expect(of('PR').lines.map((line) => line.id)).toEqual(['mfa', 'edr', 'soc']);
    expect(of('DE')).toMatchObject({ build: 180, run: 480, touched: 660 });
    expect(of('ID')).toMatchObject({ build: 0, run: 480, touched: 480 });
  });

  it('lists every function, in CSF order, the untouched ones at zero', () => {
    const spend = csfFunctionSpend(LINES);

    expect(spend.map((entry) => entry.csfFunction)).toEqual(['GV', 'ID', 'PR', 'DE', 'RS', 'RC']);
    expect(spend.find((entry) => entry.csfFunction === 'GV')).toMatchObject({ lines: [], touched: 0 });
  });
});

const startOf = (path: string): [number, number] => {
  const [, x, y] = path.split(' ');
  return [Number(x), Number(y)];
};

describe('csfWheel', () => {
  it('draws the five ring functions clockwise from the top, Govern a ring inside them', () => {
    const wheel = csfWheel(400, 13);

    expect(wheel.wedges.map((wedge) => wedge.csfFunction)).toEqual(['ID', 'PR', 'DE', 'RS', 'RC']);
    expect(startOf(wheel.wedges[0].path)[0]).toBeGreaterThan(200);
    expect(startOf(wheel.wedges[0].path)[1]).toBeCloseTo(12, 0);
    expect(wheel.centreRadius).toBeGreaterThan(0);
    expect(wheel.governPath.match(/M/g)).toHaveLength(2);
  });

  it('leaves a gap of constant width between two wedges, straight from the ring\'s inner edge to its outer one', () => {
    const [identify] = csfWheel(400, 13).wedges;
    const tokens = identify.path.split(' ');
    const outerStartX = Number(tokens[1]);
    const innerEndX = Number(tokens.at(-3));

    expect(outerStartX).toBeCloseTo(202.5, 1);
    expect(innerEndX).toBeCloseTo(202.5, 1);
  });

  it('runs the bottom label anticlockwise so it reads upright, the others clockwise', () => {
    const { wedges } = csfWheel(400, 13);
    const clockwise = (path: string) => path.includes(' 0 0 1 ');

    expect(wedges.map((wedge) => clockwise(wedge.labelPath))).toEqual([true, true, false, true, true]);
  });

  it('raises a wedge outwards only', () => {
    const [identify] = csfWheel(400, 13).wedges;

    expect(identify.raisedPath).not.toBe(identify.path);
    expect(identify.raisedPath.split('L')[1]).toBe(identify.path.split('L')[1]);
  });
});
