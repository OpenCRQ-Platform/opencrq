import { describe, expect, it } from 'vitest';
import type { ListedCapability } from './types/capability';
import type { CapabilitiesDataFilters } from './capability-data-utils';
import { buildCapabilitiesView, resolveAssessmentFilter } from './capability-data-utils';

const make = (overrides: Partial<ListedCapability>): ListedCapability => ({
  id: 'id',
  externalId: 'CAP-000',
  name: 'Capability',
  description: '',
  domain: 'identities',
  position: 19,
  assessment: { strengthRung: 'L0', coverageBucket: 'L0', strengthMode: 'manual', coverageMode: 'manual', coverageBasis: 'declared', comment: null },
  lastAssessedAt: new Date('2026-01-01T00:00:00.000Z'),
  lastAssessedBy: { userId: 'user-1', name: 'Alice' },
  lastAssessedConnector: null,
  strengthSource: 'tenant',
  coverageSource: 'tenant',
  ...overrides,
});

const IDN_001 = make({ id: 'idn-001', externalId: 'CAP-IDN-001', name: 'Phishing-resistant MFA' });
const IDN_002 = make({ id: 'idn-002', externalId: 'CAP-IDN-002', name: 'Privileged access management' });
const NET_001 = make({
  id: 'net-001',
  externalId: 'CAP-NET-001',
  name: 'Network segmentation',
  assessment: null,
  lastAssessedAt: null,
  lastAssessedBy: null,
});

const NET_002 = make({ id: 'net-002', externalId: 'CAP-NET-002', name: 'Web application firewall', coverageSource: 'scope' });
const NET_003 = make({ id: 'net-003', externalId: 'CAP-NET-003', name: 'Email filtering', strengthSource: 'scope' });

const ALL: Array<ListedCapability> = [IDN_001, IDN_002, NET_001];

const NO_FILTER: CapabilitiesDataFilters = { search: '', assessment: 'all' };

describe('buildCapabilitiesView', () => {
  it('should return empty array when data is undefined', () => {
    const result = buildCapabilitiesView(undefined, NO_FILTER);
    expect(result.processedData).toEqual([]);
  });

  it('should return all items when no filter is applied', () => {
    const result = buildCapabilitiesView(ALL, NO_FILTER);
    expect(result.processedData).toHaveLength(ALL.length);
  });

  describe('assessment filter', () => {
    it('should keep only the controls nobody has ever declared', () => {
      const result = buildCapabilitiesView(ALL, { ...NO_FILTER, assessment: 'unassessed' });

      expect(result.processedData.map((c) => c.id)).toEqual(['net-001']);
    });

    it('should not treat a declaration at the floor rung as unassessed', () => {
      const result = buildCapabilitiesView([IDN_001], { ...NO_FILTER, assessment: 'unassessed' });

      expect(result.processedData).toHaveLength(0);
    });

    it('should keep exactly the rows carrying at least one declared axis', () => {
      const result = buildCapabilitiesView([...ALL, NET_002, NET_003], { ...NO_FILTER, assessment: 'forced' });

      expect(result.processedData.map((c) => c.id)).toEqual(['net-002', 'net-003']);
    });

    it('should combine as a plain AND with the search', () => {
      const result = buildCapabilitiesView(ALL, { ...NO_FILTER, assessment: 'unassessed', search: 'MFA' });

      expect(result.processedData).toHaveLength(0);
    });
  });

  describe('unassessed count', () => {
    it('should count the never-declared controls among the rows currently shown', () => {
      const result = buildCapabilitiesView(ALL, NO_FILTER);
      expect(result.unassessedCount).toBe(1);
    });

    it('should follow the rows the search leaves rather than the whole catalogue', () => {
      const result = buildCapabilitiesView(ALL, { ...NO_FILTER, search: 'MFA' });
      expect(result.unassessedCount).toBe(0);
    });

    it('should equal the row count once the unassessed filter is on', () => {
      const result = buildCapabilitiesView(ALL, { ...NO_FILTER, assessment: 'unassessed' });
      expect(result.unassessedCount).toBe(result.processedData.length);
    });
  });

  describe('search', () => {
    it('should filter by name', () => {
      const result = buildCapabilitiesView(ALL, { ...NO_FILTER, search: 'segmentation' });

      const ids = result.processedData.map((c) => c.id);
      expect(ids).toEqual(['net-001']);
    });

    it('should filter by externalId', () => {
      const result = buildCapabilitiesView(ALL, { ...NO_FILTER, search: 'CAP-IDN-002' });

      const ids = result.processedData.map((c) => c.id);
      expect(ids).toEqual(['idn-002']);
    });

    it('should ignore accents and ligatures in both directions', () => {
      const accented = make({ id: 'acc', externalId: 'CAP-ACC-001', name: 'École Straße' });
      const plain = make({ id: 'pl', externalId: 'CAP-PL-001', name: 'ecole plain' });
      const idsFor = (search: string) => buildCapabilitiesView([accented, plain], { ...NO_FILTER, search }).processedData.map((c) => c.id);

      expect(idsFor('ecole')).toEqual(['acc', 'pl']);
      expect(idsFor('strasse')).toEqual(['acc']);
      expect(idsFor('éco')).toEqual(['acc', 'pl']);
    });
  });
});

describe('resolveAssessmentFilter', () => {
  it('should keep the overridden filter inside a scope', () => {
    expect(resolveAssessmentFilter('forced', true)).toBe('forced');
  });

  it('should read the overridden filter as every control outside a scope', () => {
    expect(resolveAssessmentFilter('forced', false)).toBe('all');
  });

  it('should leave the other filters alone outside a scope', () => {
    expect(resolveAssessmentFilter('unassessed', false)).toBe('unassessed');
  });
});
