import { describe, expect, it } from 'vitest';
import { mitreTechniquesData } from '../../mitre-attack/data';
import * as outcomeIds from './attack-outcomes-ids';
import { ATTACK_OUTCOMES } from './attack-outcomes-data';

// The catalog is closed reference data: every count below is pinned as a literal so that any edit
// to the seed source shows up as a reviewed diff in this file rather than passing silently.
const OUTCOME_COUNT = 7;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isNonEmpty = (value: string) => value.trim().length > 0;

describe('ATTACK_OUTCOMES', () => {
  it('holds the seven attack outcomes, one per declared identifier', () => {
    expect(ATTACK_OUTCOMES).toHaveLength(OUTCOME_COUNT);
    // The ids file is sorted by name and the catalog by narrative order, so the guard is a set
    // comparison: it catches an id declared and never used, and an entry built on an inline UUID.
    expect(ATTACK_OUTCOMES.map((outcome) => outcome.id).toSorted()).toEqual(Object.values(outcomeIds).toSorted());
  });

  it('gives every outcome a positive reference dwell and non-empty labels', () => {
    for (const outcome of ATTACK_OUTCOMES) {
      expect(isNonEmpty(outcome.name)).toBe(true);
      expect(isNonEmpty(outcome.description)).toBe(true);
      expect(outcome.referenceDwellDays).toBeGreaterThan(0);
      expect(Number.isFinite(outcome.referenceDwellDays)).toBe(true);
    }
  });

  // The key set is pinned so that adding an occurrence probability or an occurrence rate field to
  // an outcome fails this test instead of passing review unnoticed.
  it('exposes exactly the expected keys on every outcome entry', () => {
    for (const outcome of ATTACK_OUTCOMES) {
      expect(Object.keys(outcome).sort()).toEqual([
        'criteriaReached',
        'description',
        'id',
        'name',
        'referenceDwellDays',
        'relatedTechniqueExternalIds',
        'signatureTechniqueExternalIds',
        'terminalTacticExternalId',
      ]);
    }
  });

  it('ends data outcomes on exfiltration and disruption outcomes on impact', () => {
    expect(Object.fromEntries(ATTACK_OUTCOMES.map((outcome) => [outcome.name, outcome.terminalTacticExternalId]))).toEqual({
      'Ransomware': 'TA0040',
      'Data Theft Extortion': 'TA0010',
      'Data Breach & Resale': 'TA0010',
      'Financial Fraud & Funds Theft': 'TA0040',
      'Espionage': 'TA0010',
      'Service Disruption': 'TA0040',
      'Destructive Attack': 'TA0040',
    });
  });

  it('grades the criteria each outcome reaches, availability, integrity, confidentiality then traceability', () => {
    expect(Object.fromEntries(ATTACK_OUTCOMES.map(({ name, criteriaReached: c }) => [
      name,
      [c.availability, c.integrity, c.confidentiality, c.traceability],
    ]))).toEqual({
      'Ransomware': ['full', 'lower', 'full', 'none'],
      'Data Theft Extortion': ['none', 'none', 'full', 'none'],
      'Data Breach & Resale': ['none', 'none', 'full', 'none'],
      'Financial Fraud & Funds Theft': ['none', 'full', 'none', 'lower'],
      'Espionage': ['none', 'none', 'full', 'none'],
      'Service Disruption': ['full', 'none', 'none', 'none'],
      'Destructive Attack': ['full', 'full', 'none', 'none'],
    });
  });

  it('writes every identifier as a well-formed UUID', () => {
    for (const outcome of ATTACK_OUTCOMES) {
      expect(outcome.id).toMatch(UUID_PATTERN);
    }
  });
});

describe('ATTACK_OUTCOMES outcome techniques', () => {
  const techniqueByExternalId = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique]));

  it('resolves every curated identifier in the vendored MITRE dataset, non-revoked', () => {
    // The tenant seeder resolves external ids against this dataset and silently skips unmatched
    // ones, and the repository filters revoked techniques out, so a revoked id costs the
    // association exactly as a typo would.
    const unresolved: Array<string> = [];
    const revoked: Array<string> = [];

    for (const outcome of ATTACK_OUTCOMES) {
      for (const externalId of [...outcome.signatureTechniqueExternalIds, ...outcome.relatedTechniqueExternalIds]) {
        const technique = techniqueByExternalId.get(externalId);
        if (!technique) {
          unresolved.push(`${outcome.name}:${externalId}`);
        } else if (technique.revoked) {
          revoked.push(`${outcome.name}:${externalId}`);
        }
      }
    }

    expect(unresolved).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it('leaves every outcome with at least one signature technique', () => {
    // An outcome shipping with zero active techniques makes every CRQ run on it throw
    // 'Cannot run CRQ simulation: attack outcome has no active techniques'.
    for (const outcome of ATTACK_OUTCOMES) {
      expect(outcome.signatureTechniqueExternalIds.length).toBeGreaterThan(0);
    }
  });

  it('never lists the same identifier twice within one outcome', () => {
    for (const outcome of ATTACK_OUTCOMES) {
      const all = [...outcome.signatureTechniqueExternalIds, ...outcome.relatedTechniqueExternalIds];
      expect(new Set(all).size).toBe(all.length);
    }
  });
});
