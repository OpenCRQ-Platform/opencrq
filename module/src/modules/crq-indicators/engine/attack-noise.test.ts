import { describe, expect, it } from 'vitest';
import { TECHNIQUE_TABLES_PROVENANCE } from '../../technique-mapping/data';
import { mitreTechniquesData } from '../../mitre-attack/data/mitre-techniques';
import { ATTACK_WALK_TABLES_RELEASE, TACTIC_WALK_RULES } from './attack-walk';
import {
  ATTACK_NOISE_TABLES_RELEASE,
  isDetectableTactic,
  NOISE_BY_TACTIC,
  NOISE_OVERRIDES_BY_TECHNIQUE,
  noiseForAction,
} from './attack-noise';

describe('the noise table', () => {
  it('carries a value for every tactic of the walk and nothing else', () => {
    expect(Object.keys(NOISE_BY_TACTIC).sort())
      .toEqual(TACTIC_WALK_RULES.map((rule) => rule.tacticExternalId).sort());
  });

  it('carries no entry for external reconnaissance, by design', () => {
    expect(NOISE_BY_TACTIC['TA0043']).toBeUndefined();
    expect(noiseForAction('TA0043')).toBeNull();
    expect(isDetectableTactic('TA0043')).toBe(false);
    expect(isDetectableTactic('TA0007')).toBe(true);
  });

  it('keeps every value on the 0-1 scale', () => {
    for (const [key, value] of [...Object.entries(NOISE_BY_TACTIC), ...Object.entries(NOISE_OVERRIDES_BY_TECHNIQUE)]) {
      expect(value, key).toBeGreaterThanOrEqual(0);
      expect(value, key).toBeLessThanOrEqual(1);
    }
  });

  it('resolves the technique override over its tactic value', () => {
    expect(noiseForAction('TA0001', 'T1078')).toBe(0.15);
    expect(noiseForAction('TA0001', 'T1190')).toBe(NOISE_BY_TACTIC['TA0001']);
    expect(noiseForAction('TA0006', 'T1110')).toBe(0.9);
    expect(noiseForAction('TA0002', 'T1698')).toBe(0.15);
    expect(noiseForAction('TA0002', 'T1699')).toBe(0.3);
  });

  it('declares overrides only on live vendored techniques', () => {
    for (const techniqueExternalId of Object.keys(NOISE_OVERRIDES_BY_TECHNIQUE)) {
      const technique = mitreTechniquesData.find((candidate) => candidate.externalId === techniqueExternalId);
      expect(technique?.revoked, techniqueExternalId).toBe(false);
    }
  });
});

describe('the three micro-tables', () => {
  it('each carry the ATT&CK knowledge-base release they were written against', () => {
    expect(ATTACK_WALK_TABLES_RELEASE).toMatch(/attack-enterprise-\d/);
    expect(ATTACK_NOISE_TABLES_RELEASE).toMatch(/attack-enterprise-\d/);
    expect(TECHNIQUE_TABLES_PROVENANCE.sources.some((source) => source.id.includes('attack-enterprise-'))).toBe(true);
  });
});
