/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { UniqueFindingTableRow } from '../unique-findings-table-utils';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { uniqueFindingsTableColumns } from './unique-findings-table-columns';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const CVE_ROW: UniqueFindingTableRow = {
  id: 'k1',
  name: 'CVE-2023-4966',
  detail: 'Citrix Bleed',
  isTechnique: false,
  expectationType: null,
  score: 91,
  band: 'critical',
  worstScore: 85,
  worstBand: 'critical',
  pendingVector: false,
  nvdRecordMissing: false,
  affectedAssetCount: 3,
  knownExploited: true,
  epssPercent: 94,
  sources: [],
  ageDays: 4,
  vulnerabilityToken: 'CVE-2023-4966',
};

const TECHNIQUE_ROW: UniqueFindingTableRow = { ...CVE_ROW, id: 'k2', name: 'T1059', detail: 'Command and Scripting Interpreter', isTechnique: true, expectationType: 'detection' };

const renderNameCell = (row: UniqueFindingTableRow, renderRowMarks?: (r: UniqueFindingTableRow) => ReactElement) => {
  const [nameColumn] = uniqueFindingsTableColumns(renderRowMarks);
  return render(<DataPageLayout data={[row]} columns={[nameColumn]} storageKey="unique-findings-columns-test" hideToolbar />);
};

describe('uniqueFindingsTableColumns row marks', () => {
  it('should show the marks beside a CVE identifier', () => {
    renderNameCell(CVE_ROW, (r) => <a href={`https://opencti.example/${r.name}`}>{`mark ${r.name}`}</a>);

    expect(screen.getByText('CVE-2023-4966')).toBeTruthy();
    expect(screen.getByText('mark CVE-2023-4966')).toBeTruthy();
  });

  it('should never show marks on a technique row', () => {
    renderNameCell(TECHNIQUE_ROW, (r) => <span>{`mark ${r.name}`}</span>);

    expect(screen.getByText('T1059')).toBeTruthy();
    expect(screen.queryByText('mark T1059')).toBeNull();
  });

  it('should render the identifier alone without a marks renderer', () => {
    const { container } = renderNameCell(CVE_ROW);

    expect(screen.getByText('CVE-2023-4966')).toBeTruthy();
    expect(container.querySelector('a')).toBeNull();
  });
});
