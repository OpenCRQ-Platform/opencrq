import { describe, expect, it } from 'vitest';
import { gaugeGeometry } from './score-gauge-geometry';

describe('gaugeGeometry', () => {
  it('draws the same shape at every size', () => {
    const small = gaugeGeometry(32);
    const large = gaugeGeometry(64);
    expect(large.strokeWidth).toBe(small.strokeWidth * 2);
    expect(large.centre).toBe(small.centre * 2);
    expect(large.arcBottom).toBe(small.arcBottom * 2);
    expect(large.endOffset).toBe(small.endOffset * 2);
  });

  it('leaves the box open under the arc', () => {
    const { arcBottom, centre } = gaugeGeometry(152);
    expect(arcBottom).toBeGreaterThan(centre);
    expect(arcBottom).toBeLessThan(152);
  });

  it('keeps the arc and its ends inside the box', () => {
    const size = 152;
    const { endOffset, strokeWidth, centre } = gaugeGeometry(size);
    expect(endOffset).toBeGreaterThan(0);
    expect(centre + endOffset + strokeWidth / 2).toBeLessThanOrEqual(size);
  });

  it('sweeps more than a half turn, from the lower left to the lower right', () => {
    const { path, centre } = gaugeGeometry(100);
    const [, startX, startY, radiusX, , , largeArc, sweep, endX, endY] = path
      .replace(/[MA]/g, ' ')
      .split(/\s+/);
    expect(largeArc).toBe('1');
    expect(sweep).toBe('1');
    expect(Number(startX)).toBeLessThan(centre);
    expect(Number(endX)).toBeGreaterThan(centre);
    expect(Number(startY)).toBe(Number(endY));
    expect(Number(startY)).toBeGreaterThan(centre);
    expect(Number(radiusX)).toBeGreaterThan(0);
  });
});
