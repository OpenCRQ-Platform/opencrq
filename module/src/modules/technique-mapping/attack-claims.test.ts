import { describe, expect, it } from 'vitest';
import type { CatalogueTechnique, StoredTechniqueClaim } from './attack-claims';
import { impactTechniquesOf, readAttackClaims, techniqueExternalIdsInReach, techniquesInReachOf } from './attack-claims';
import { TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS } from './topology-rule';

const NETWORK_NO_USER = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

const RULE_CATALOGUE = new Map<string, CatalogueTechnique>(TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS.map((externalId) => [
  externalId,
  { id: `id-${externalId}`, externalId, name: `name ${externalId}`, isSubtechnique: externalId.includes('.') },
]));

const stored = (externalId: string, over: Partial<StoredTechniqueClaim> = {}): StoredTechniqueClaim => ({
  mitreTechniqueId: `id-${externalId}`,
  techniqueExternalId: externalId,
  techniqueName: `name ${externalId}`,
  role: 'exploitation_technique',
  lane: 'curated',
  grain: 'parent',
  ...over,
});

const claimsOf = (claims: Array<StoredTechniqueClaim>, exposure: 'internet_facing' | 'internal' | 'unknown' = 'internal', cwe: Array<string> | null = null) =>
  readAttackClaims({ stored: claims, cwe, cvssVector: NETWORK_NO_USER, cvssV2UserInteractionRequired: null, exposure, ruleCatalogue: RULE_CATALOGUE });

describe('readAttackClaims', () => {
  it('takes the curated exploitation technique over the rule', () => {
    const claims = claimsOf([stored('T1133')]);
    expect(claims.filter((claim) => claim.group === 'exploitation').map((claim) => claim.techniqueExternalId)).toEqual(['T1133']);
  });

  it('answers the exploitation from the rule when no claim names it', () => {
    const claims = claimsOf([stored('T1486', { role: 'primary_impact' })]);
    expect(claims.filter((claim) => claim.group === 'exploitation'))
      .toEqual([expect.objectContaining({ techniqueExternalId: 'T1210', lane: 'topology', justification: expect.objectContaining({ kind: 'topology' }) })]);
  });

  it('keeps the rule when the only exploitation rows come from the weakness', () => {
    const claims = claimsOf([stored('T1505.003', { lane: 'structural' })], 'internet_facing');
    expect(claims.map((claim) => [claim.techniqueExternalId, claim.group])).toEqual([['T1190', 'exploitation'], ['T1505.003', 'weakness']]);
  });

  it('files the impacts under their own groups, in the order an attack runs', () => {
    const claims = claimsOf([
      stored('T1555', { role: 'secondary_impact' }),
      stored('T1078', { role: 'primary_impact' }),
      stored('T1190'),
    ]);
    expect(claims.map((claim) => claim.group)).toEqual(['exploitation', 'primary_impact', 'secondary_impact']);
  });

  it('justifies a weakness row by the CVE weakness classes whose link names it', () => {
    const [claim] = claimsOf([stored('T1550.001', { lane: 'structural', weaknesses: ['CWE-287'] })], 'internal', ['CWE-79', 'CWE-287']).filter((row) => row.group === 'weakness');
    expect(claim.justification).toEqual({ kind: 'weakness', cwe: ['CWE-287'] });
  });

  it('drops a rule technique the catalogue does not carry', () => {
    const claims = readAttackClaims({ stored: [], cwe: null, cvssVector: NETWORK_NO_USER, cvssV2UserInteractionRequired: null, exposure: 'internal', ruleCatalogue: new Map() });
    expect(claims).toEqual([]);
  });
});

describe('techniquesInReachOf', () => {
  it('stands the exploitation group alone in reach, never the impacts nor the weakness', () => {
    const inReach = techniquesInReachOf(claimsOf([
      stored('T1190'),
      stored('T1486', { role: 'primary_impact' }),
      stored('T1040', { lane: 'structural' }),
    ]));
    expect([...inReach]).toEqual([['id-T1190', 'high']]);
  });

  it('weighs a rule technique as a deduction', () => {
    expect([...techniquesInReachOf(claimsOf([]))]).toEqual([['id-T1210', 'medium']]);
  });
});

describe('impactTechniquesOf', () => {
  it('takes both impact groups and the weakness group, never the exploitation', () => {
    const impacts = impactTechniquesOf(claimsOf([
      stored('T1190'),
      stored('T1486', { role: 'primary_impact' }),
      stored('T1555', { role: 'secondary_impact' }),
      stored('T1040', { lane: 'structural' }),
    ]));
    expect(new Map(impacts)).toEqual(new Map([['id-T1486', 'high'], ['id-T1555', 'high'], ['id-T1040', 'medium']]));
  });

  it('keeps the strongest claim of a technique named twice', () => {
    const impacts = impactTechniquesOf(claimsOf([
      stored('T1059', { lane: 'structural' }),
      stored('T1059', { role: 'primary_impact' }),
    ]));
    expect(impacts.get('id-T1059')).toBe('high');
  });
});

describe('techniqueExternalIdsInReach', () => {
  it('agrees with the claims read', () => {
    const rows = [stored('T1040', { lane: 'structural' })];
    const byClaims = claimsOf(rows, 'unknown')
      .filter((claim) => claim.group === 'exploitation' || claim.group === 'weakness')
      .map((claim) => claim.techniqueExternalId);
    expect(techniqueExternalIdsInReach({ stored: rows, cwe: null, cvssVector: NETWORK_NO_USER, cvssV2UserInteractionRequired: null, exposure: 'unknown' }))
      .toEqual(byClaims);
  });
});
