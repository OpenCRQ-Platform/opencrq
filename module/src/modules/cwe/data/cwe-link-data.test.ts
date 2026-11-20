import { describe, expect, it } from 'vitest';
import { mitreTechniquesData } from '../../mitre-attack/data/mitre-techniques';
import { shippedLinkRows } from './cwe-link-rows';
import { CWE_TECHNIQUE_LINK } from './cwe-technique-link';
import { CWE_TECHNIQUE_LINK_PROVENANCE } from './cwe-technique-link-provenance';
import { CWE_WEAKNESSES } from './cwe-weaknesses';

const CATALOGUE = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique]));

describe('the vendored CWE link', () => {
  it('agrees with its provenance', () => {
    expect(CWE_WEAKNESSES).toHaveLength(CWE_TECHNIQUE_LINK_PROVENANCE.weaknessCount);
    expect(CWE_TECHNIQUE_LINK).toHaveLength(CWE_TECHNIQUE_LINK_PROVENANCE.rowCount);
  });

  it('links only weaknesses it names', () => {
    const named = new Set(CWE_WEAKNESSES.map((weakness) => weakness.externalId));
    expect(CWE_TECHNIQUE_LINK.filter((row) => !named.has(row.cweExternalId))).toEqual([]);
  });

  it('cites only live techniques of the product catalogue', () => {
    const dangling = CWE_TECHNIQUE_LINK.filter((row) => CATALOGUE.get(row.techniqueExternalId)?.revoked !== false);
    expect(dangling).toEqual([]);
  });

  it('names the justification of every row', () => {
    for (const row of CWE_TECHNIQUE_LINK) {
      expect(row.justificationRef).not.toBe('');
      expect(row.justificationName === null).toBe(row.justificationKind === 'consequence');
    }
  });

  it('links a weakness declaring code execution to T1059', () => {
    expect(CWE_TECHNIQUE_LINK).toContainEqual({
      cweExternalId: 'CWE-287',
      techniqueExternalId: 'T1059',
      justificationKind: 'consequence',
      justificationRef: 'Execute Unauthorized Code or Commands',
      justificationName: null,
    });
  });

  it('gives every shipped row its own seed id', () => {
    const ids = shippedLinkRows().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
