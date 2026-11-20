import { describe, expect, it } from 'vitest';
import { buildCounterParents, buildCounterRecord, orderParentsFirst } from '../../modules/threat-analyses/outcome-counter/counter-record';
import { hasMinimumEvidence, loadOutcomeCounter, OUTCOME_COUNTER_OUTCOMES } from '../../modules/threat-analyses/outcome-counter/outcome-counter';
import { parseThreatBundle } from '../../modules/threat-analyses/stix-bundle-parser';
import { buildAcmeThreatBundle } from './acme-threat-bundle';
import { ACME_THREAT_OUTCOME_PROBABILITIES, acmeSeedOutcomeCounter } from './acme-threat-outcome-probabilities';

// Scored as `ingestBundle` scores a bundle: parents first, each child reading what its parent was given.
const scoreWithShippedModel = (): Map<string, Array<number>> => {
  const counter = loadOutcomeCounter();
  const catalogIdByRowId = new Map(OUTCOME_COUNTER_OUTCOMES.map((catalogId) => [catalogId, catalogId]));
  const stored: Array<{ stixId: string, attackOutcomeId: string, probability: number, evidenceSufficient: boolean }> = [];
  const scored = new Map<string, Array<number>>();
  for (const entry of orderParentsFirst(parseThreatBundle(buildAcmeThreatBundle(new Date())))) {
    const record = buildCounterRecord(entry, buildCounterParents(entry.attributions, stored, catalogIdByRowId));
    const probabilities = counter.predict(record);
    const evidenceSufficient = hasMinimumEvidence(record);
    OUTCOME_COUNTER_OUTCOMES.forEach((attackOutcomeId, index) => {
      stored.push({ stixId: entry.threat.stixId, attackOutcomeId, probability: probabilities[index], evidenceSufficient });
    });
    scored.set(entry.threat.stixId, probabilities);
  }
  return scored;
};

describe('ACME_THREAT_OUTCOME_PROBABILITIES', () => {
  const scored = scoreWithShippedModel();

  it('holds exactly the demo threats', () => {
    expect(Object.keys(ACME_THREAT_OUTCOME_PROBABILITIES).sort()).toEqual([...scored.keys()].sort());
  });

  it.each([...scored])('matches the shipped model on %s', (stixId, probabilities) => {
    const stored = ACME_THREAT_OUTCOME_PROBABILITIES[stixId];
    expect(stored).toHaveLength(OUTCOME_COUNTER_OUTCOMES.length);
    probabilities.forEach((value, index) => {
      expect(Math.abs(value - stored[index])).toBeLessThanOrEqual(1e-12);
    });
  });
});

describe('acmeSeedOutcomeCounter', () => {
  const record = buildCounterRecord(parseThreatBundle(buildAcmeThreatBundle(new Date()))[0], []);

  it('answers a demo threat with its stored percentages', () => {
    expect(acmeSeedOutcomeCounter.predict(record)).toEqual(ACME_THREAT_OUTCOME_PROBABILITIES[record.id!]);
  });

  it('refuses a threat the demo does not hold', () => {
    expect(() => acmeSeedOutcomeCounter.predict({ ...record, id: 'intrusion-set--unknown' })).toThrow(/no stored outcome probabilities/);
  });
});
