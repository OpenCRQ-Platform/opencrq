import { describe, expect, it } from 'vitest';
import {
  formatCreditShare,
  formatFactor,
  formatWeight,
  toDefenceFigure,
  toFigure,
} from './score-explanation-utils';

describe('formatFactor', () => {
  it('keeps four decimals, which is what makes the product replayable by hand', () => {
    expect(formatFactor(0.291765, 'en')).toBe('0.2918');
  });

  it('pads to two decimals so a column of factors lines up', () => {
    expect(formatFactor(0.6, 'en')).toBe('0.60');
  });

  it('follows the locale, which is the whole point of passing one', () => {
    expect(formatFactor(0.2918, 'fr')).toBe('0,2918');
  });
});

describe('formatWeight', () => {
  it('stops at three decimals, which is all any published weight carries', () => {
    expect(formatWeight(0.7294117647, 'en')).toBe('0.729');
  });

  it('keeps a floor readable rather than printing it as 0.1', () => {
    expect(formatWeight(0.05, 'en')).toBe('0.05');
  });
});

describe('formatCreditShare', () => {
  it('reads as whole percent: a rank rule, never a measurement', () => {
    expect(formatCreditShare(1, 'en')).toBe('100%');
    expect(formatCreditShare(0.7, 'en')).toBe('70%');
    expect(formatCreditShare(0.49, 'en')).toBe('49%');
  });
});

describe('toFigure', () => {
  it('puts the factor on the score s own scale', () => {
    expect(toFigure(0.2918)).toBe(29);
    expect(toFigure(0.7333)).toBe(73);
  });
});

describe('toDefenceFigure', () => {
  // The controls panel publishes the complement, and the two readings must always add to 100 or a
  // reader comparing the panel with the product finds a point missing.
  it('complements what gets through', () => {
    expect(toDefenceFigure(0.24)).toBe(76);
    expect(toFigure(0.24) + toDefenceFigure(0.24)).toBe(100);
  });
});
