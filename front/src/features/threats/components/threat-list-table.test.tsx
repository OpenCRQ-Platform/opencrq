/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ThreatListRow } from './threat-list-table';
import { ThreatListTable } from './threat-list-table';
import { THREAT_LIST_INITIAL_COLUMN_VISIBILITY } from './threat-list-utils';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ROW: ThreatListRow = {
  id: '0196f0b0-0000-7000-8000-000000000001',
  stixId: 'intrusion-set--1',
  name: 'APT28',
  entityType: 'intrusion-set',
  kind: 'connector',
  mitreGroupId: 'G0007',
  stixCreated: '2020-01-15',
  updatedAt: '2026-11-04',
  cveCount: 86,
  techniqueCount: 94,
  activityScore: 0,
  lastObservedAt: '2026-10-28',
  topOutcomeName: 'Customer data exfiltration',
  topOutcomeScore: 0.82,
};

const PENDING_ROW: ThreatListRow = {
  ...ROW,
  id: '0196f0b0-0000-7000-8000-000000000002',
  name: 'Operation Dream Job',
  entityType: 'campaign',
  kind: 'stix-import',
  mitreGroupId: null,
  cveCount: null,
  techniqueCount: null,
  lastObservedAt: null,
  topOutcomeName: null,
  topOutcomeScore: null,
};

const renderTable = (data: Array<ThreatListRow>, onDeleteItems?: (ids: Array<string>) => void) => render(
  <ThreatListTable
    data={data}
    total={data.length}
    pageIndex={0}
    isFetching={false}
    isLoading={false}
    isPlaceholderData={false}
    storageKey={`threat-list-table-test-${onDeleteItems ? 'deletable' : 'read-only'}`}
    serverSorted
    showOutcomeColumn
    catalog
    initialColumnVisibility={THREAT_LIST_INITIAL_COLUMN_VISIBILITY}
    onDeleteItems={onDeleteItems}
  />,
);

const rowOf = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('tr');
  if (!row) {
    throw new Error(`no row for ${name}`);
  }
  return row;
};

const headers = (): Array<string> => screen.getAllByRole('columnheader').map((header) => header.textContent?.trim() ?? '');

describe('ThreatListTable catalog columns', () => {
  it('reads the name alone, the type with its icon, the source and the last observation date on the row', () => {
    renderTable([ROW]);
    const row = rowOf('APT28');

    expect(within(row).queryByText('G0007')).toBeNull();
    const type = within(row).getByText('Intrusion set').closest('td');
    expect(type?.querySelector('svg.lucide-diamond')).not.toBeNull();
    expect(row.querySelectorAll('svg.lucide-diamond')).toHaveLength(1);
    expect(within(row).getByText('OpenCTI')).toBeTruthy();
    expect(within(row).getByTitle('Last observation')).toBeTruthy();
    expect(within(row).getByText('82%')).toBeTruthy();
  });

  it('keeps the name on one line, cut with an ellipsis', () => {
    renderTable([ROW]);

    const name = screen.getByText('APT28');
    expect(name.classList.contains('truncate')).toBe(true);
    expect(name.getAttribute('title')).toBe('APT28');
  });

  it('shows the source by default and leaves both dates out', () => {
    renderTable([ROW]);

    expect(headers()).toEqual(expect.arrayContaining(['Name', 'Type', 'Top outcome', 'Observed activity', 'CVE', 'TTP', 'Source']));
    expect(headers()).not.toContain('Original Creation Date');
    expect(headers()).not.toContain('Last Updated');
    expect(headers()).not.toContain('MITRE Group ID');
  });

  it('marks what processing has not computed yet and names an import as such', () => {
    renderTable([PENDING_ROW]);
    const row = rowOf('Operation Dream Job');

    expect(within(row).getAllByText('Calculating…')).toHaveLength(3);
    expect(within(row).getByText('STIX import')).toBeTruthy();
    expect(within(row).getByText('Not dated')).toBeTruthy();
    expect(within(row).queryByTitle('Last observation')).toBeNull();
  });

  it('words the activity as a status beside the last observation date', () => {
    const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);
    renderTable([
      { ...ROW, lastObservedAt: daysAgo(5) },
      { ...PENDING_ROW, name: 'FIN7', lastObservedAt: daysAgo(400) },
    ]);

    expect(within(rowOf('APT28')).getByText('Active')).toBeTruthy();
    expect(within(rowOf('APT28')).getByTitle('Last observation')).toBeTruthy();
    expect(within(rowOf('FIN7')).getByText('Dormant')).toBeTruthy();
    expect(within(rowOf('FIN7')).getByTitle('Last observation')).toBeTruthy();
  });

  it('puts the marks of the same threat in the other XTM products beside its name', () => {
    render(
      <ThreatListTable
        data={[ROW]}
        isLoading={false}
        storageKey="threat-list-table-test-marks"
        catalog
        renderRowMarks={(row) => <a href={`https://opencti.example/${row.stixId}`}>{`mark ${row.stixId}`}</a>}
      />,
    );

    const name = screen.getByText('APT28').closest('td');
    expect(within(name!).getByRole('link', { name: 'mark intrusion-set--1' })).toBeTruthy();
  });

  it('offers a checkbox per row when the rows can be deleted', () => {
    renderTable([ROW, PENDING_ROW], vi.fn());

    expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ThreatListTable summary columns', () => {
  it('lists the summary columns when the catalog ones are not asked for', () => {
    render(<ThreatListTable data={[ROW]} isLoading={false} storageKey="threat-list-table-test-original" />);

    expect(headers()).toEqual(['Name', 'Type', 'MITRE ID', 'CVE', 'TTP', 'Observed activity', 'Original Creation Date', 'Last Updated']);
    expect(rowOf('APT28').querySelector('svg.lucide-diamond')).toBeNull();
  });
});
