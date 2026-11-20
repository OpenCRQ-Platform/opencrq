/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValidationEvidenceLine } from '../types/validation';
import { renderWithTrpc } from '../../../../providers/trpc-test-harness';
import { CapabilityValidationEvidence } from './capability-validation-evidence';

const setFilters = vi.fn();
let search: Record<string, unknown> = {};

vi.mock('../../../../hooks', () => ({
  usePersistedPageSize: (_id: string, pageSize: number) => ({ pageSize }),
  usePersistedSorting: (_id: string, sorting: Array<{ id: string, desc: boolean }>) => ({ sorting }),
  useUrlListFilters: (schema: z.ZodType) => ({ filters: schema.parse(search), setFilters }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useParams: () => ({}),
}));

interface Option { value: string, label: string }

vi.mock('../../../../components/shared', () => ({
  SingleSelectField: ({ label, placeholder, options, value, onChange }: {
    label: string, placeholder: string, options: Array<Option>, value: string | null, onChange: (value: string | null) => void,
  }) => (
    <select aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('../../../../components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SelectItem: ({ children, value }: { children: ReactNode, value: string }) => <li data-value={value}>{children}</li>,
}));

interface Column<T> { id: string, cell: (context: { row: { original: T } }) => ReactNode }

vi.mock('../../../../components/ui/data-page-layout', () => ({
  DataPageLayout: <T extends { id: string }>({ data, columns, leftHeaderContent, emptyState, onServerPageChange }: {
    data: Array<T>,
    columns: Array<Column<T>>,
    leftHeaderContent?: ReactNode,
    emptyState?: ReactNode,
    onServerPageChange: (pagination: { pageIndex: number }) => void,
  }) => (
    <div>
      {leftHeaderContent}
      <button type="button" onClick={() => onServerPageChange({ pageIndex: 1 })}>Next page</button>
      {data.length === 0 ? emptyState : data.map((row) => (
        <div key={row.id} data-testid="row">
          {columns.map((column) => <div key={column.id} data-column={column.id}>{column.cell({ row: { original: row } })}</div>)}
        </div>
      ))}
    </div>
  ),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LINE: ValidationEvidenceLine = {
  techniqueId: '00000000-0000-0000-0000-0000000000a1',
  techniqueExternalId: 'T1027',
  function: 'prevent',
  scenarioId: 'scenario-1',
  scenarioName: 'Ransomware drill',
  simulationId: 'simulation-1',
  securityPlatformType: 'EDR',
  verdict: 'validated',
  evaluatedAt: '2026-10-27T00:00:00.000Z',
  assetCounts: { validated: 120, contradicted: 0 },
};

const FAMILIES = [{ id: 'family-edr', platformTypeKey: 'EDR', name: 'Endpoint detection' }];

const TECHNIQUES = [{ externalId: 'T1027', name: 'Obfuscated Files or Information' }, { externalId: 'T1055', name: 'Process Injection' }];

const answer = (items: Array<ValidationEvidenceLine>, unfilteredTotal = items.length) => ({ items, total: items.length, unfilteredTotal });

const LINES_PATH = 'controlValidation.listControlValidationEvidence';

const evidence = () => (
  <CapabilityValidationEvidence capabilityId="00000000-0000-0000-0000-0000000000c1" securityPlatformFamilies={FAMILIES} openaevUrl={null} />
);

const renderEvidence = (lines: unknown = answer([LINE])) => {
  const rendered = renderWithTrpc(evidence(), {
    answers: {
      [LINES_PATH]: lines,
      'controlValidation.listControlValidationEvidenceTechniques': TECHNIQUES,
    },
  });
  const askedInput = () => rendered.calls.filter((call) => call.path === LINES_PATH).at(-1)?.input;
  return { ...rendered, askedInput };
};

describe('CapabilityValidationEvidence', () => {
  beforeEach(() => {
    search = {};
  });

  it('should show how many of a line\'s assets held, as a ratio of its function', async () => {
    renderEvidence(answer([LINE, { ...LINE, function: 'detect', verdict: 'contradicted', assetCounts: { validated: 3, contradicted: 1 } }]));

    const [prevented, detected] = (await screen.findAllByTestId('row')).map((row) => row.querySelector('[data-column="assets"] span'));
    expect(prevented?.textContent).toBe('120/120 prevented (100%)');
    expect(prevented?.className).not.toContain('text-destructive');
    expect(detected?.textContent).toBe('3/4 detected (75%)');
    expect(detected?.className).toContain('text-destructive');
  });

  it('should name each line\'s technique beside its id', async () => {
    renderEvidence();

    await waitFor(() => expect(screen.getByTestId('row').querySelector('[data-column="technique"]')?.textContent).toBe('T1027Obfuscated Files or Information'));
  });

  it('should ask the server for the lines the address filters on', async () => {
    search = { technique: 'T1055', function: 'detect', result: 'contradicted', family: 'EDR' };
    const { askedInput } = renderEvidence();

    await waitFor(() => expect(askedInput()).toMatchObject({ technique: 'T1055', function: 'detect', result: 'contradicted', securityPlatformType: 'EDR', page: 1 }));
  });

  it('should ask for every line when the address filters on nothing, or on values it cannot hold', async () => {
    search = { technique: '00000000-0000-0000-0000-0000000000a1', function: 'bogus', result: 'bogus', family: 'XDR' };
    const { askedInput } = renderEvidence();

    await waitFor(() => expect(askedInput()).toMatchObject({ technique: undefined, function: undefined, result: undefined, securityPlatformType: undefined }));
  });

  it('should offer the techniques of the lines by name, and write the one picked into the address', async () => {
    renderEvidence();

    const filter = screen.getByRole('combobox', { name: 'Filter by technique' });
    await waitFor(() => expect([...filter.querySelectorAll('option')].map((option) => option.textContent))
      .toEqual(['All techniques', 'T1027 – Obfuscated Files or Information', 'T1055 – Process Injection']));

    fireEvent.change(filter, { target: { value: 'T1055' } });
    expect(setFilters).toHaveBeenCalledWith({ technique: 'T1055' });

    fireEvent.change(filter, { target: { value: '' } });
    expect(setFilters).toHaveBeenLastCalledWith({ technique: undefined });
  });

  it('should go back to the first page when a filter changes', async () => {
    const { rerender, askedInput } = renderEvidence();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(askedInput()).toMatchObject({ page: 2 }));

    search = { result: 'contradicted' };
    rerender(evidence());

    await waitFor(() => expect(askedInput()).toMatchObject({ result: 'contradicted', page: 1 }));
  });

  it('should tell a filter that keeps no line apart from a control with no evidence', async () => {
    search = { function: 'detect' };
    renderEvidence(answer([], 3));
    expect(await screen.findByText('No evidence line matches the filters. Clear the filters to see every line.')).toBeTruthy();
    cleanup();

    search = {};
    renderEvidence(answer([], 0));
    expect(await screen.findByText('No simulation has produced evidence for this control yet.')).toBeTruthy();
  });
});
