import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NavEntry, NavGroup, NavNode, NavSeparator, NavSingle } from './nav-model';
import { filterVisibleEntries, getPlatformNavigationNodes, getScopeNavigationNodes } from './nav-model';

const entry = (id: string, visible?: boolean): NavEntry => ({
  id,
  label: id,
  link: { to: `/${id}` },
  visible,
});

const single = (id: string, visible?: boolean): NavSingle => ({
  ...entry(id, visible),
  kind: 'single',
  icon: 'server',
});

const group = (id: string, entries: Array<NavEntry>, visible?: boolean): NavGroup => ({
  kind: 'group',
  id,
  label: id,
  icon: 'settings',
  entries,
  visible,
});

const separator = (id: string): NavSeparator => ({ kind: 'separator', id });

const ids = (nodes: Array<NavNode>) => nodes.map((node) => node.id);

const linkTarget = (navEntry: NavEntry) => String(navEntry.link.to);

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('filterVisibleEntries', () => {
  it('keeps nodes with no explicit visibility', () => {
    const nodes = [single('dashboard'), separator('sep'), group('assets', [entry('findings')])];

    expect(ids(filterVisibleEntries(nodes))).toEqual(['dashboard', 'sep', 'assets']);
  });

  it('drops single entries flagged as not visible', () => {
    const nodes = [single('dashboard', false), single('controls', true)];

    expect(ids(filterVisibleEntries(nodes))).toEqual(['controls']);
  });

  it('drops a whole group flagged as not visible', () => {
    const nodes = [group('integrations', [entry('connectors')], false), single('controls')];

    expect(ids(filterVisibleEntries(nodes))).toEqual(['controls']);
  });

  it('drops sub-entries flagged as not visible and keeps the group', () => {
    const nodes = [group('settings', [entry('security', false), entry('engine')])];
    const [filtered] = filterVisibleEntries(nodes);
    const keptEntries = filtered.kind === 'group' ? filtered.entries : [];

    expect(filtered.kind).toBe('group');
    expect(keptEntries.map((subEntry) => subEntry.id)).toEqual(['engine']);
  });

  it('degrades a group whose sub-entries are all filtered out', () => {
    const nodes = [group('settings', [entry('security', false)]), single('controls')];

    expect(ids(filterVisibleEntries(nodes))).toEqual(['controls']);
  });

  it('drops a group that declares no sub-entry at all', () => {
    expect(filterVisibleEntries([group('empty', [])])).toEqual([]);
  });

  it('does not mutate the input nodes', () => {
    const nodes = [group('settings', [entry('security', false), entry('engine')])];

    filterVisibleEntries(nodes);

    expect(nodes[0].entries).toHaveLength(2);
  });
});

describe('getScopeNavigationNodes', () => {
  const scopes = [{ id: 'europe', name: 'Acme Bank Europe' }, { id: 'retail', name: 'Acme Retail Network' }];
  interface NodesOptions {
    organizationId?: string,
    hasManageSecurity?: boolean,
    hasPlatformAccess?: boolean,
  }
  const nodes = (options: NodesOptions = {}) => filterVisibleEntries(getScopeNavigationNodes({
    tenantId: 'acme',
    hasManageSecurity: options.hasManageSecurity ?? true,
    hasPlatformAccess: options.hasPlatformAccess ?? false,
    organizationId: options.organizationId,
    scopes,
  }));
  const tenantEntries = (options: NodesOptions = {}) => nodes(options).flatMap((node): Array<NavEntry> => {
    if (node.kind === 'group') {
      return node.entries;
    }
    return node.kind === 'single' ? [node] : [];
  });
  const linkParams = (node: NavNode | NavEntry | undefined) => (node && 'link' in node ? node.link.params : undefined);
  const groupEntries = (id: string, options: NodesOptions = {}) => {
    const node = nodes(options).find((candidate) => candidate.id === id);
    return node?.kind === 'group' ? node.entries.map((subEntry) => subEntry.id) : [];
  };

  it('lays the tenant entries, the risk scopes and the three sections out in order, each set apart by a separator alone', () => {
    expect(ids(nodes())).toEqual([
      'home', 'dashboards', 'risk-scenarios', 'treatment-plans', 'budget-reviews',
      'separator-risk-scopes', 'scope-europe', 'scope-retail', 'organizations',
      'separator-attack-surface', 'assets', 'findings', 'threats',
      'separator-defenses', 'controls', 'compliance',
      'separator-administration', 'integrations', 'settings',
    ]);
  });

  // One concept, one glyph, in every Filigran product's left navigation (the shared table of XTM-Foundation/filigran-design-system#418).
  it('draws every row with the design system glyph of its concept, Home with the outlined house', () => {
    const icons = Object.fromEntries(nodes().flatMap((node) => (node.kind === 'single' || node.kind === 'group' ? [[node.id, node.icon]] : [])));

    expect(icons).toEqual({
      home: 'house',
      dashboards: 'layout-dashboard',
      'risk-scenarios': 'route',
      'treatment-plans': 'list-checks',
      'budget-reviews': 'scale',
      organizations: 'building-2',
      assets: 'server',
      findings: 'custom/binocular',
      threats: 'custom/threat-actor-individual',
      controls: 'shield-check',
      compliance: 'clipboard-check',
      integrations: 'puzzle',
      settings: 'settings',
    });
  });

  it('points every tenant entry out of any scope, whichever scope the page is in', () => {
    const entries = tenantEntries({ organizationId: 'retail' });

    expect(entries.map(linkParams)).toEqual(entries.map(() => ({ tenantId: 'acme', organizationId: undefined })));
  });

  it('gives each scope the same ten entries, its dashboards right after its overview, pointing into that scope', () => {
    const retail = nodes().find((node) => node.id === 'scope-retail');
    const entries = retail?.kind === 'scope' ? retail.entries : [];

    expect(entries.map((scopeEntry) => scopeEntry.id)).toEqual(['overview', 'dashboards', 'risk-scenarios', 'treatment-plans', 'budget-reviews', 'primary-assets', 'requirements', 'assets', 'findings', 'threat-event-frequency', 'controls', 'details']);
    expect(entries.map(linkParams)).toEqual(entries.map(() => ({ tenantId: 'acme', organizationId: 'retail' })));
  });

  it('labels each scope with its name and initials', () => {
    const europe = nodes().find((node) => node.id === 'scope-europe');

    expect(europe?.kind === 'scope' ? [europe.label, europe.initials] : []).toEqual(['Acme Bank Europe', 'AE']);
  });

  it('marks as current only the scope the page belongs to', () => {
    const current = (organizationId?: string) => nodes({ organizationId })
      .filter((node) => node.kind === 'scope' && node.current)
      .map((node) => node.id);

    expect(current('retail')).toEqual(['scope-retail']);
    expect(current(undefined)).toEqual([]);
  });

  it('keeps the Administration section when Integrations is hidden', () => {
    expect(ids(nodes({ hasManageSecurity: false })).slice(-2)).toEqual(['separator-administration', 'settings']);
  });

  it('groups Threats and Threat Event Frequency under Threats', () => {
    expect(groupEntries('threats')).toEqual(['threat-center', 'threat-event-frequency']);
  });

  // Links light by prefix, so an entry under another's path would light both, Threats on the frequency page included.
  it('puts no entry under the path of another entry that lights by prefix', () => {
    const entries = tenantEntries({ hasPlatformAccess: true });

    for (const navEntry of entries) {
      expect(entries.filter((other) => other.exact !== true && linkTarget(other) !== linkTarget(navEntry) && linkTarget(navEntry).startsWith(`${linkTarget(other)}/`))).toEqual([]);
    }
  });

  it('makes Compliance a single entry lighting on all of Compliance', () => {
    const compliance = nodes().find((node) => node.id === 'compliance');

    expect(compliance?.kind === 'single' ? [compliance.label, linkTarget(compliance), compliance.exact] : []).toEqual(['Compliance', '/$tenantId/{-$organizationId}/compliance', undefined]);
  });

  it('offers Settings > Security and Jobs to a platform administrator with no tenant manage-security capability', () => {
    expect(groupEntries('settings', { hasManageSecurity: false, hasPlatformAccess: true })).toEqual(expect.arrayContaining(['settings-security', 'settings-jobs']));
  });

  // The Jobs landing redirects to its Runs tab; pointing at the landing lets the entry match every tab.
  it('points Settings > Jobs at the jobs landing so it lights and opens Settings on every tab', () => {
    const settings = nodes({ hasPlatformAccess: true }).find((node) => node.id === 'settings');
    const jobs = settings?.kind === 'group' ? settings.entries.find((subEntry) => subEntry.id === 'settings-jobs') : undefined;

    expect(jobs ? [linkTarget(jobs), jobs.exact] : []).toEqual(['/$tenantId/{-$organizationId}/settings/jobs', undefined]);
  });

  it('hides Settings > Security, Engine and Jobs from a reader with neither capability', () => {
    expect(groupEntries('settings', { hasManageSecurity: false })).toEqual(['settings-parameters', 'settings-file-storage', 'settings-taxonomies']);
  });

  it('does not offer Settings > Engine to a platform administrator with no tenant manage-security capability', () => {
    expect(groupEntries('settings', { hasManageSecurity: false, hasPlatformAccess: true })).not.toContain('settings-engine');
  });

  it('offers Settings > Engine to a tenant security manager', () => {
    expect(groupEntries('settings', { hasManageSecurity: true })).toContain('settings-engine');
  });

  describe('Get started', () => {
    const withGetStarted = (getStarted?: { completed: number, total: number, finished: boolean }) => getScopeNavigationNodes({
      tenantId: 'acme',
      hasManageSecurity: true,
      hasPlatformAccess: false,
      organizationId: undefined,
      scopes,
      getStarted,
    });

    it('comes first in the menu while the wizard is unfinished', () => {
      expect(ids(withGetStarted({ completed: 1, total: 8, finished: false })).slice(0, 2)).toEqual(['get-started', 'home']);
    });

    it('comes last in the menu once the wizard is finished, with no counter and no bar', () => {
      const menu = withGetStarted({ completed: 8, total: 8, finished: true });
      const last = menu.at(-1);

      expect(ids(menu)[0]).toBe('home');
      expect(last?.id).toBe('get-started');
      expect(last?.kind === 'single' ? last.label : undefined).toBe('Get started');
      expect(last?.kind === 'single' ? last.progress : 'missing').toBeUndefined();
    });

    it('moves last on the backend verdict even when a started step keeps the count under the total', () => {
      const menu = withGetStarted({ completed: 6, total: 8, finished: true });

      expect(ids(menu)[0]).toBe('home');
      expect(menu.at(-1)?.id).toBe('get-started');
    });

    it('stays first with a full count while the backend does not say finished', () => {
      expect(ids(withGetStarted({ completed: 8, total: 8, finished: false }))[0]).toBe('get-started');
    });

    it('is absent when no wizard progress is given', () => {
      expect(ids(withGetStarted())).not.toContain('get-started');
    });

    it('carries the progress as a percentage and its "n of 8" label', () => {
      const node = withGetStarted({ completed: 2, total: 8, finished: false }).find((candidate) => candidate.id === 'get-started');

      expect(node?.kind === 'single' ? node.progress : undefined).toEqual({ value: 25, label: '2 of 8' });
    });

    it('shows an empty, unfinished bar for a wizard with no step', () => {
      const menu = withGetStarted({ completed: 0, total: 0, finished: false });
      const node = menu.find((candidate) => candidate.id === 'get-started');

      expect(ids(menu)[0]).toBe('get-started');
      expect(node?.kind === 'single' ? node.progress : undefined).toEqual({ value: 0, label: '0 of 0' });
    });
  });
});

describe('getPlatformNavigationNodes', () => {
  const settingsEntries = () => {
    const settings = getPlatformNavigationNodes().find((node) => node.id === 'settings');
    return settings?.kind === 'group' ? settings.entries : [];
  };

  it('lays out the Settings group alone, with no section title', () => {
    expect(ids(getPlatformNavigationNodes())).toEqual(['settings']);
  });

  it('holds Security alone in Settings, pointing at the platform surface', () => {
    expect(settingsEntries().map((settingsEntry) => settingsEntry.id)).toEqual(['settings-security']);
    expect(settingsEntries().map(linkTarget)).toEqual(['/platform/security']);
  });
});
