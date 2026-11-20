import { describe, expect, it } from 'vitest';
import { isSourceStillReporting, sourceVerdictAt } from './evidence-source-freshness';

const day = (n: number): Date => new Date(Date.UTC(2026, 0, n));

describe('sourceVerdictAt', () => {
  it('dates a source by the observation it carries, not by the sync that sent it again', () => {
    expect(sourceVerdictAt({ sourceReportedAt: day(9), evaluatedAt: day(2), enumerationReportedAt: day(9) })).toEqual(day(2));
  });

  it('dates a source carrying no observation time by its sync', () => {
    expect(sourceVerdictAt({ sourceReportedAt: day(9), evaluatedAt: null, enumerationReportedAt: null })).toEqual(day(9));
  });

  it('dates a source a later run left out by that run', () => {
    expect(sourceVerdictAt({ sourceReportedAt: day(3), evaluatedAt: day(2), enumerationReportedAt: day(5) })).toEqual(day(5));
  });

  it('keeps an observation dated after the run that left its source out', () => {
    expect(sourceVerdictAt({ sourceReportedAt: day(3), evaluatedAt: day(7), enumerationReportedAt: day(5) })).toEqual(day(7));
  });
});

describe('isSourceStillReporting', () => {
  it('keeps a source re-confirmed by the last run over its asset, whatever its verdict', () => {
    expect(isSourceStillReporting({ connectorId: 'c1', sourceReportedAt: day(5), enumerationReportedAt: day(5) })).toBe(true);
  });

  it('keeps a source on an asset nothing ever walked whole', () => {
    expect(isSourceStillReporting({ connectorId: 'c1', sourceReportedAt: day(1), enumerationReportedAt: null })).toBe(true);
  });

  it('drops a source a later run left out, and one whose connector is gone', () => {
    expect(isSourceStillReporting({ connectorId: 'c1', sourceReportedAt: day(3), enumerationReportedAt: day(5) })).toBe(false);
    expect(isSourceStillReporting({ connectorId: null, sourceReportedAt: day(9), enumerationReportedAt: null })).toBe(false);
  });
});
