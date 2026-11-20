import { describe, expect, it } from 'vitest';
import { controlCapabilitiesData } from '../../controls/capability/data/capabilities.generated';
import { DRATA_CAPABILITY_EVIDENCE_PROVENANCE, DRATA_DCF_CAPABILITY_EVIDENCE } from './drata-capability-mapping.generated';

/**
 * Pinned pairs, in both directions. A required pair the generator drops silently removes a
 * capability's compliance evidence; a forbidden pair credits one no practitioner would sign. A
 * divergent verdict after a regeneration is a generator prompt to fix, never a pin to widen.
 */
const REQUIRED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['KMS', 'DCF-54'],
  ['WAF', 'DCF-88'],
  ['DLP', 'DCF-150'],
];

const FORBIDDEN_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['EDR', 'DCF-654'],
  ['KMS', 'DCF-594'],
  ['DSPM', 'DCF-102'],
];

/**
 * IDP's whole evidence, pinned whole: the engine reads its rungs as MFA factor types, phishing-resistant
 * at L3, so a password setting would derive MFA nobody deployed, and a pair short of phishing
 * resistance must attest nothing above L1.
 */
const IDP_CODES = ['DCF-58', 'DCF-67', 'DCF-354', 'DCF-355'];

const EVIDENCE_PAIR_COUNT = 69;

const ATTESTED_LEVELS = ['L1', 'L2', 'L3'];

const entries = Object.entries(DRATA_DCF_CAPABILITY_EVIDENCE);
const allPairs = entries.flatMap(([externalId, pairs]) => pairs.map((pair) => ({ externalId, ...pair })));
const codesOf = (externalId: string): ReadonlyArray<string> =>
  allPairs.filter((pair) => pair.externalId === externalId).map((pair) => pair.code);

describe('DRATA_DCF_CAPABILITY_EVIDENCE', () => {
  it('carries its generation provenance as data values', () => {
    expect(DRATA_CAPABILITY_EVIDENCE_PROVENANCE.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DRATA_CAPABILITY_EVIDENCE_PROVENANCE.judgmentPromptVersion.length).toBeGreaterThan(0);
    expect(DRATA_CAPABILITY_EVIDENCE_PROVENANCE.attestationPromptVersion.length).toBeGreaterThan(0);
    expect(DRATA_CAPABILITY_EVIDENCE_PROVENANCE.judgmentModel.length).toBeGreaterThan(0);
    expect(DRATA_CAPABILITY_EVIDENCE_PROVENANCE.capabilityCount).toBe(entries.length);
  });

  it('keys every capability of the catalogue, and only those', () => {
    expect(entries.map(([externalId]) => externalId).sort())
      .toEqual(controlCapabilitiesData.map((capability) => capability.externalId).sort());
  });

  it('carries DCF codes only, without duplicates within a capability', () => {
    for (const pair of allPairs) {
      expect(pair.code).toMatch(/^DCF-\d+$/);
    }
    for (const [externalId] of entries) {
      const codes = codesOf(externalId);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('emits only pairs attesting at least one level, in ascending order', () => {
    for (const pair of allPairs) {
      expect(pair.levels.length).toBeGreaterThan(0);
      expect([...pair.levels]).toEqual(ATTESTED_LEVELS.filter((level) => (pair.levels as ReadonlyArray<string>).includes(level)));
    }
  });

  it('tags a reach only when the pair claims the whole coverage unit or a slice of it', () => {
    for (const pair of allPairs) {
      if ('reach' in pair) {
        expect(['org_wide', 'slice']).toContain(pair.reach);
      }
    }
  });

  it('holds the arbitrated anchors in both directions', () => {
    for (const [externalId, code] of REQUIRED_PAIRS) {
      expect(codesOf(externalId)).toContain(code);
    }
    for (const [externalId, code] of FORBIDDEN_PAIRS) {
      expect(codesOf(externalId)).not.toContain(code);
    }
  });

  it('holds IDP to the pairs that attest MFA enforced, none above L1', () => {
    expect([...codesOf('IDP')].sort()).toEqual([...IDP_CODES].sort());
    expect(allPairs.filter((pair) => pair.externalId === 'IDP').flatMap((pair) => pair.levels)).toEqual(['L1', 'L1', 'L1', 'L1']);
  });

  it('pins the arbitrated pair count', () => {
    expect(allPairs).toHaveLength(EVIDENCE_PAIR_COUNT);
  });
});
