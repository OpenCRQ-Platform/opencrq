import { describe, expect, it } from 'vitest';
import type { CweLinkOverride, ShippedLinkRow } from './effective-link';
import { isEffectiveEntry, resolveEffectiveLink } from './effective-link';

const shipped = (techniqueId: string, ref = 'CAPEC-1'): ShippedLinkRow => ({
  cweId: 'cwe-287',
  techniqueId,
  justificationKind: 'attack_pattern',
  justificationRef: ref,
  justificationName: 'Pattern',
});

const override = (techniqueId: string, kind: CweLinkOverride['kind']): CweLinkOverride => ({ cweId: 'cwe-287', techniqueId, kind });

const effective = (rows: ReadonlyArray<ShippedLinkRow>, overrides: ReadonlyArray<CweLinkOverride>): Array<string> =>
  resolveEffectiveLink(rows, overrides).filter(isEffectiveEntry).map((entry) => entry.techniqueId).sort();

describe('resolveEffectiveLink', () => {
  it('is the shipped link when the tenant changed nothing', () => {
    expect(effective([shipped('t1040'), shipped('t1059')], [])).toEqual(['t1040', 't1059']);
  });

  it('takes out a removed technique but keeps it listed, flagged, so it can be restored', () => {
    const entries = resolveEffectiveLink([shipped('t1040'), shipped('t1059')], [override('t1040', 'removed')]);

    expect(entries.filter(isEffectiveEntry).map((entry) => entry.techniqueId)).toEqual(['t1059']);
    expect(entries.find((entry) => entry.techniqueId === 't1040')?.state).toBe('removed');
  });

  it('adds a technique the tenant added, with no justification of its own', () => {
    const entries = resolveEffectiveLink([shipped('t1059')], [override('t1110', 'added')]);

    expect(entries.find((entry) => entry.techniqueId === 't1110')).toEqual({ cweId: 'cwe-287', techniqueId: 't1110', state: 'added', justifications: [] });
  });

  it('keeps an addition through a shipped version that does not carry it', () => {
    expect(effective([shipped('t1005')], [override('t1110', 'added')])).toEqual(['t1005', 't1110']);
  });

  it('follows a new shipped version on a technique the tenant never touched', () => {
    const overrides = [override('t1040', 'removed')];

    expect(effective([shipped('t1040'), shipped('t1059')], overrides)).toEqual(['t1059']);
    expect(effective([shipped('t1040'), shipped('t1005')], overrides)).toEqual(['t1005']);
  });

  it('reports an addition the shipped link now carries once, as shipped', () => {
    const entries = resolveEffectiveLink([shipped('t1110')], [override('t1110', 'added')]);

    expect(entries.map((entry) => `${entry.techniqueId} ${entry.state}`)).toEqual(['t1110 shipped']);
  });

  it('forgets a removal of a technique the shipped link no longer carries', () => {
    expect(resolveEffectiveLink([shipped('t1059')], [override('t1040', 'removed')]).map((entry) => entry.techniqueId)).toEqual(['t1059']);
  });

  it('gathers every reason a technique is shipped under one entry', () => {
    const [entry] = resolveEffectiveLink([shipped('t1548', 'CAPEC-114'), shipped('t1548', 'CAPEC-115')], []);

    expect(entry?.justifications.map((justification) => justification.ref)).toEqual(['CAPEC-114', 'CAPEC-115']);
  });
});
