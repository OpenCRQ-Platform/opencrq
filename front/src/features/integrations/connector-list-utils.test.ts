import { describe, expect, it } from 'vitest';
import type { FacetableConnector } from './connector-list-utils';
import {
  countConnectorFacets,
  DOMAIN_ORDER,
  EMPTY_CONNECTOR_FILTERS,
  filterConnectors,
  groupConnectorsByDomain,
  offersConfigure,
  scopeFiltersToTab,
  sortConnectors,
} from './connector-list-utils';

const connector = (overrides: Partial<FacetableConnector> & Pick<FacetableConnector, 'name'>): FacetableConnector => ({
  shortDescription: '',
  domain: 'vulnerability',
  scopeKinds: ['cves'],
  state: 'healthy',
  ...overrides,
});

const nist = connector({ name: 'NIST NVD CVE', shortDescription: 'Severity and references for every published CVE.' });
const cisa = connector({ name: 'CISA KEV', shortDescription: 'Vulnerabilities confirmed as actively exploited.', state: 'never_synced' });
const defender = connector({
  name: 'Microsoft Defender',
  shortDescription: 'Device inventory from your managed endpoints.',
  scopeKinds: ['supporting_assets', 'findings'],
  state: 'failing',
});
const drata = connector({
  name: 'Drata',
  shortDescription: 'Your compliance posture.',
  domain: 'compliance',
  scopeKinds: ['capability_assessments'],
  state: 'failing',
});
const openaev = connector({
  name: 'OpenAEV',
  shortDescription: 'Simulation results per MITRE technique.',
  domain: 'simulation',
  scopeKinds: ['findings'],
  state: 'syncing',
});

const all = [nist, cisa, defender, drata, openaev];

describe('scopeFiltersToTab', () => {
  const filters = { ...EMPTY_CONNECTOR_FILTERS, domains: ['compliance'], states: ['failing'] } as const;

  it('keeps a state selection on the Deployed tab, which shows the status facet', () => {
    expect(scopeFiltersToTab(filters, 'deployed')).toEqual(filters);
  });

  it('drops a state selection on the Available tab, which has no control to clear it', () => {
    expect(scopeFiltersToTab(filters, 'available')).toEqual({ ...filters, states: [] });
  });
});

describe('offersConfigure', () => {
  it('offers configure on a connector the tenant has not bound yet, to a member who can manage security', () => {
    expect(offersConfigure('not_configured', true)).toBe(true);
  });

  it('withholds it from a member who cannot manage security', () => {
    expect(offersConfigure('not_configured', false)).toBe(false);
  });

  it('withholds it from a connector already bound, reconfiguring being the detail page\'s', () => {
    expect(offersConfigure('healthy', true)).toBe(false);
  });
});

describe('filterConnectors', () => {
  it('returns everything when no filter is active', () => {
    expect(filterConnectors(all, EMPTY_CONNECTOR_FILTERS)).toHaveLength(5);
  });

  it('matches the search against the name, case and padding aside', () => {
    expect(filterConnectors(all, { ...EMPTY_CONNECTOR_FILTERS, search: '  dRaTa ' })).toEqual([drata]);
  });

  it('matches the search against the description too, which is what makes it worth typing', () => {
    expect(filterConnectors(all, { ...EMPTY_CONNECTOR_FILTERS, search: 'endpoints' })).toEqual([defender]);
  });

  it('returns nothing when the search matches nothing', () => {
    expect(filterConnectors(all, { ...EMPTY_CONNECTOR_FILTERS, search: 'kubernetes' })).toEqual([]);
  });

  it('keeps a connector whose domain is among those selected', () => {
    expect(filterConnectors(all, { ...EMPTY_CONNECTOR_FILTERS, domains: ['compliance', 'simulation'] }))
      .toEqual([drata, openaev]);
  });

  it('keeps a connector writing any one of the selected scope kinds, not all of them', () => {
    expect(filterConnectors(all, { ...EMPTY_CONNECTOR_FILTERS, scopeKinds: ['findings'] }))
      .toEqual([defender, openaev]);
  });

  it('keeps a connector holding one of the selected states', () => {
    expect(filterConnectors(all, { ...EMPTY_CONNECTOR_FILTERS, states: ['failing'] })).toEqual([defender, drata]);
  });

  it('intersects the groups: a connector must satisfy every active group', () => {
    expect(filterConnectors(all, { ...EMPTY_CONNECTOR_FILTERS, domains: ['vulnerability'], states: ['failing'] }))
      .toEqual([defender]);
  });
});

describe('countConnectorFacets', () => {
  it('counts every entry of a group when nothing is selected', () => {
    const counts = countConnectorFacets(all, EMPTY_CONNECTOR_FILTERS);
    expect(counts.domains.get('vulnerability')).toBe(3);
    expect(counts.domains.get('compliance')).toBe(1);
    expect(counts.domains.get('simulation')).toBe(1);
    expect(counts.domains.get('threat_intelligence')).toBe(0);
  });

  it('counts a scope kind once per connector writing it, however many kinds that connector writes', () => {
    const counts = countConnectorFacets(all, EMPTY_CONNECTOR_FILTERS);
    expect(counts.scopeKinds.get('cves')).toBe(2);
    expect(counts.scopeKinds.get('findings')).toBe(2);
    expect(counts.scopeKinds.get('capability_assessments')).toBe(1);
  });

  it('ignores a group own selection when counting it, so its other rows stay reachable', () => {
    const counts = countConnectorFacets(all, { ...EMPTY_CONNECTOR_FILTERS, domains: ['compliance'] });
    expect(counts.domains.get('compliance')).toBe(1);
    expect(counts.domains.get('vulnerability')).toBe(3);
  });

  it('narrows a group counts by the other groups selections', () => {
    const counts = countConnectorFacets(all, { ...EMPTY_CONNECTOR_FILTERS, states: ['failing'] });
    expect(counts.domains.get('vulnerability')).toBe(1);
    expect(counts.domains.get('compliance')).toBe(1);
    expect(counts.domains.get('simulation')).toBe(0);
  });

  it('narrows every group by the search', () => {
    const counts = countConnectorFacets(all, { ...EMPTY_CONNECTOR_FILTERS, search: 'CVE' });
    expect(counts.domains.get('vulnerability')).toBe(1);
    expect(counts.domains.get('compliance')).toBe(0);
  });

  it('counts the states of the whole vocabulary, including those nothing holds', () => {
    const counts = countConnectorFacets(all, EMPTY_CONNECTOR_FILTERS);
    expect(counts.states.get('failing')).toBe(2);
    expect(counts.states.get('never_synced')).toBe(1);
    expect(counts.states.get('unavailable')).toBe(0);
    expect(counts.states.get('not_configured')).toBe(0);
  });
});

describe('sortConnectors', () => {
  it('sorts by name ascending, which is the default the toolbar opens on', () => {
    expect(sortConnectors(all, 'name_asc').map((entry) => entry.name))
      .toEqual(['CISA KEV', 'Drata', 'Microsoft Defender', 'NIST NVD CVE', 'OpenAEV']);
  });

  it('sorts by name descending', () => {
    expect(sortConnectors(all, 'name_desc').map((entry) => entry.name))
      .toEqual(['OpenAEV', 'NIST NVD CVE', 'Microsoft Defender', 'Drata', 'CISA KEV']);
  });

  it('sorts by state with what needs attention first, then by name inside a state', () => {
    expect(sortConnectors(all, 'state').map((entry) => entry.name))
      .toEqual(['Drata', 'Microsoft Defender', 'CISA KEV', 'OpenAEV', 'NIST NVD CVE']);
  });

  it('leaves the input array untouched', () => {
    const input = [drata, nist];
    sortConnectors(input, 'name_asc');
    expect(input).toEqual([drata, nist]);
  });
});

describe('groupConnectorsByDomain', () => {
  it('groups into sections carrying their own count', () => {
    const sections = groupConnectorsByDomain(all);
    expect(sections).toEqual([
      { domain: 'vulnerability', connectors: [nist, cisa, defender] },
      { domain: 'simulation', connectors: [openaev] },
      { domain: 'compliance', connectors: [drata] },
    ]);
  });

  it('drops a domain holding nothing rather than rendering an empty section', () => {
    expect(groupConnectorsByDomain([drata]).map((section) => section.domain)).toEqual(['compliance']);
  });

  it('follows the declared domain order, not the order the connectors arrived in', () => {
    const sections = groupConnectorsByDomain([drata, nist]);
    expect(sections.map((section) => section.domain)).toEqual(['vulnerability', 'compliance']);
    expect(DOMAIN_ORDER.indexOf('vulnerability')).toBeLessThan(DOMAIN_ORDER.indexOf('compliance'));
  });

  it('keeps the incoming order inside a section, so the sort survives grouping', () => {
    expect(groupConnectorsByDomain([defender, nist, cisa])[0]?.connectors).toEqual([defender, nist, cisa]);
  });
});

describe('filterConnectors accents', () => {
  const ecole = connector({ name: 'École Straße', shortDescription: 'Données' });
  const plain = connector({ name: 'ecole plain', shortDescription: 'donnees' });

  it('should find an accented name or description from its plain spelling', () => {
    expect(filterConnectors([ecole], { ...EMPTY_CONNECTOR_FILTERS, search: 'ecole' })).toEqual([ecole]);
    expect(filterConnectors([ecole], { ...EMPTY_CONNECTOR_FILTERS, search: 'strasse' })).toEqual([ecole]);
    expect(filterConnectors([ecole], { ...EMPTY_CONNECTOR_FILTERS, search: 'donnees' })).toEqual([ecole]);
  });

  it('should find a plain name from an accented search', () => {
    expect(filterConnectors([plain], { ...EMPTY_CONNECTOR_FILTERS, search: 'éco' })).toEqual([plain]);
  });
});
