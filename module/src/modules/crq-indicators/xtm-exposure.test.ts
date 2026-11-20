import { describe, expect, it } from 'vitest';
import { summariseXtmExposure } from './xtm-exposure';

describe('summariseXtmExposure', () => {
  it('counts each scenario once per object and sums its priced figures', () => {
    const out = summariseXtmExposure([
      { objectId: 'a', riskScenarioId: 's1', aleMean: 100, aleReductionMean: 10 },
      { objectId: 'a', riskScenarioId: 's1', aleMean: 100, aleReductionMean: 10 },
      { objectId: 'a', riskScenarioId: 's2', aleMean: 50, aleReductionMean: null },
      { objectId: 'b', riskScenarioId: 's1', aleMean: 100 },
    ]);
    expect(out.get('a')).toEqual({ scenarioCount: 2, aleMean: 150, aleReductionMean: 10 });
    expect(out.get('b')).toEqual({ scenarioCount: 1, aleMean: 100, aleReductionMean: null });
  });

  it('keeps an unpriced exposure null, never zero', () => {
    const out = summariseXtmExposure([{ objectId: 'a', riskScenarioId: 's1', aleMean: null }]);
    expect(out.get('a')).toEqual({ scenarioCount: 1, aleMean: null, aleReductionMean: null });
  });

  it('skips a row with no object', () => {
    expect(summariseXtmExposure([{ objectId: null, riskScenarioId: 's1', aleMean: 1 }]).size).toBe(0);
  });
});
