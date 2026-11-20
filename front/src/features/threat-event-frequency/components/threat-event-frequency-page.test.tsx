/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  stripSearchParams,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TefCatalog, TefRead, TefReading } from '../threat-event-frequency-utils';
import type { ThreatEventFrequencyTab } from './threat-event-frequency-page';
import { FAILED, renderWithTrpc } from '../../../providers/trpc-test-harness';
import {
  THREAT_EVENT_FREQUENCY_SCOPES_LIST_SEARCH_DEFAULTS,
  threatEventFrequencyListSearchSchema,
  threatEventFrequencyScopesListSearchSchema,
} from '../threat-event-frequency-list-search';
import { ThreatEventFrequencyPage } from './threat-event-frequency-page';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const FINANCE_ID = '019e0000-0000-7000-8000-000000000001';
const USA_ID = '019e0000-0000-7000-8000-000000000003';
const FRANCE_ID = '019e0000-0000-7000-8000-000000000004';
const RANSOMWARE_ID = '019e0000-0000-7000-8000-0000000000a1';
const DISRUPTION_ID = '019e0000-0000-7000-8000-0000000000a2';
const FRAUD_ID = '019e0000-0000-7000-8000-0000000000a3';

const SOURCE = { id: 'filigran-intelligence', title: 'Filigran Intelligence', publisher: 'Filigran', url: null, licence: null, attribution: null, referencePeriod: '2005-2025' };

const CATALOG: TefCatalog = {
  id: 'opencrq-open-data',
  version: '1.0.0',
  builtOn: '2026-11-08',
  publisher: 'Filigran',
  sources: [SOURCE],
  sizeClasses: ['0-9', '10-49', '50-249', '250-999', '1000-4999', '5000+'],
  outcomes: [{ id: RANSOMWARE_ID, name: 'Ransomware' }, { id: DISRUPTION_ID, name: 'Service Disruption' }, { id: FRAUD_ID, name: 'Financial Fraud & Funds Theft' }],
  sectors: [{ id: FINANCE_ID, name: 'Finance', measured: true }],
  countries: [
    { id: FRANCE_ID, name: 'France', isoAlpha3: 'FRA', readAs: 'FR' },
    { id: USA_ID, name: 'United States of America', isoAlpha3: 'USA', readAs: 'US' },
  ],
  revenueBands: [],
};

const US_SCOPE = { id: '019e0000-0000-7000-8000-0000000000b1', name: 'US subsidiary', sectorId: FINANCE_ID, countryId: USA_ID, employeeCount: 6200, revenueBand: '100m_1b' };
const FRANCE_SCOPE = { id: '019e0000-0000-7000-8000-0000000000b2', name: 'France headquarters', sectorId: FINANCE_ID, countryId: FRANCE_ID, employeeCount: 120, revenueBand: null };
const NO_HEADCOUNT_SCOPE = { id: '019e0000-0000-7000-8000-0000000000b3', name: 'Mexico office', sectorId: FINANCE_ID, countryId: USA_ID, employeeCount: null, revenueBand: '100m_1b' };

interface Profile { countryId: string | null, sectorId: string | null, employeeCount: number | null, revenueBand: string | null }

const readOf = (profile: Profile, likely: number, notMeasured: TefRead['notMeasured'] = []): TefRead => {
  const country = profile.countryId === FRANCE_ID ? 'FR' : 'US';
  const counted = profile.employeeCount !== null;
  return {
    catalogue: { id: CATALOG.id, version: CATALOG.version },
    countryIsoAlpha3: profile.countryId === FRANCE_ID ? 'FRA' : 'USA',
    sectorName: 'Finance',
    sizeSource: counted ? 'employee_count' : 'revenue_band',
    country,
    sector: 'Finance',
    sizeClasses: counted
      ? [{ sizeClass: (profile.employeeCount ?? 0) >= 5000 ? '5000+' : '50-249', weight: 1 }]
      : [{ sizeClass: '50-249', weight: 0.4 }, { sizeClass: '5000+', weight: 0.6 }],
    low: likely / 4,
    likely,
    high: likely * 3,
    notMeasured,
    sources: [SOURCE],
  };
};

/** Each outcome's read, and their total as the server computes it: the sum of their minimums, modes and maximums. */
const readingFor = (profile: Profile): TefReading => {
  const france = profile.countryId === FRANCE_ID;
  const sizeMark: TefRead['notMeasured'] = (profile.employeeCount ?? 0) >= 5000 ? ['size'] : [];
  const outcomes = [
    { attackOutcomeId: RANSOMWARE_ID, name: 'Ransomware', read: readOf(profile, france ? 0.2 : 0.4, sizeMark) },
    { attackOutcomeId: DISRUPTION_ID, name: 'Service Disruption', read: readOf(profile, france ? 0.1 : 0.2, sizeMark) },
    { attackOutcomeId: FRAUD_ID, name: 'Financial Fraud & Funds Theft', read: readOf(profile, france ? 0.34 : 0.92, france ? ['sector'] : sizeMark) },
  ];
  const sum = (point: (read: TefRead) => number): number => outcomes.reduce((total, { read }) => total + point(read), 0);
  return { outcomes, total: { low: sum((read) => read.low), likely: sum((read) => read.likely), high: sum((read) => read.high) } };
};

/** On the US subsidiary, whose catalogue gives Ransomware 0.4 and Financial Fraud 0.92 attempts a year. */
const SCENARIOS = [
  { id: '019e0000-0000-7000-8000-0000000000c1', name: 'Ransomware on the ERP', attackOutcomeId: RANSOMWARE_ID, tefMode: 'auto', likely: 0.4, read: readOf(US_SCOPE, 0.4) },
  { id: '019e0000-0000-7000-8000-0000000000c2', name: 'Plant shutdown', attackOutcomeId: RANSOMWARE_ID, tefMode: 'manual', likely: 1, read: null },
  { id: '019e0000-0000-7000-8000-0000000000c3', name: 'Wire fraud', attackOutcomeId: FRAUD_ID, tefMode: 'auto', likely: 0.7, read: readOf(US_SCOPE, 0.7) },
];

const SCOPES = [FRANCE_SCOPE, NO_HEADCOUNT_SCOPE, US_SCOPE];

const renderPage = (
  organizationId: string | undefined,
  scope: object | 'error' = US_SCOPE,
  initialPath = '/',
  tab?: ThreatEventFrequencyTab,
) => {
  const answers = {
    'crqIndicators.getTefCatalog': CATALOG,
    'crqIndicators.getTefCatalogReading': (input: Profile) => readingFor(input),
    'crqIndicators.getTefCatalogScopeReadings': SCOPES.map((candidate) => ({ organizationId: candidate.id, ...readingFor(candidate) })),
    'organizations.getOrganizations': SCOPES,
    'crqIndicators.getScopeScenarioTefs': SCENARIOS,
    'organizations.getOrganization': scope === 'error' ? FAILED : scope,
  };

  const rootRoute = createRootRoute({
    validateSearch: threatEventFrequencyListSearchSchema.extend(threatEventFrequencyScopesListSearchSchema.shape),
    search: { middlewares: [stripSearchParams(THREAT_EVENT_FREQUENCY_SCOPES_LIST_SEARCH_DEFAULTS)] },
    component: (): ReactNode => <ThreatEventFrequencyPage organizationId={organizationId} tab={tab} />,
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [initialPath] }) });
  const { calls } = renderWithTrpc(<RouterProvider router={router} />, { answers });
  return { calls, router };
};

/** An outcome's row in the data table, whose cells hold no row header. */
const outcomeRowOf = (name: string): HTMLElement => {
  const row = screen.getAllByText(name).map((node) => node.closest('tr')).find((candidate) => candidate?.closest('tbody') !== null);
  if (!row) {
    throw new Error(`No outcome row for ${name}`);
  }
  return row;
};

const readingCalls = (calls: ReadonlyArray<{ path: string, input: unknown }>) =>
  calls.filter((call) => call.path === 'crqIndicators.getTefCatalogReading').map((call) => call.input);

describe('ThreatEventFrequencyPage, inside a risk scope', () => {
  it('should lead with the total, its recurrence and its range', async () => {
    renderPage(US_SCOPE.id);

    expect(await screen.findByText('1.52')).toBeTruthy();
    expect(screen.getByText('About once every 7.9 months')).toBeTruthy();
    expect(screen.getByText('0.38 to 4.6')).toBeTruthy();
  });

  it('should name the catalogue version, its build date and its source', async () => {
    renderPage(US_SCOPE.id);

    expect(await screen.findByText('Catalog 1.0.0, Nov 8, 2026. Source: Filigran Intelligence.')).toBeTruthy();
  });

  it('should show a size the surveys do not publish as an alert chip whose tooltip says what the figure uses', async () => {
    renderPage(US_SCOPE.id);

    await screen.findByText('1.52');
    const chip = screen.getByRole('button', { name: /^6,200 employees\./ });
    act(() => chip.focus());
    expect((await screen.findByRole('tooltip')).textContent)
      .toContain('Size not published by the surveys: the figure for 5,000+ employees is extended from the published sizes.');
    expect(screen.getByText('United States of America').closest('button')).toBeNull();
  });

  it('should read a size from the revenue band, and offer to fill in the employee count', async () => {
    renderPage(NO_HEADCOUNT_SCOPE.id, NO_HEADCOUNT_SCOPE);

    await screen.findByText('1.52');
    expect(screen.getByRole('button', { name: /^Revenue \$100M-\$1B\. Employee count not filled in: size inferred from the revenue, 50 employees or more\.$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fill in the employee count' })).toBeTruthy();
  });

  it('should read a declared headcount of 0 as a headcount, as the catalogue does', async () => {
    const empty = { ...US_SCOPE, employeeCount: 0 };
    const { calls } = renderPage(empty.id, empty);

    await screen.findByText('1.52');
    expect(screen.getByText('0 employees')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fill in the employee count' })).toBeNull();
    expect(readingCalls(calls)).toEqual([{ countryId: USA_ID, sectorId: FINANCE_ID, employeeCount: 0, revenueBand: '100m_1b' }]);
  });

  it('should list the outcomes most frequent first, with their range and their scenarios', async () => {
    renderPage(US_SCOPE.id);

    await screen.findByText('1.52');
    const rows = ['Financial Fraud & Funds Theft', 'Ransomware', 'Service Disruption'].map(outcomeRowOf);
    expect(rows[0].compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(rows[1]).getByText('0.10 to 1.2')).toBeTruthy();
    expect(within(rows[1]).getByRole('link', { name: '2 risk scenarios' })).toBeTruthy();
    expect(within(rows[1]).getByText('Manual')).toBeTruthy();
    expect(within(rows[0]).getByRole('link', { name: 'Wire fraud' })).toBeTruthy();
    expect(within(rows[0]).getByText('To recompute')).toBeTruthy();
    expect(within(rows[2]).getByText('None')).toBeTruthy();
  });

  it('should pick out the outcome a risk scenario links here from', async () => {
    renderPage(US_SCOPE.id, US_SCOPE, `/?outcome=${RANSOMWARE_ID}`);

    await screen.findByText('1.52');
    expect(within(outcomeRowOf('Ransomware')).getByText('Ransomware').getAttribute('aria-current')).toBe('true');
  });

  it('should show no factor, overlap correction, positioning or initial access vector', async () => {
    renderPage(US_SCOPE.id);

    await screen.findByText('1.52');
    expect(screen.queryByText(/factor|overlap|positioned|firmography|vector|vintage/i)).toBeNull();
  });

  it('should say the frequencies could not be loaded when the risk scope cannot be read', async () => {
    renderPage(US_SCOPE.id, 'error');

    expect(await screen.findByText('The frequencies could not be loaded.')).toBeTruthy();
  });

  it('should read the scope\'s own profile, and write nothing', async () => {
    const { calls } = renderPage(US_SCOPE.id);

    await screen.findByText('1.52');
    expect(calls.every((call) => call.type === 'query')).toBe(true);
    expect(readingCalls(calls)).toEqual([{ countryId: USA_ID, sectorId: FINANCE_ID, employeeCount: 6200, revenueBand: '100m_1b' }]);
  });
});

describe('ThreatEventFrequencyPage, across all risk scopes', () => {
  const renderScopesTab = (initialPath = '/') => renderPage(undefined, US_SCOPE, initialPath, 'scopes');

  const scopeRow = (name: string): HTMLElement => {
    const row = screen.getByText(name).closest('tr');
    if (!row) {
      throw new Error(`No row for ${name}`);
    }
    return row;
  };

  it('should rank the risk scopes by their total, with its range and one column per outcome', async () => {
    renderScopesTab();

    await screen.findByText('US subsidiary');
    const names = screen.getAllByText(/^(US subsidiary|France headquarters|Mexico office)$/).map((node) => node.textContent);
    expect(names).toEqual(['Mexico office', 'US subsidiary', 'France headquarters']);
    const row = scopeRow('France headquarters');
    expect(within(row).getByText('0.64')).toBeTruthy();
    expect(within(row).getByText('0.16 to 1.9')).toBeTruthy();
    expect(within(row).getByText('0.34')).toBeTruthy();
  });

  it('should give the size a column, and show a dimension not measured in the alert colour with its reason', async () => {
    renderScopesTab();

    await screen.findByText('US subsidiary');
    expect(within(scopeRow('US subsidiary')).getByLabelText(/^6,200\. Size not published by the surveys/)).toBeTruthy();
    expect(within(scopeRow('France headquarters')).getByLabelText(/^Finance\. Sector not measured in this country/)).toBeTruthy();
    expect(within(scopeRow('France headquarters')).getByText('120').getAttribute('aria-label')).toBeNull();
  });

  it('should open a scope from its row, but not from an alert chip clicked for its reason', async () => {
    const { router } = renderScopesTab();

    await screen.findByText('US subsidiary');
    fireEvent.click(within(scopeRow('US subsidiary')).getByLabelText(/^6,200\. Size not published/));
    expect(router.state.location.href).toBe('/');
    fireEvent.click(screen.getByText('US subsidiary'));
    await waitFor(() => expect(router.state.location.href).not.toBe('/'));
  });

  it('should keep the risk scopes whose name holds the search', async () => {
    renderScopesTab('/?search=france');

    await screen.findByText('France headquarters');
    expect(screen.queryByText('US subsidiary')).toBeNull();
  });

  it('should read every scope in one call', async () => {
    const { calls } = renderScopesTab();

    await screen.findByText('US subsidiary');
    expect(calls.filter((call) => call.path === 'crqIndicators.getTefCatalogScopeReadings')).toHaveLength(1);
    expect(readingCalls(calls)).toEqual([]);
  });
});

describe('ThreatEventFrequencyPage, the profile simulator', () => {
  it('should say what the page shows, the simulator first and the risk scopes counted on their tab', async () => {
    renderPage(undefined);

    await screen.findByText('1.52');
    expect(screen.getByText(/^How many attack attempts an organization faces per year/)).toBeTruthy();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Simulator', 'Risk scopes (3)']);
  });

  it('should open on the default profile, sized by its revenue band, with nothing to go back to', async () => {
    const { calls } = renderPage(undefined);

    await screen.findByText('1.52');
    expect(readingCalls(calls)).toEqual([{ countryId: USA_ID, sectorId: FINANCE_ID, employeeCount: null, revenueBand: '100m_1b' }]);
    expect(screen.getByText('Revenue band')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Back to the default profile' }).disabled).toBe(true);
    expect(screen.queryByText('Risk Scenarios')).toBeNull();
  });

  it('should start from the risk scope the address names, its headcount hiding the revenue band', async () => {
    const { calls } = renderPage(undefined, US_SCOPE, `/?from=${FRANCE_SCOPE.id}`);

    expect(await screen.findByText('0.64')).toBeTruthy();
    expect(readingCalls(calls)).toContainEqual({ countryId: FRANCE_ID, sectorId: FINANCE_ID, employeeCount: 120, revenueBand: null });
    expect(screen.queryByText('Revenue band')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Back to the profile of France headquarters' }).disabled).toBe(true);
  });

  it('should read a size class at its lowest headcount', async () => {
    const { calls } = renderPage(undefined, US_SCOPE, `/?from=${FRANCE_SCOPE.id}&size=1000-4999`);

    await screen.findByText('0.64');
    expect(readingCalls(calls)).toContainEqual({ countryId: FRANCE_ID, sectorId: FINANCE_ID, employeeCount: 1000, revenueBand: null });
  });

  it('should read a changed part over the starting scope\'s, and go back to the scope on demand', async () => {
    renderPage(undefined, US_SCOPE, `/?from=${FRANCE_SCOPE.id}&countryId=${USA_ID}`);

    expect(await screen.findByText('1.52')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the profile of France headquarters' }));
    expect(await screen.findByText('0.64')).toBeTruthy();
  });

  it('should ignore a starting scope the tenant does not have', async () => {
    renderPage(undefined, US_SCOPE, '/?from=019e0000-0000-7000-8000-0000000000ff');

    expect(await screen.findByText('1.52')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to the default profile' })).toBeTruthy();
  });
});
