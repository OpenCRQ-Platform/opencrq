import { describe, expect, it } from 'vitest';
import type { AssetCategory } from '../../supporting-assets/constants';
import { mitreTechniquesData, TACTIC_TA0042, TACTIC_TA0043 } from '../../mitre-attack/data';
import { ASSET_CATEGORY_VALUES } from '../../supporting-assets/constants';
import { APPLICABLE_TECHNIQUE_PROVENANCE, APPLICABLE_TECHNIQUES } from './applicable-techniques-data';
import { UNRESOLVED_TECHNIQUE_EXTERNAL_IDS } from './applicable-techniques-seed';

/**
 * The families that ship with no entries: the unclassified bucket concerns every technique and is
 * answered by a resolver rule instead of by rows, and a security platform is not a loss-bearing
 * target (`isLossBearingAssetCategory`), so no technique is applicable to it as one. A further
 * exemption is a decision, never a test fix.
 */
const EMPTY_FAMILIES = ['security_platform', 'generic_asset'] as const;

/**
 * Reconnaissance and Resource Development: what an attacker prepares outside the victim's estate.
 * The rule is written on tactics rather than on the upstream `PRE` platform because tactics are
 * the part of it the product's own reference data carries.
 */
const PREPARATION_TACTIC_IDS = new Set([TACTIC_TA0042, TACTIC_TA0043]);

const ENTRY_COUNT = 1637;

const allEntries = ASSET_CATEGORY_VALUES.flatMap((category) => APPLICABLE_TECHNIQUES[category]);

describe('APPLICABLE_TECHNIQUES', () => {
  it('carries the release it was generated from as a data value', () => {
    expect(APPLICABLE_TECHNIQUE_PROVENANCE.knowledgeBaseRelease).toBe('20.0');
  });

  it('records a judgment provenance for every family but the rule-answered bucket', () => {
    const judged = new Set(APPLICABLE_TECHNIQUE_PROVENANCE.judgments.map((judgment) => judgment.family));
    const expected = ASSET_CATEGORY_VALUES.filter((category) => !(EMPTY_FAMILIES as ReadonlyArray<AssetCategory>).includes(category));
    expect([...judged].toSorted()).toEqual([...expected].toSorted());
    for (const judgment of APPLICABLE_TECHNIQUE_PROVENANCE.judgments) {
      expect(judgment.promptVersion.length).toBeGreaterThan(0);
      expect(judgment.model.length).toBeGreaterThan(0);
    }
  });

  // A family whose session at this release went missing would otherwise pass on its older entries.
  it('records exactly one judgment session per family at the release the entries were drawn from', () => {
    const { judgments, knowledgeBaseRelease } = APPLICABLE_TECHNIQUE_PROVENANCE;
    const sessions = judgments.map((judgment) => `${judgment.family}|${judgment.release}`);
    expect(new Set(sessions).size).toBe(sessions.length);
    const current = judgments.filter((judgment) => judgment.release === knowledgeBaseRelease).map((judgment) => judgment.family);
    expect(current.toSorted()).toEqual([...new Set(judgments.map((judgment) => judgment.family))].toSorted());
  });

  it('keys on exactly the product asset categories', () => {
    expect(Object.keys(APPLICABLE_TECHNIQUES).toSorted()).toEqual([...ASSET_CATEGORY_VALUES].toSorted());
  });

  // Pinned as a literal so that regenerating against a new release shows up as a reviewed diff.
  it('holds the expected number of entries, with no duplicate inside a family', () => {
    expect(allEntries).toHaveLength(ENTRY_COUNT);
    for (const category of ASSET_CATEGORY_VALUES) {
      const entries = APPLICABLE_TECHNIQUES[category];
      expect(new Set(entries).size).toBe(entries.length);
    }
  });

  it('leaves no family empty except the named exemption', () => {
    const empty = ASSET_CATEGORY_VALUES.filter((category) => APPLICABLE_TECHNIQUES[category].length === 0);
    expect(empty.toSorted()).toEqual([...EMPTY_FAMILIES].toSorted());
  });

  it('gives the unclassified bucket zero entries, asserted by cardinality', () => {
    expect(APPLICABLE_TECHNIQUES.generic_asset).toHaveLength(0);
  });

  it('writes the table at sub-technique grain, sub-cases included', () => {
    expect(allEntries.some((externalId) => externalId.includes('.'))).toBe(true);
  });
});

describe('APPLICABLE_TECHNIQUES against the product reference data', () => {
  const techniqueByExternalId = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique]));

  /*
   * Zero tolerance. A table citing a technique the product does not carry seeds a silently thinner
   * table, and an attack step on the missing technique then reaches no family at all. Two ways out
   * when this fails: regenerate against the release the product carries, or update the MITRE
   * reference data.
   */
  it('resolves every cited identifier in the vendored MITRE dataset', () => {
    expect(UNRESOLVED_TECHNIQUE_EXTERNAL_IDS).toEqual([]);
  });

  it('cites no revoked technique', () => {
    const revoked = [...new Set(allEntries)].filter((externalId) => techniqueByExternalId.get(externalId)?.revoked === true);
    expect(revoked).toEqual([]);
  });

  // A `false` verdict on an unknown technique or an unjudged family would hold vacuously in the table.
  it('gives every review override a reason, a judged family and a live technique, and carries its verdict in the table', () => {
    const entriesOf = new Map<string, ReadonlyArray<string>>(Object.entries(APPLICABLE_TECHNIQUES));
    const judgedFamilies = new Set(APPLICABLE_TECHNIQUE_PROVENANCE.judgments.map((judgment) => judgment.family));
    for (const { family, technique, verdict, reason } of APPLICABLE_TECHNIQUE_PROVENANCE.overrides) {
      const at = `${family} ${technique}`;
      expect(reason.trim(), at).not.toBe('');
      expect(judgedFamilies.has(family), at).toBe(true);
      expect(techniqueByExternalId.get(technique)?.revoked, at).toBe(false);
      expect(entriesOf.get(family)?.includes(technique), at).toBe(verdict);
    }
  });

  it('maps every live technique to a family, preparation-only ones excepted', () => {
    const mapped = new Set(allEntries);
    const orphans = mitreTechniquesData
      .filter((technique) => !technique.revoked && !mapped.has(technique.externalId))
      .filter((technique) => technique.tacticIds.length === 0 || !technique.tacticIds.every((tacticId) => PREPARATION_TACTIC_IDS.has(tacticId)))
      .map((technique) => technique.externalId);
    expect(orphans).toEqual([]);
  });

  /*
   * What the sub-technique grain buys, measured without a control in sight: a branch whose sub-cases
   * disagree on families would, at parent grain, hand every sub-case the union of the branch. The
   * attack walk would then land a step on a family that sub-case cannot run on.
   */
  it('carries sub-cases whose families differ from their branch', () => {
    const familiesOf = new Map<string, Set<AssetCategory>>();
    for (const category of ASSET_CATEGORY_VALUES) {
      for (const externalId of APPLICABLE_TECHNIQUES[category]) {
        const families = familiesOf.get(externalId) ?? new Set<AssetCategory>();
        families.add(category);
        familiesOf.set(externalId, families);
      }
    }
    const branchUnion = new Map<string, Set<AssetCategory>>();
    for (const [externalId, families] of familiesOf) {
      const branchId = externalId.split('.')[0];
      const union = branchUnion.get(branchId) ?? new Set<AssetCategory>();
      for (const family of families) {
        union.add(family);
      }
      branchUnion.set(branchId, union);
    }
    const divergent = [...familiesOf].filter(([externalId, families]) => (
      externalId.includes('.') && [...branchUnion.get(externalId.split('.')[0])!].some((family) => !families.has(family))
    ));
    expect(divergent.length).toBeGreaterThan(200);
  });
});
