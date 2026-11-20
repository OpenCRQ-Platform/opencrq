import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OutcomeCounterRecord } from './outcome-counter';
import expectedJson from './__fixtures__/parity-expected.json';
import recordsJson from './__fixtures__/parity-records.json';
import {
  hasMinimumEvidence,
  loadOutcomeCounter,
  OUTCOME_COUNTER_OUTCOMES,
  OUTCOME_COUNTER_VERSION,
} from './outcome-counter';

interface ParityExpectation {
  name: string,
  probabilities: Array<number>,
  hasMinimumEvidence: boolean,
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the JSON fixtures are typed by their literal shape, not by the record contract
const records = recordsJson as unknown as Array<OutcomeCounterRecord>;
const expected: Array<ParityExpectation> = expectedJson;

const emptyRecord: OutcomeCounterRecord = {
  id: null,
  type: 'intrusion-set',
  name: 'Example',
  aliases: [],
  title: null,
  description: '',
  motivations: [],
  goals: [],
  malware: [],
  labels: [],
  sectors: [],
  techniques: [],
  parentCount: 0,
  parents: [],
  reports: [],
};

describe('outcome counter parity with the expected scores', () => {
  const counter = loadOutcomeCounter();

  it('exposes its version and the seven outcomes', () => {
    expect(counter.version).toBe(OUTCOME_COUNTER_VERSION);
    expect(OUTCOME_COUNTER_OUTCOMES).toHaveLength(7);
    expect(new Set(OUTCOME_COUNTER_OUTCOMES).size).toBe(7);
  });

  it('has one expectation per record', () => {
    expect(expected).toHaveLength(records.length);
  });

  records.forEach((record, index) => {
    const reference = expected[index];

    it(`predicts ${reference.name} within 1e-12 of the reference`, () => {
      const probabilities = counter.predict(record);
      expect(probabilities).toHaveLength(7);
      probabilities.forEach((value, outcome) => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(Math.abs(value - reference.probabilities[outcome])).toBeLessThanOrEqual(1e-12);
      });
    });

    it(`reports the reference minimum evidence flag for ${reference.name}`, () => {
      expect(hasMinimumEvidence(record)).toBe(reference.hasMinimumEvidence);
    });
  });
});

describe('hasMinimumEvidence', () => {
  it('is true with a description', () => {
    expect(hasMinimumEvidence({ ...emptyRecord, description: 'Targets banks.' })).toBe(true);
  });

  it('is false with a blank description', () => {
    expect(hasMinimumEvidence({ ...emptyRecord, description: '   ' })).toBe(false);
  });

  it('needs a report summary longer than 100 characters', () => {
    const report = (length: number) => ({ title: 'Report', summary: 'x'.repeat(length), labels: [] });
    expect(hasMinimumEvidence({ ...emptyRecord, reports: [report(101)] })).toBe(true);
    expect(hasMinimumEvidence({ ...emptyRecord, reports: [report(100)] })).toBe(false);
  });

  it('is true with a motivation or a goal', () => {
    expect(hasMinimumEvidence({ ...emptyRecord, motivations: ['financial-gain'] })).toBe(true);
    expect(hasMinimumEvidence({ ...emptyRecord, goals: ['steal data'] })).toBe(true);
  });

  it('is true with a parent that has probabilities and false with one that has none', () => {
    const known = { inferred: false, probabilities: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], evidenceSufficient: true };
    expect(hasMinimumEvidence({ ...emptyRecord, parents: [known] })).toBe(true);
    expect(hasMinimumEvidence({ ...emptyRecord, parents: [{ ...known, probabilities: null }] })).toBe(false);
  });

  it('counts an evidenced parent only on a threat with at most 3 parents', () => {
    const known = { inferred: false, probabilities: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], evidenceSufficient: true };
    expect(hasMinimumEvidence({ ...emptyRecord, parentCount: 3, parents: [known] })).toBe(true);
    expect(hasMinimumEvidence({ ...emptyRecord, parentCount: 4, parents: [known] })).toBe(false);
  });

  it('is false with a parent whose probabilities lack minimum evidence of their own', () => {
    const prior = { inferred: false, probabilities: [0.1, 0.1, 0.1, 0.1, 0.6, 0.1, 0.1], evidenceSufficient: false };
    expect(hasMinimumEvidence({ ...emptyRecord, parents: [prior] })).toBe(false);
  });

  it('is false with only techniques and malware', () => {
    expect(hasMinimumEvidence({
      ...emptyRecord,
      techniques: ['T1566', 'T1059'],
      malware: [{ name: 'Example Loader', types: ['loader'] }],
    })).toBe(false);
  });
});

describe('loadOutcomeCounter', () => {
  it('returns the same counter on every call', () => {
    expect(loadOutcomeCounter()).toBe(loadOutcomeCounter());
  });

  it('refuses a calibration that weighs a fine-tuned model', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-counter-'));
    try {
      fs.writeFileSync(path.join(dir, 'logistic.json'), JSON.stringify({}));
      fs.writeFileSync(path.join(dir, 'calibration.json'), JSON.stringify({
        logistic: [],
        finetuned: [[1, 0]],
        weights: { logistic: 1, finetuned: 1 },
      }));
      expect(() => loadOutcomeCounter(dir)).toThrow(/fine-tuned/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
