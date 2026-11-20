import { describe, expect, it } from 'vitest';
import { filterDashboards, resolveDashboardId, resolveHomeDashboards } from './dashboard-catalogue-utils';

type Id = 'risk' | 'risk-sankey' | 'findings-assets';
const isId = (value: string): value is Id => ['risk', 'risk-sankey', 'findings-assets'].includes(value);

describe('resolveDashboardId', () => {
  it('should take the first registered level', () => {
    expect(resolveDashboardId(['risk-sankey', 'findings-assets'], isId, 'risk')).toBe('risk-sankey');
  });

  it('should skip a level that is unset or no longer registered', () => {
    expect(resolveDashboardId([null, 'removed-dashboard', undefined, 'findings-assets'], isId, 'risk')).toBe('findings-assets');
  });

  it('should fall back when no level is registered', () => {
    expect(resolveDashboardId([null, 'removed-dashboard'], isId, 'risk')).toBe('risk');
  });
});

describe('resolveHomeDashboards', () => {
  it('should open the user\'s choice over the tenant default', () => {
    expect(resolveHomeDashboards({ user: 'findings-assets', tenant: 'risk-sankey' }, isId, 'risk'))
      .toEqual({ tenantHomeId: 'risk-sankey', userHomeId: 'findings-assets', userChoiceId: 'findings-assets' });
  });

  it('should open the tenant default for a user without a choice', () => {
    expect(resolveHomeDashboards({ user: null, tenant: 'risk-sankey' }, isId, 'risk'))
      .toEqual({ tenantHomeId: 'risk-sankey', userHomeId: 'risk-sankey', userChoiceId: null });
  });

  it('should open the fallback when neither level is set', () => {
    expect(resolveHomeDashboards({ user: undefined, tenant: null }, isId, 'risk'))
      .toEqual({ tenantHomeId: 'risk', userHomeId: 'risk', userChoiceId: null });
  });

  it('should fall back to the tenant default when the user\'s choice is no longer registered', () => {
    expect(resolveHomeDashboards({ user: 'removed-dashboard', tenant: 'risk-sankey' }, isId, 'risk'))
      .toEqual({ tenantHomeId: 'risk-sankey', userHomeId: 'risk-sankey', userChoiceId: null });
  });

  it('should fall back past a tenant default that is no longer registered', () => {
    expect(resolveHomeDashboards({ user: null, tenant: 'removed-dashboard' }, isId, 'risk'))
      .toEqual({ tenantHomeId: 'risk', userHomeId: 'risk', userChoiceId: null });
  });
});

describe('filterDashboards', () => {
  const rows = [
    { name: 'CISO', description: 'Aggregate risk and recommendations' },
    { name: 'Findings & Assets', description: 'Findings backlog and triage' },
  ];

  it('should keep every row for a blank search', () => {
    expect(filterDashboards(rows, '  ')).toEqual(rows);
  });

  it('should match the name or the description, ignoring case', () => {
    expect(filterDashboards(rows, 'ciso').map((row) => row.name)).toEqual(['CISO']);
    expect(filterDashboards(rows, 'TRIAGE').map((row) => row.name)).toEqual(['Findings & Assets']);
  });
});

describe('filterDashboards accents', () => {
  const rows = [
    { name: 'École Straße', description: 'Données' },
    { name: 'ecole plain', description: 'plain' },
  ];

  it('should find an accented name or description from its plain spelling, and the reverse', () => {
    expect(filterDashboards(rows, 'strasse').map((row) => row.name)).toEqual(['École Straße']);
    expect(filterDashboards(rows, 'donnees').map((row) => row.name)).toEqual(['École Straße']);
    expect(filterDashboards(rows, 'éco').map((row) => row.name)).toEqual(['École Straße', 'ecole plain']);
  });
});
