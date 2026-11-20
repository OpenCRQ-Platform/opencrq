/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoveredTechniqueControlTestReading, TechniqueCoverageReading, TechniqueFunctionCoverage } from '@app/module/client';
import type { HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import type { ThreatTechniqueRow } from './threat-ttp-utils';
import { FAILED, NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { ThreatTechniquesView } from './threat-techniques-view';

interface ListFilters {
  search: string,
  tactic: string,
  function: 'prevent' | 'detect',
  result: 'all' | 'confirmed' | 'lowered' | 'untested' | 'uncovered',
}

const NO_FILTER: ListFilters = { search: '', tactic: '', function: 'prevent', result: 'all' };

const view = vi.fn<() => 'table' | 'matrix'>();
const openctiUrl = vi.fn<() => string | null>();
const coverages = vi.fn<() => Array<TechniqueFunctionCoverage> | undefined>();
const coverageFailed = vi.fn<() => boolean>();
const addressFilters: { current: ListFilters } = { current: NO_FILTER };

// The address as `useUrlListFilters` reads and writes it, held in state so a write re-renders.
const useAddressFilters = () => {
  const [filters, setAll] = useState(addressFilters.current);
  const setFilters = (patch: Partial<ListFilters>): void => setAll((previous) => {
    addressFilters.current = { ...previous, ...patch };
    return addressFilters.current;
  });
  return { filters, setFilters };
};

vi.mock('../../../hooks', () => ({
  useOpenCtiBaseUrl: () => openctiUrl(),
  usePersistedView: () => ({ view: view(), setView: vi.fn() }),
  useUrlListFilters: () => useAddressFilters(),
}));

vi.mock('../../../components/shared/debounced-search-field', () => ({
  DebouncedSearchField: ({ value, onCommit, placeholder }: { value: string, onCommit: (next: string) => void, placeholder: string }) => (
    <input placeholder={placeholder} value={value} onChange={(event) => onCommit(event.target.value)} />
  ),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useNavigate: () => vi.fn(),
  useParams: () => ({ organizationId: undefined }),
}));

vi.mock('../../controls/capability/hooks/use-capability-validation', () => ({
  useOpenaevConnector: () => ({ isConfigured: true, url: null }),
}));

interface PageProps {
  data: Array<ThreatTechniqueRow>,
  columns: Array<{
    id?: string,
    enableSorting?: boolean,
    cell?: (context: { row: { original: ThreatTechniqueRow } }) => ReactElement,
  }>,
  leftHeaderContent?: ReactNode,
  highlightedTechniques: Array<HighlightedTechnique>,
  initialSorting?: Array<{ id: string, desc: boolean }>,
  initialPageSize?: number,
  matrixTacticIds?: ReadonlyArray<string>,
  forceHighlightedOnly?: boolean,
  defaultColor?: string,
}

const pageProps: { current: PageProps | null } = { current: null };

vi.mock('../../../components/ui/data-page-layout', () => ({
  DataPageWithTtpMatrix: (props: PageProps) => {
    pageProps.current = props;
    return <div>{props.leftHeaderContent}</div>;
  },
}));

vi.mock('../../../components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string, onValueChange: (value: string) => void, children: ReactNode }) => (
    <select aria-label="Filter by tactic" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string, children: ReactNode }) => <option value={value}>{children}</option>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  view.mockReturnValue('matrix');
  openctiUrl.mockReturnValue(null);
  addressFilters.current = NO_FILTER;
  coverages.mockReturnValue([]);
  coverageFailed.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  pageProps.current = null;
});

const INITIAL_ACCESS = { id: 'tactic-initial-access', externalId: 'TA0001', name: 'Initial Access' };
const CREDENTIAL_ACCESS = { id: 'tactic-credential-access', externalId: 'TA0006', name: 'Credential Access' };

const technique = (overrides: Partial<ThreatTechniqueRow> & Pick<ThreatTechniqueRow, 'id' | 'externalId' | 'name'>): ThreatTechniqueRow => ({
  citedExternalIds: [overrides.externalId],
  tactics: [],
  openctiStixRelationId: null,
  ...overrides,
});

const TECHNIQUES = [
  technique({ id: 't1566-001', externalId: 'T1566.001', name: 'Spearphishing Attachment', tactics: [INITIAL_ACCESS] }),
  technique({ id: 't1685', externalId: 'T1685', name: 'Disable or Modify Tools', citedExternalIds: ['T1562.001'], tactics: [CREDENTIAL_ACCESS] }),
  technique({ id: 't1078', externalId: 'T1078', name: 'Valid Accounts', tactics: [INITIAL_ACCESS, CREDENTIAL_ACCESS] }),
];

/** Renders the view once the coverage read has settled, or is still pending when `coverages` has nothing to answer. */
const openView = async (techniques: Array<ThreatTechniqueRow> = TECHNIQUES) => {
  const { queryClient, calls } = renderWithTrpc(<ThreatTechniquesView threatId="threat-1" techniques={techniques} />, {
    answers: { 'controlValidation.getTechniquesCoverage': () => (coverageFailed() ? FAILED : (coverages() ?? NEVER)) },
  });
  const pendingReads = coverages() === undefined && !coverageFailed() ? 1 : 0;
  await waitFor(() => expect(queryClient.isFetching()).toBe(pendingReads));
  await act(async () => {});
  return { props: pageProps.current!, calls };
};

const renderView = async (techniques: Array<ThreatTechniqueRow> = TECHNIQUES): Promise<PageProps> => (await openView(techniques)).props;

const ids = (props: PageProps | null): Array<string> => (props?.data ?? []).map((row) => row.externalId);
const columnIds = (props: PageProps): Array<string | undefined> => props.columns.map((column) => column.id);

const renderCell = (props: PageProps, columnId: string, row: ThreatTechniqueRow): ReactElement => {
  const column = props.columns.find((candidate) => candidate.id === columnId);
  return column!.cell!({ row: { original: row } });
};

describe('ThreatTechniquesView', () => {
  it('should open on the matrix with every technique highlighted and no search', async () => {
    const props = await renderView();

    expect(ids(props)).toEqual(['T1566.001', 'T1685', 'T1078']);
    expect(props.highlightedTechniques.map((highlight) => highlight.id)).toEqual(['t1566-001', 't1685', 't1078']);
    expect(screen.queryByPlaceholderText('Search techniques...')).toBeNull();
    expect(props.matrixTacticIds).toBeUndefined();
  });

  it('should list the ID and the name in two sortable columns, by ID, twenty to a page', async () => {
    view.mockReturnValue('table');
    const props = await renderView();

    expect(columnIds(props)).toEqual(['externalId', 'name', 'tactics', 'engineEfficacy', 'openaevResult', 'control']);
    expect(props.columns.find((column) => column.id === 'tactics')?.enableSorting).toBe(false);
    expect(props.initialSorting).toEqual([{ id: 'externalId', desc: false }]);
    expect(props.initialPageSize).toBe(20);
  });

  it('should search the list by ID, by name and by the revoked ID a technique was cited as', async () => {
    view.mockReturnValue('table');
    await renderView();
    const search = screen.getByPlaceholderText('Search techniques...');

    fireEvent.change(search, { target: { value: 'spear' } });
    expect(ids(pageProps.current)).toEqual(['T1566.001']);

    fireEvent.change(search, { target: { value: 't1078' } });
    expect(ids(pageProps.current)).toEqual(['T1078']);

    fireEvent.change(search, { target: { value: 'T1562' } });
    expect(ids(pageProps.current)).toEqual(['T1685']);
  });

  it('should filter both views by tactic, offering each tactic of the techniques once, by name', async () => {
    await renderView();
    const select = screen.getByLabelText<HTMLSelectElement>('Filter by tactic');

    expect(Array.from(select.options, (option) => option.textContent)).toEqual(['All tactics', 'Credential Access', 'Initial Access']);

    fireEvent.change(select, { target: { value: CREDENTIAL_ACCESS.id } });
    expect(ids(pageProps.current)).toEqual(['T1685', 'T1078']);
    expect(pageProps.current?.highlightedTechniques.map((highlight) => highlight.id)).toEqual(['t1685', 't1078']);
    expect(pageProps.current?.matrixTacticIds).toEqual([CREDENTIAL_ACCESS.id]);

    expect(addressFilters.current.tactic).toBe(CREDENTIAL_ACCESS.id);

    fireEvent.change(select, { target: { value: 'all' } });
    expect(ids(pageProps.current)).toHaveLength(3);
    expect(pageProps.current?.matrixTacticIds).toBeUndefined();
    expect(addressFilters.current.tactic).toBe('');
  });

  it('should read the search and the tactic from the address', async () => {
    view.mockReturnValue('table');
    addressFilters.current = { ...NO_FILTER, search: 'accounts', tactic: INITIAL_ACCESS.id };
    const props = await renderView();

    expect(ids(props)).toEqual(['T1078']);
    expect(screen.getByLabelText<HTMLSelectElement>('Filter by tactic').value).toBe(INITIAL_ACCESS.id);
  });

  it('should show every technique for a tactic in the address the threat falls under nowhere', async () => {
    addressFilters.current = { ...NO_FILTER, tactic: 'tactic-of-another-threat' };
    const props = await renderView();

    expect(ids(props)).toHaveLength(3);
    expect(props.matrixTacticIds).toBeUndefined();
    expect(screen.getByLabelText<HTMLSelectElement>('Filter by tactic').value).toBe('all');
  });

  it('should leave the matrix whole for a search in the address', async () => {
    addressFilters.current = { ...NO_FILTER, search: 'accounts' };

    expect(ids(await renderView())).toHaveLength(3);
  });

  it('should keep the revoked ID a technique was cited as under its name', async () => {
    view.mockReturnValue('table');
    const props = await renderView();
    render(renderCell(props, 'name', TECHNIQUES[1]));

    expect(screen.getByText('Disable or Modify Tools')).toBeTruthy();
    expect(screen.getByText('Cited as T1562.001, a revoked ATT&CK ID')).toBeTruthy();
  });

  it('should show the empty value for a technique under no tactic', async () => {
    view.mockReturnValue('table');
    const props = await renderView();
    const { container } = render(renderCell(props, 'tactics', technique({ id: 't1599', externalId: 'T1599', name: 'Network Boundary Bridging' })));

    expect(container.textContent).toBe(EMPTY_VALUE);
  });

  it('should add the OpenCTI column only when a technique links to OpenCTI', async () => {
    view.mockReturnValue('table');
    openctiUrl.mockReturnValue('https://opencti.example');
    expect(columnIds(await renderView())).not.toContain('opencti');
    cleanup();

    const linked = [technique({ id: 't1078', externalId: 'T1078', name: 'Valid Accounts', openctiStixRelationId: 'relationship--22222222-2222-4222-8222-222222222222' })];
    expect(columnIds(await renderView(linked))).toContain('opencti');
  });
});

describe('ThreatTechniquesView coverage', () => {
  const L2_L2 = { strengthRung: 'L2', coverageBucket: 'L2', strength: 0.72, coverage: 0.7, phishingStage: null } as const;

  const reading = (
    mitreTechniqueId: string,
    capabilityExternalId: string,
    over: Partial<CoveredTechniqueControlTestReading> = {},
  ): TechniqueCoverageReading & CoveredTechniqueControlTestReading => ({
    covered: true,
    linked: true,
    removedOn: null,
    capabilityId: `control-${capabilityExternalId}`,
    capabilityExternalId,
    capabilityName: `${capabilityExternalId} control`,
    capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' },
    function: 'prevent',
    mitreTechniqueId,
    familyTechniqueId: mitreTechniqueId,
    declaration: L2_L2,
    declared: 0.5,
    efficacy: 0.5,
    tested: null,
    parentEfficacy: null,
    ...over,
  });

  const LOWERED = { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 };
  const COVERAGES: Array<TechniqueFunctionCoverage> = [
    {
      mitreTechniqueId: 't1078',
      function: 'prevent',
      best: reading('t1078', 'PAM', { declared: 0.45, efficacy: 0.45 }),
      others: [reading('t1078', 'IDP', { declared: 0.6, efficacy: 0.3, tested: LOWERED })],
    },
    { mitreTechniqueId: 't1078', function: 'detect', best: null, others: [] },
    {
      mitreTechniqueId: 't1566-001',
      function: 'prevent',
      best: reading('t1566-001', 'SEG', { efficacy: 0.3, tested: LOWERED }),
      others: [],
    },
    {
      mitreTechniqueId: 't1566-001',
      function: 'detect',
      best: reading('t1566-001', 'EDR', { function: 'detect', tested: { ...LOWERED, heldTests: 10, rate: 1 } }),
      others: [],
    },
    { mitreTechniqueId: 't1685', function: 'prevent', best: null, others: [] },
    { mitreTechniqueId: 't1685', function: 'detect', best: null, others: [] },
  ];

  const highlightOf = (props: PageProps, id: string): HighlightedTechnique => props.highlightedTechniques.find((highlight) => highlight.id === id)!;
  const segmentButton = (label: string): HTMLElement => screen.getByRole('button', { name: new RegExp(`^${label}`) });

  beforeEach(() => {
    coverages.mockReturnValue(COVERAGES);
  });

  it('should ask for the coverage of the threat by its id in one request, at the tenant level', async () => {
    const { calls } = await openView();

    expect(calls).toContainEqual(expect.objectContaining({
      path: 'controlValidation.getTechniquesCoverage',
      input: { threatId: 'threat-1', organizationId: null },
    }));
  });

  it('should show the techniques without coverage and no segments while the coverage loads', async () => {
    coverages.mockReturnValue(undefined);
    addressFilters.current = { ...NO_FILTER, result: 'lowered' };
    const props = await renderView();

    expect(ids(props)).toEqual(['T1566.001', 'T1685', 'T1078']);
    expect(props.forceHighlightedOnly).toBe(false);
    expect(highlightOf(props, 't1685')).toEqual({ id: 't1685', color: props.defaultColor, categoryLabel: 'Cited as T1562.001, a revoked ATT&CK ID' });
    expect(highlightOf(props, 't1078')).toEqual({ id: 't1078', color: props.defaultColor, categoryLabel: undefined });
    expect(screen.queryByRole('button', { name: /^All/ })).toBeNull();
    expect(screen.queryByText('Could not load the coverage of these techniques.')).toBeNull();
  });

  it('should say the coverage could not be loaded, and leave the cells and the list without it', async () => {
    coverages.mockReturnValue(undefined);
    coverageFailed.mockReturnValue(true);
    view.mockReturnValue('table');
    const props = await renderView();

    expect(screen.getByText('Could not load the coverage of these techniques.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^All/ })).toBeNull();
    const { container } = render(<I18nProvider i18n={i18n}>{renderCell(props, 'engineEfficacy', TECHNIQUES[1])}</I18nProvider>);
    expect(container.textContent).toBe(EMPTY_VALUE);
  });

  it('should read a tested control linked at no coverage by why, never offering to link it', async () => {
    const AV_TESTED = { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 };
    const absent = reading('t1685', 'AV', { declaration: { ...L2_L2, coverageBucket: 'L0', coverage: 0 }, declared: 0, efficacy: 0, tested: AV_TESTED });
    coverages.mockReturnValue([{ mitreTechniqueId: 't1685', function: 'prevent', best: null, others: [absent] }]);
    view.mockReturnValue('table');
    const props = await renderView();

    expect(highlightOf(props, 't1685')).toMatchObject({ categoryLabel: 'Declared at no coverage', outlined: true });
    expect(highlightOf(props, 't1685').accent).toBeUndefined();
    expect(segmentButton('Tested, not covered').textContent).toBe('Tested, not covered1');

    render(<I18nProvider i18n={i18n}>{renderCell(props, 'engineEfficacy', TECHNIQUES[1])}</I18nProvider>);
    expect(screen.getByText('Declared at no coverage')).toBeTruthy();
    expect(screen.queryByText('Tested, not declared')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'How the engine efficacy of AV on T1685 is computed' }));
    expect(screen.getByRole('button', { name: 'See the tests in AV › Validation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Declare on AV' })).toBeNull();
  });

  it('should never read a tested control linked on a sub-technique alone as missing its link', async () => {
    const EDR_TESTED = { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 };
    coverages.mockReturnValue([{
      mitreTechniqueId: 't1566-001',
      function: 'prevent',
      best: null,
      others: [{
        covered: false,
        linked: true,
        removedOn: null,
        capabilityId: 'control-EDR',
        capabilityExternalId: 'EDR',
        capabilityName: 'EDR control',
        capabilityRungs: null,
        function: 'prevent',
        mitreTechniqueId: 't1566-001',
        familyTechniqueId: 't1566',
        tested: EDR_TESTED,
      }],
    }]);
    view.mockReturnValue('table');
    const props = await renderView();

    expect(highlightOf(props, 't1566-001')).toMatchObject({ categoryLabel: 'Not covered · tested', outlined: true });
    expect(highlightOf(props, 't1566-001').accent).toBeUndefined();
    render(<I18nProvider i18n={i18n}>{renderCell(props, 'engineEfficacy', TECHNIQUES[0])}</I18nProvider>);
    expect(screen.getByText('Not covered')).toBeTruthy();
    expect(screen.queryByText('Tested, not declared')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'How the engine efficacy of EDR on T1566.001 is computed' }));
    expect(screen.getByRole('button', { name: 'See the tests in EDR › Validation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Declare on EDR' })).toBeNull();
  });

  const testedUnlinked = (removedOn: TechniqueCoverageReading['removedOn']): Array<TechniqueFunctionCoverage> => [{
    mitreTechniqueId: 't1685',
    function: 'prevent',
    best: null,
    others: [{
      covered: false,
      linked: false,
      removedOn,
      capabilityId: 'control-SEG',
      capabilityExternalId: 'SEG',
      capabilityName: 'SEG control',
      capabilityRungs: null,
      function: 'prevent',
      mitreTechniqueId: 't1685',
      familyTechniqueId: 't1685',
      tested: { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 },
    }],
  }];
  const openSegDialog = async () => {
    view.mockReturnValue('table');
    const { props } = await openView();
    // The cell is mounted apart from the view, under a client of its own: `calls` are the mutations it sends.
    const { calls } = renderWithTrpc(renderCell(props, 'engineEfficacy', TECHNIQUES[1]));
    expect(screen.getByText('Not declared')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'How the engine efficacy of SEG on T1685 is computed' }));
    return { props, calls };
  };

  /** What the fake server was asked, on a mutation of `controlCapabilities`. */
  const mutationInputs = (calls: Array<{ path: string, input: unknown, type: string }>, procedure: string) =>
    calls.filter((call) => call.type === 'mutation' && call.path === `controlCapabilities.${procedure}`).map((call) => call.input);

  it('should declare in place a tested control nothing links to the technique', async () => {
    coverages.mockReturnValue(testedUnlinked(null));
    const { props, calls } = await openSegDialog();

    expect(highlightOf(props, 't1685').categoryLabel).toBe('Tested, not declared');
    fireEvent.click(screen.getByRole('button', { name: 'Declare on SEG' }));

    await waitFor(() => expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([{ capabilityId: 'control-SEG', techniqueId: 't1685', function: 'prevent' }]));
    expect(mutationInputs(calls, 'restoreTechnique')).toEqual([]);
  });

  it('should restore a tested control the tenant unlinked from the technique rather than add it again', async () => {
    coverages.mockReturnValue(testedUnlinked('technique'));
    const { calls } = await openSegDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Declare on SEG' }));

    await waitFor(() => expect(mutationInputs(calls, 'restoreTechnique')).toEqual([{ capabilityId: 'control-SEG', techniqueId: 't1685', function: 'prevent' }]));
    expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([]);
  });

  it('should offer no declaration on a link the parent carries and was unlinked from, which is relinked there', async () => {
    coverages.mockReturnValue(testedUnlinked('parent'));
    await openSegDialog();

    expect(screen.getByRole('button', { name: 'See the tests in SEG › Validation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Declare on SEG' })).toBeNull();
  });

  it('should mark a tested technique with its best control\'s efficacy and its two bars, and open its dialog on a click', async () => {
    const highlight = highlightOf(await renderView(), 't1566-001');

    expect(highlight.marker).toBe('30%');
    expect(highlight.bars?.map((bar) => bar.figure)).toEqual(['50%', '10%']);
    expect(highlight.categoryLabel).toBe('Covered · lowered by the tests');

    render(<I18nProvider i18n={i18n}>{highlight.renderLink!({ className: '', children: 'T1566.001' })}</I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'T1566.001' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('SEG · T1566.001 Spearphishing Attachment · Prevention')).toBeTruthy();
  });

  it('should name the best control in the tooltip and list the others with their efficacy and verdict', async () => {
    const highlight = highlightOf(await renderView(), 't1078');
    render(<I18nProvider i18n={i18n}>{highlight.tooltipContent}</I18nProvider>);

    expect(screen.getByText('Best of 2 controls: PAM PAM control')).toBeTruthy();
    expect(screen.getByText('Engine efficacy: 45%')).toBeTruthy();
    expect(screen.getByText('Other controls')).toBeTruthy();
    expect(screen.getByText('30% · Lowered by the tests')).toBeTruthy();
  });

  it('should read a technique no control covers as not covered', async () => {
    const highlight = highlightOf(await renderView(), 't1685');

    expect(highlight).toMatchObject({ categoryLabel: 'Not covered', outlined: true });
    expect(highlight.marker).toBeUndefined();
  });

  it('should count the segments on the cells and narrow both views to the one picked', async () => {
    await renderView();

    expect(segmentButton('All').textContent).toBe('All3');
    expect(segmentButton('Lowered by the tests').textContent).toBe('Lowered by the tests1');
    expect(segmentButton('Not tested').textContent).toBe('Not tested1');
    expect(segmentButton('Confirmed by the tests').textContent).toBe('Confirmed by the tests0');

    fireEvent.click(segmentButton('Lowered by the tests'));
    expect(addressFilters.current.result).toBe('lowered');
    expect(ids(pageProps.current)).toEqual(['T1566.001']);
    expect(pageProps.current?.highlightedTechniques.map((highlight) => highlight.id)).toEqual(['t1566-001']);
    expect(pageProps.current?.forceHighlightedOnly).toBe(true);
  });

  it('should switch to detection, in the address, and read the techniques on it', async () => {
    await renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Detection' }));

    expect(addressFilters.current.function).toBe('detect');
    expect(segmentButton('Confirmed by the tests').textContent).toBe('Confirmed by the tests1');
    expect(highlightOf(pageProps.current!, 't1078').categoryLabel).toBe('Not covered');
    expect(pageProps.current?.defaultColor).not.toBeUndefined();
  });

  it('should list the efficacy, the result and the control the row reads', async () => {
    view.mockReturnValue('table');
    const props = await renderView();

    render(<I18nProvider i18n={i18n}>{renderCell(props, 'engineEfficacy', TECHNIQUES[2])}</I18nProvider>);
    expect(screen.getByText('45%')).toBeTruthy();
    expect(screen.getByText('Declared 45%')).toBeTruthy();
    cleanup();

    render(<I18nProvider i18n={i18n}>{renderCell(props, 'control', TECHNIQUES[2])}</I18nProvider>);
    expect(screen.getByText('PAM control')).toBeTruthy();
    cleanup();

    render(<I18nProvider i18n={i18n}>{renderCell(props, 'engineEfficacy', TECHNIQUES[1])}</I18nProvider>);
    expect(screen.getByText('Not covered')).toBeTruthy();
  });
});
