import { describe, expect, it } from 'vitest';
import type { AssetCategory } from '../../supporting-assets/constants';
import { mitreTechniquesData, TACTIC_TA0112 } from '../../mitre-attack/data';
import { APPLICABLE_TECHNIQUES } from '../../attack-surfaces/data/applicable-techniques-data';
import { controlCapabilitiesData } from '../../controls/capability/data/capabilities.generated';
import { CONTROL_FAMILY_PROTECTION } from '../../controls/capability/data/control-family-protection';
import { ASSET_CATEGORY_VALUES } from '../../supporting-assets/constants';
import {
  capabilitiesTakenDownBy,
  IMPAIRMENT_RELATION,
  IMPAIRMENT_RELATION_PROVENANCE,
  UNRESOLVED_IMPAIRMENT_CAPABILITY_EXTERNAL_IDS,
} from './impairment-relation';

/** Pinned as literals so that re-authoring against a new release shows up as a reviewed diff. */
const TECHNIQUE_COUNT = 57;
const PAIR_COUNT = 84;
const TAKES_NOTHING_DOWN = ['T1556.002', 'T1556.008', 'T1578.001', 'T1578.002', 'T1578.005', 'T1685.003'];

/**
 * Pinned rows, in both directions. A row the next authoring pass drops removes a whole sabotage
 * channel silently, and a row it widens reinstates the flat depth the relation replaced, so
 * neither failure surfaces anywhere else. A divergent verdict is an arbitration to re-open, never
 * a pin to widen.
 */
const REQUIRED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['T1685.005', 'SIEM'],
  ['T1686.003', 'NGFW'],
  ['T1556.006', 'IDP'],
  ['T1685', 'FIM'],
  ['T1601', 'NDH'],
  ['T1484', 'ADH'],
  ['T1578', 'CWPP'],
];

const FORBIDDEN_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // The log pipeline dies at its source and takes nothing else with it: the whole point of the relation.
  ['T1685.005', 'IDP'],
  // Escape is not a take-down: a fresh instance leaves every control on the source asset working.
  ['T1578.002', 'EDR'],
  // A knockout lifts everything the capability bundles: a stopped audit trail leaves the security groups and the sharing settings enforcing.
  ['T1685.002', 'CLDH'],
  ['T1685.002', 'SAASH'],
  // An account severed from its organization's ceiling keeps its own security groups and bucket policies.
  ['T1666', 'CLDH'],
  // The team loses what the stopped agents fed it, which knocking those agents already carries.
  ['T1685', 'SOC'],
  // The device baseline guards the image and the management plane; ciphers are TLS's to lose.
  ['T1600', 'NDH'],
  // The posture tool reports a mutated instance rather than going blind.
  ['T1578', 'CNAPP'],
  // Reversible storage is a directory setting, not encryption at rest.
  ['T1556.005', 'KMS'],
];

const techniqueByExternalId = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique]));
const allPairs = IMPAIRMENT_RELATION.flatMap((entry) => entry.takesDown);

describe('IMPAIRMENT_RELATION', () => {
  it('carries its authoring provenance as data values', () => {
    expect(IMPAIRMENT_RELATION_PROVENANCE.knowledgeBaseRelease).toBe('20.0');
    expect(IMPAIRMENT_RELATION_PROVENANCE.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(IMPAIRMENT_RELATION_PROVENANCE.judgments.length).toBeGreaterThan(0);
    for (const judgment of IMPAIRMENT_RELATION_PROVENANCE.judgments) {
      expect(judgment.scope.length).toBeGreaterThan(0);
      expect(judgment.promptVersion.length).toBeGreaterThan(0);
      expect(judgment.model.length).toBeGreaterThan(0);
    }
  });

  it('holds the expected number of techniques and pairs, with no duplicate inside a row', () => {
    expect(IMPAIRMENT_RELATION).toHaveLength(TECHNIQUE_COUNT);
    expect(allPairs).toHaveLength(PAIR_COUNT);
    for (const entry of IMPAIRMENT_RELATION) {
      expect(new Set(entry.takesDown).size, entry.techniqueExternalId).toBe(entry.takesDown.length);
    }
  });

  it('names each technique once', () => {
    const externalIds = IMPAIRMENT_RELATION.map((entry) => entry.techniqueExternalId);
    expect(new Set(externalIds).size).toBe(externalIds.length);
  });

  it('gives every row the reason it names those capabilities', () => {
    for (const entry of IMPAIRMENT_RELATION) {
      expect(entry.why.length, entry.techniqueExternalId).toBeGreaterThan(20);
    }
  });

  it('holds every arbitrated pair and none of the arbitrated-out ones', () => {
    for (const [techniqueExternalId, capability] of REQUIRED_PAIRS) {
      expect(capabilitiesTakenDownBy(techniqueExternalId)).toContain(capability);
    }
    for (const [techniqueExternalId, capability] of FORBIDDEN_PAIRS) {
      expect(capabilitiesTakenDownBy(techniqueExternalId)).not.toContain(capability);
    }
  });
});

describe('IMPAIRMENT_RELATION against the vendored ATT&CK release', () => {
  it('resolves every technique identifier, and every one carries Defense Impairment', () => {
    for (const entry of IMPAIRMENT_RELATION) {
      const technique = techniqueByExternalId.get(entry.techniqueExternalId);
      expect(technique, entry.techniqueExternalId).toBeDefined();
      expect(technique?.revoked, entry.techniqueExternalId).toBe(false);
      expect(technique?.tacticIds, entry.techniqueExternalId).toContain(TACTIC_TA0112);
    }
  });

  it('names each technique the way the release names it', () => {
    for (const entry of IMPAIRMENT_RELATION) {
      expect(techniqueByExternalId.get(entry.techniqueExternalId)?.name, entry.techniqueExternalId).toBe(entry.name);
    }
  });

  /*
   * The converse of the resolution test, and what makes an empty row mean something. A live
   * Defense Impairment technique the relation never mentions is indistinguishable, at the call
   * site, from one judged to take nothing down: both answer with an empty capability list. Only
   * this assertion separates "judged" from "forgotten".
   */
  it('declares every live Defense Impairment technique of the release', () => {
    const declared = new Set(IMPAIRMENT_RELATION.map((entry) => entry.techniqueExternalId));
    const missing = mitreTechniquesData
      .filter((technique) => !technique.revoked && technique.tacticIds.includes(TACTIC_TA0112))
      .filter((technique) => !declared.has(technique.externalId))
      .map((technique) => technique.externalId);
    expect(missing).toEqual([]);
  });

  it('declares the techniques that take nothing down rather than omitting them', () => {
    const empty = IMPAIRMENT_RELATION.filter((entry) => entry.takesDown.length === 0).map((entry) => entry.techniqueExternalId);
    expect(empty.toSorted()).toEqual([...TAKES_NOTHING_DOWN].toSorted());
  });
});

describe('IMPAIRMENT_RELATION against the capability catalogue', () => {
  /*
   * Zero tolerance. A row naming a capability the catalogue does not carry knocks nothing out, so
   * the sabotage it represents disappears from the law with no error anywhere.
   */
  it('resolves every cited capability', () => {
    expect(
      UNRESOLVED_IMPAIRMENT_CAPABILITY_EXTERNAL_IDS,
      'Unknown capability external ids in the impairment relation. Two ways out: re-author the relation against the current catalogue, or update the catalogue to carry these capabilities.',
    ).toEqual([]);
  });

  /*
   * A capability protecting no family the technique lands on would be knocked out for assets it does
   * not guard. Read from the catalogue's scoping, so a sensor running on a host its capability is not
   * scoped to, an identity threat detection sensor on a domain controller, is not one it sees.
   */
  it('names only capabilities that protect a family the technique lands on', () => {
    const applicable: Record<AssetCategory, ReadonlyArray<string>> = APPLICABLE_TECHNIQUES;
    const protection = CONTROL_FAMILY_PROTECTION as Readonly<Record<string, ReadonlyArray<AssetCategory>>>;
    const strays = IMPAIRMENT_RELATION.flatMap((entry) => {
      const landsOn = ASSET_CATEGORY_VALUES.filter((family) => applicable[family].includes(entry.techniqueExternalId));
      return entry.takesDown
        .filter((capability) => !(protection[capability] ?? []).some((family) => landsOn.includes(family)))
        .map((capability) => `${entry.techniqueExternalId} ${capability}`);
    });
    expect(strays).toEqual([]);
  });

  it('leaves most of the catalogue untouchable, which is what the relation exists to say', () => {
    const named = new Set(allPairs);
    expect(named.size).toBeLessThan(controlCapabilitiesData.length / 2);
  });
});

describe('capabilitiesTakenDownBy', () => {
  it('answers a technique outside the relation with nothing taken down', () => {
    expect(capabilitiesTakenDownBy('T1486')).toEqual([]);
  });
});
