/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type * as TanstackRouter from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CapabilityEdge } from '../types/capability';
import type { ControlTechniqueTestReading, CoveredTechniqueTestReading, TechniqueTestOutcome } from '../types/validation';
import type { HighlightedTechnique } from '../../../../components/shared/ttp-matrix-cell';
import { renderWithTrpc } from '../../../../providers/trpc-test-harness';
import { CapabilityTechniquesMatrix } from './capability-techniques-matrix';

const navigate = vi.fn();
const invalidateRoute = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof TanstackRouter>(),
  Link: () => null,
  useNavigate: () => (...args: Array<unknown>) => navigate(...args),
  useRouter: () => ({ invalidate: invalidateRoute }),
  useParams: () => ({}),
}));

const validation = { isVisible: true, isAvailable: true as boolean | undefined };

vi.mock('../hooks/use-capability-validation', () => ({
  useCapabilityValidation: () => ({ ...validation, cellByTechnique: new Map() }),
  validationCellKey: (techniqueId: string, fn: string) => `${techniqueId}:${fn}`,
}));

vi.mock('./add-technique-dialog', () => ({
  AddTechniqueDialog: () => null,
}));

interface PageProps {
  headerActions?: ReactNode,
  segments?: Array<{ key: string, count: number }>,
  onSegmentChange?: (key: string) => void,
  data: Array<{ id: string }>,
  columns: Array<{ id: string, cell?: (context: { row: { original: CapabilityEdge & { id: string, kind: 'edge' | 'tested' } }, table?: ReturnType<typeof tableShowing> }) => ReactNode }>,
  highlightedTechniques: Array<HighlightedTechnique>,
  matrixHeader?: ReactNode,
}

const pageProps: { current: PageProps | null } = { current: null };

const tableShowing = (hidden: Array<string> = []) => ({ getColumn: (id: string) => ({ getIsVisible: () => !hidden.includes(id) }) });

vi.mock('../../../../components/ui/data-page-layout', () => ({
  DataPageWithTtpMatrix: (props: PageProps) => {
    pageProps.current = props;
    return <div data-testid="page">{props.headerActions}</div>;
  },
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  pageProps.current = null;
  validation.isVisible = true;
  validation.isAvailable = true;
  navigate.mockReset();
  invalidateRoute.mockReset();
});

/** L2 / L2 on the engine's scale, about 50 %. */
const DECLARED = 0.5;

const reading = (mitreTechniqueId: string, tested: TechniqueTestOutcome | null): ControlTechniqueTestReading & CoveredTechniqueTestReading => ({
  covered: true,
  capabilityId: 'c1',
  function: 'prevent',
  mitreTechniqueId,
  techniqueExternalId: mitreTechniqueId.toUpperCase(),
  techniqueName: mitreTechniqueId,
  familyTechniqueId: mitreTechniqueId.split('.')[0],
  parentEfficacy: null,
  declaration: null,
  declared: DECLARED,
  efficacy: tested === null ? DECLARED : Math.min(DECLARED, (1 - tested.share) * DECLARED + tested.share * tested.rate),
  tested,
});

const LOWERED = reading('t1', { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 });
const CONFIRMED = reading('t2', { tests: 15, heldTests: 15, rate: 1, hostsTested: 15, scopeHosts: 20, share: 0.75 });
const UNTESTED = reading('t3', null);

const edge = (techniqueId: string, fn: CapabilityEdge['function']): CapabilityEdge => ({
  techniqueId,
  techniqueExternalId: techniqueId.toUpperCase(),
  techniqueName: techniqueId,
  function: fn,
  source: 'catalogue',
  state: 'recommended',
  tactics: [],
});

/** Renders the matrix once the stored test readings have loaded. */
const renderMatrix = async (edges: Array<CapabilityEdge>, readings: Array<ControlTechniqueTestReading> = []) => {
  const { calls, queryClient } = renderWithTrpc(
    <CapabilityTechniquesMatrix
      capabilityId="c1"
      controlExternalId="EDR"
      edges={edges}
      capabilityFunction="prevent"
      isReachable
    />,
    { answers: { 'controlValidation.getControlTechniqueTestReadings': readings } },
  );
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  await act(async () => {});
  return { calls };
};

const paperHeading = () => screen.queryByRole('heading', { name: 'Techniques' });

describe('CapabilityTechniquesMatrix', () => {
  it('should carry its actions in the paper header, leaving the toolbar its filters', async () => {
    await renderMatrix([edge('t1', 'prevent')]);

    const paper = paperHeading()?.closest('section');
    expect(pageProps.current?.headerActions).toBeUndefined();
    expect(pageProps.current?.segments?.map((segment) => segment.key)).toEqual(['all', 'confirmed', 'lowered', 'untested', 'uncovered']);
    expect(paper?.querySelector('[data-testid="page"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Link a technique' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset the prevention links to catalogue recommendations' })).toBeTruthy();
  });

  it('should offer no result filter where OpenAEV can test nothing and has no result', async () => {
    validation.isAvailable = false;

    await renderMatrix([edge('t1', 'prevent')]);

    expect(pageProps.current?.segments).toBeUndefined();
    expect(pageProps.current?.columns.map((column) => column.id)).toEqual(['techniqueExternalId', 'state', 'engineEfficacy', 'engineEfficacyExplanation', 'actions']);
  });

  it('should offer them wherever a stored result exists, the connector gone or never set', async () => {
    validation.isAvailable = false;

    await renderMatrix([edge('t1', 'prevent')], [LOWERED]);

    expect(pageProps.current?.segments?.map((segment) => segment.key)).toEqual(['all', 'confirmed', 'lowered', 'untested', 'uncovered']);
  });

  it('should read the result and the engine efficacy in place of the function, which the tab already says', async () => {
    const { calls } = await renderMatrix([edge('t1', 'prevent')], [LOWERED]);

    expect(pageProps.current?.columns.map((column) => column.id)).toEqual(['techniqueExternalId', 'state', 'openaevResult', 'engineEfficacy', 'engineEfficacyExplanation', 'actions']);
    expect(calls).toContainEqual(expect.objectContaining({
      path: 'controlValidation.getControlTechniqueTestReadings',
      input: { capabilityId: 'c1', function: 'prevent', organizationId: null },
    }));
  });

  it('should count the covered techniques the tests confirm, lower and leave untested, a removed one under all alone', async () => {
    await renderMatrix(
      [edge('t1', 'prevent'), edge('t2', 'prevent'), edge('t3', 'prevent'), edge('t4', 'prevent'), { ...edge('t5', 'prevent'), state: 'removed' }],
      [LOWERED, CONFIRMED, UNTESTED],
    );

    expect(pageProps.current?.segments?.map(({ key, count }) => [key, count])).toEqual([
      ['all', 5], ['confirmed', 1], ['lowered', 1], ['untested', 2], ['uncovered', 0],
    ]);
  });

  it('should narrow the table and the matrix to the techniques the tests lowered', async () => {
    await renderMatrix([edge('t1', 'prevent'), edge('t2', 'prevent'), edge('t3', 'prevent')], [LOWERED, CONFIRMED, UNTESTED]);

    act(() => pageProps.current?.onSegmentChange?.('lowered'));

    expect(pageProps.current?.data.map((row) => row.id)).toEqual(['t1']);
    expect(pageProps.current?.highlightedTechniques.map((cell) => cell.id)).toEqual(['t1']);
  });

  it('should put the efficacy, the declared and the OpenAEV bars on a tested cell, and nothing on an untested one', async () => {
    await renderMatrix([edge('t1', 'prevent'), edge('t3', 'prevent')], [LOWERED, UNTESTED]);

    const [lowered, untested] = pageProps.current?.highlightedTechniques ?? [];
    expect(lowered).toMatchObject({
      marker: '30%',
      categoryLabel: 'Covered · lowered by the tests',
      tooltipExtra: [
        { label: 'Engine efficacy', value: '30%' },
        { label: 'Declared', value: '50%' },
        { label: 'OpenAEV', value: '1/10 tests succeeded (10%) · 10/20 hosts tested (50%)' },
      ],
      tooltipHint: 'Click for the calculation',
      keepsHue: true,
    });
    expect(lowered.bars?.map((bar) => bar.label)).toEqual(['Declared 50%', 'OpenAEV 10%']);
    expect(lowered.markerColor).toBeDefined();
    expect(untested).toEqual({ id: 't3', color: 'blue', categoryLabel: 'Covered', tooltipExtra: undefined });
    expect(pageProps.current?.matrixHeader).toBeDefined();
  });

  it('should open the efficacy\'s explanation from a tested cell', async () => {
    await renderMatrix([edge('t1', 'prevent')], [LOWERED]);

    const [lowered] = pageProps.current?.highlightedTechniques ?? [];
    render(<>{lowered.renderLink?.({ className: '', children: 'T1 cell' })}</>);
    fireEvent.click(screen.getByRole('button', { name: 'T1 cell' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('EDR · T1 t1 · Prevention')).toBeTruthy();
    expect(within(dialog).getByText('Lowered by the tests')).toBeTruthy();
    expect(within(dialog).getByText('1/10 tests succeeded')).toBeTruthy();
  });

  describe('the way to the evidence', () => {
    const openCellDialog = (techniqueId: string) => {
      const cell = pageProps.current?.highlightedTechniques.find((candidate) => candidate.id === techniqueId);
      render(<>{cell?.renderLink?.({ className: '', children: `${techniqueId} cell` })}</>);
      fireEvent.click(screen.getByRole('button', { name: `${techniqueId} cell` }));
      return screen.getByRole('dialog');
    };

    it('should lead a tested result to the control\'s evidence on its technique, sub-techniques included', async () => {
      await renderMatrix([edge('t1', 'prevent')], [LOWERED]);

      fireEvent.click(within(openCellDialog('t1')).getByRole('button', { name: 'See the tests in EDR › Validation' }));

      expect(navigate).toHaveBeenCalledWith({
        from: '/$tenantId/{-$organizationId}',
        to: 'controls/$controlId/validation',
        params: { controlId: 'c1' },
        search: { technique: 'T1' },
      });
    });

    it('should lead a sub-technique to its family\'s evidence, listed on its parent', async () => {
      const parent = reading('t1055', { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 });
      await renderMatrix([edge('t1055.012', 'prevent')], [{ ...parent, mitreTechniqueId: 't1055.012' }]);

      fireEvent.click(within(openCellDialog('t1055.012')).getByRole('button', { name: 'See the tests in EDR › Validation' }));

      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { technique: 'T1055' } }));
    });

    it('should offer none where the control\'s validation cannot be listed, its result stored all the same', async () => {
      validation.isAvailable = false;
      await renderMatrix([edge('t1', 'prevent')], [LOWERED]);

      expect(within(openCellDialog('t1')).queryByRole('button', { name: /See the tests/ })).toBeNull();
    });

    it('should offer none without a result', async () => {
      await renderMatrix([edge('t3', 'prevent'), edge('t1', 'prevent')], [UNTESTED, LOWERED]);
      const efficacy = pageProps.current?.columns.find((column) => column.id === 'engineEfficacyExplanation');
      render(<I18nProvider i18n={i18n}>{efficacy?.cell?.({ row: { original: { ...edge('t3', 'prevent'), id: 't3', kind: 'edge' } }, table: tableShowing() })}</I18nProvider>);

      fireEvent.click(screen.getByRole('button', { name: 'How the engine efficacy of EDR on T3 is computed' }));

      expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /See the tests/ })).toBeNull();
    });
  });

  it('should leave the "i" column empty while the reader hides the figure it explains', async () => {
    await renderMatrix([edge('t1', 'prevent')], [LOWERED]);
    const explanation = pageProps.current?.columns.find((column) => column.id === 'engineEfficacyExplanation');
    const original = { ...edge('t1', 'prevent'), id: 't1', kind: 'edge' as const };

    render(<I18nProvider i18n={i18n}><div data-testid="shown">{explanation?.cell?.({ row: { original }, table: tableShowing() })}</div></I18nProvider>);
    render(<I18nProvider i18n={i18n}><div data-testid="hidden">{explanation?.cell?.({ row: { original }, table: tableShowing(['engineEfficacy']) })}</div></I18nProvider>);

    expect(within(screen.getByTestId('shown')).getByRole('button', { name: /How the engine efficacy of EDR on T1/ })).toBeTruthy();
    expect(screen.getByTestId('hidden').childElementCount).toBe(0);
  });

  it('should keep a confirmed figure in the default tone', async () => {
    await renderMatrix([edge('t2', 'prevent')], [CONFIRMED]);

    expect(pageProps.current?.highlightedTechniques[0]).toMatchObject({ marker: '50%', categoryLabel: 'Covered · confirmed by the tests', markerColor: undefined });
  });

  it('should hold the empty state in the paper with a single add button', async () => {
    await renderMatrix([edge('t1', 'detect')]);

    expect(paperHeading()).not.toBeNull();
    expect(screen.getByText('This control does not prevent any technique.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Link a technique' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reset the prevention links to catalogue recommendations' })).toBeNull();
  });

  describe('sub-techniques', () => {
    const T1055 = reading('t1055', { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 });
    /** T1055.012's own two tests, both held: confirmed while its parent is lowered. */
    const T1055_012 = {
      ...reading('t1055.012', { tests: 2, heldTests: 2, rate: 1, hostsTested: 2, scopeHosts: 20, share: 0.1 }),
      parentEfficacy: T1055.efficacy,
    };
    const T1055_001 = { ...reading('t1055.001', null), parentEfficacy: T1055.efficacy };
    const resultCell = (techniqueId: string) => {
      const column = pageProps.current?.columns.find((candidate) => candidate.id === 'openaevResult');
      render(<I18nProvider i18n={i18n}><div data-testid={techniqueId}>{column?.cell?.({ row: { original: { ...edge(techniqueId, 'prevent'), id: techniqueId, kind: 'edge' } } })}</div></I18nProvider>);
      return screen.getByTestId(techniqueId).textContent;
    };

    it('should list each one as a row of its own, counted and filtered on its own reading', async () => {
      await renderMatrix(
        [edge('t1055', 'prevent'), edge('t1055.012', 'prevent'), edge('t1055.001', 'prevent'), edge('t3', 'prevent')],
        [T1055, T1055_012, T1055_001, UNTESTED],
      );

      expect(pageProps.current?.data.map((row) => row.id)).toEqual(['t1055', 't1055.012', 't1055.001', 't3']);
      expect(pageProps.current?.segments?.map(({ key, count }) => [key, count])).toEqual([
        ['all', 4], ['confirmed', 1], ['lowered', 1], ['untested', 2], ['uncovered', 0],
      ]);
    });

    it('should read a sub-technique on its own tests, never its parent\'s', async () => {
      await renderMatrix([edge('t1055', 'prevent'), edge('t1055.012', 'prevent')], [T1055, T1055_012]);

      expect(resultCell('t1055')).toBe('1/10 tests succeeded (10%)10/20 hosts tested (50%)');
      expect(resultCell('t1055.012')).toBe('2/2 tests succeeded (100%)2/20 hosts tested (10%)');
    });

    it('should colour a sub-technique\'s cell on its own verdict', async () => {
      await renderMatrix([edge('t1055', 'prevent'), edge('t1055.012', 'prevent')], [T1055, T1055_012]);

      const [parent, sub] = pageProps.current?.highlightedTechniques ?? [];
      expect(parent).toMatchObject({ categoryLabel: 'Covered · lowered by the tests', marker: '30%' });
      expect(sub).toMatchObject({ categoryLabel: 'Covered · confirmed by the tests', marker: '50%', markerColor: undefined });
    });

    it('should name in its dialog the parent the engine prices, and its efficacy there', async () => {
      await renderMatrix([edge('t1055.012', 'prevent')], [T1055_012]);
      const cell = pageProps.current?.highlightedTechniques.find((candidate) => candidate.id === 't1055.012');
      render(<>{cell?.renderLink?.({ className: '', children: 'T1055.012 cell' })}</>);
      fireEvent.click(screen.getByRole('button', { name: 'T1055.012 cell' }));

      expect(within(screen.getByRole('dialog')).getByText('The engine prices T1055, where this control reads 30%.')).toBeTruthy();
    });

    it('should read a sub-technique with no test of its own as not tested, whatever its parent\'s', async () => {
      await renderMatrix([edge('t1055', 'prevent'), edge('t1055.001', 'prevent')], [T1055, T1055_001]);

      expect(resultCell('t1055.001')).toBe('Not tested');
      expect(pageProps.current?.highlightedTechniques.find((cell) => cell.id === 't1055.001')).toEqual({ id: 't1055.001', color: 'blue', categoryLabel: 'Covered', tooltipExtra: undefined });
    });
  });

  it('should confirm a result its whole percent leaves at the declaration, in the default tone: T1055.012, 1 held of 2 on 2 hosts of 20', async () => {
    const tested = { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 };
    await renderMatrix([edge('t1055.012', 'prevent')], [{ ...reading('t1055.012', tested), declared: 0.503, efficacy: 0.503 - 0.1 * 0.003 }]);

    expect(pageProps.current?.highlightedTechniques[0]).toMatchObject({ marker: '50%', categoryLabel: 'Covered · confirmed by the tests', markerColor: undefined });
    expect(pageProps.current?.segments?.find((segment) => segment.key === 'confirmed')?.count).toBe(1);
  });

  describe('the techniques the engine does not read for the control', () => {
    const FAILED: TechniqueTestOutcome = { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 20, share: 0.05 };
    const uncovered = (mitreTechniqueId: string, tested: TechniqueTestOutcome | null): ControlTechniqueTestReading => ({
      covered: false,
      capabilityId: 'c1',
      function: 'prevent',
      mitreTechniqueId,
      techniqueExternalId: mitreTechniqueId.toUpperCase(),
      techniqueName: mitreTechniqueId,
      familyTechniqueId: mitreTechniqueId.split('.')[0],
      tested,
    });
    const cellOf = (columnId: string, original: CapabilityEdge & { id: string, kind: 'edge' | 'tested' }) => {
      const column = pageProps.current?.columns.find((candidate) => candidate.id === columnId);
      render(<I18nProvider i18n={i18n}><div data-testid={`${columnId}-${original.id}`}>{column?.cell?.({ row: { original } })}</div></I18nProvider>);
      return screen.getByTestId(`${columnId}-${original.id}`);
    };

    it('should list a tested technique with no edge as a row of its own, counted under its own filter, warned about and with a way to link it', async () => {
      await renderMatrix([edge('t1', 'prevent'), edge('t2', 'prevent')], [LOWERED, CONFIRMED, uncovered('t1566', FAILED)]);

      expect(pageProps.current?.data.map((row) => row.id)).toEqual(['t1', 't2', 't1566']);
      expect(pageProps.current?.segments?.map(({ key, count }) => [key, count])).toEqual([
        ['all', 3], ['confirmed', 1], ['lowered', 1], ['untested', 0], ['uncovered', 1],
      ]);
      const row = { ...edge('t1566', 'prevent'), id: 't1566', kind: 'tested' as const };
      expect(cellOf('openaevResult', row).textContent).toBe('0/1 test succeeded (0%)1/20 hosts tested (5%)');
      const efficacy = cellOf('engineEfficacy', row).textContent;
      expect(efficacy).toBe('Not declared');
      expect(efficacy).not.toContain('Declared ');
      expect(within(cellOf('actions', row)).getByRole('button', { name: 'Link' })).toBeTruthy();
    });

    it('should narrow the table and the matrix to them, a removed technique OpenAEV tested included', async () => {
      await renderMatrix(
        [edge('t1', 'prevent'), { ...edge('t5', 'prevent'), state: 'removed' }],
        [LOWERED, uncovered('t5', FAILED), uncovered('t1566', FAILED)],
      );

      act(() => pageProps.current?.onSegmentChange?.('uncovered'));

      expect(pageProps.current?.data.map((row) => row.id)).toEqual(['t5', 't1566']);
      expect(pageProps.current?.highlightedTechniques.map((cell) => cell.id)).toEqual(['t5', 't1566']);
    });

    it('should give them a cell of their own in the warning tone, with the result alone', async () => {
      await renderMatrix([edge('t1', 'prevent')], [LOWERED, uncovered('t1566', FAILED)]);

      const cell = pageProps.current?.highlightedTechniques.find((candidate) => candidate.id === 't1566');
      expect(cell).toMatchObject({
        categoryLabel: 'Tested, not declared',
        accent: 'var(--fds-color-feedback-warning-primary)',
        tooltipExtra: [{ label: 'OpenAEV', value: '0/1 test succeeded (0%) · 1/20 hosts tested (5%)' }],
      });
      expect(cell?.marker).toBeUndefined();
      expect(cell?.bars?.map((bar) => bar.label)).toEqual(['OpenAEV 0%']);
    });

    it('should offer to link a technique OpenAEV tested the control on without its being linked, beside its evidence', async () => {
      await renderMatrix([edge('t1', 'prevent')], [LOWERED, uncovered('t1566', FAILED)]);
      const cell = pageProps.current?.highlightedTechniques.find((candidate) => candidate.id === 't1566');
      render(<>{cell?.renderLink?.({ className: '', children: 't1566 cell' })}</>);
      fireEvent.click(screen.getByRole('button', { name: 't1566 cell' }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Tested, not declared')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Declare on EDR' })).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'See the tests in EDR › Validation' })).toBeTruthy();
    });

    const declareFromCell = (techniqueId: string) => {
      const cell = pageProps.current?.highlightedTechniques.find((candidate) => candidate.id === techniqueId);
      render(<>{cell?.renderLink?.({ className: '', children: `${techniqueId} cell` })}</>);
      fireEvent.click(screen.getByRole('button', { name: `${techniqueId} cell` }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Declare on EDR' }));
    };

    /** What the fake server was asked, on a mutation of `controlCapabilities`. */
    const mutationInputs = (calls: Array<{ path: string, input: unknown, type: string }>, procedure: string) =>
      calls.filter((call) => call.type === 'mutation' && call.path === `controlCapabilities.${procedure}`).map((call) => call.input);

    it('should declare a technique it does not link on the control, then close the dialog and refresh the tab', async () => {
      const { calls } = await renderMatrix([edge('t1', 'prevent')], [LOWERED, uncovered('t1566', FAILED)]);

      declareFromCell('t1566');

      await waitFor(() => expect(invalidateRoute).toHaveBeenCalled());
      expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([{ capabilityId: 'c1', techniqueId: 't1566', function: 'prevent' }]);
      expect(mutationInputs(calls, 'restoreTechnique')).toEqual([]);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('should restore a technique the control had unlinked rather than adding it again', async () => {
      const { calls } = await renderMatrix([edge('t1', 'prevent'), { ...edge('t5', 'prevent'), state: 'removed' }], [LOWERED, uncovered('t5', FAILED)]);

      declareFromCell('t5');

      await waitFor(() => expect(invalidateRoute).toHaveBeenCalled());
      expect(mutationInputs(calls, 'restoreTechnique')).toEqual([{ capabilityId: 'c1', techniqueId: 't5', function: 'prevent' }]);
      expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([]);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('should read an edge the engine does not read, untested, as not covered under all alone', async () => {
      await renderMatrix([edge('t1', 'prevent'), edge('t1055.012', 'prevent')], [LOWERED, uncovered('t1055.012', null)]);

      expect(pageProps.current?.segments?.map(({ key, count }) => [key, count])).toEqual([
        ['all', 2], ['confirmed', 0], ['lowered', 1], ['untested', 0], ['uncovered', 0],
      ]);
      expect(pageProps.current?.highlightedTechniques.find((cell) => cell.id === 't1055.012')).toMatchObject({ categoryLabel: 'Not covered', outlined: true });
    });

    it('should count a technique the engine reads with no edge, a phishing stage reached through a sub-technique, as a covered one', async () => {
      await renderMatrix([edge('t1566.001', 'prevent')], [uncovered('t1566.001', null), { ...LOWERED, mitreTechniqueId: 't1566', techniqueExternalId: 'T1566' }]);

      expect(pageProps.current?.data.map((row) => row.id)).toEqual(['t1566.001', 't1566']);
      expect(pageProps.current?.segments?.find((segment) => segment.key === 'lowered')?.count).toBe(1);
      expect(pageProps.current?.highlightedTechniques.find((cell) => cell.id === 't1566')).toMatchObject({ categoryLabel: 'Covered · lowered by the tests' });
    });
  });
});
