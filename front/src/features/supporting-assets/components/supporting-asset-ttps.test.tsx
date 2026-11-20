/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { createTable, getCoreRowModel, getSortedRowModel } from '@tanstack/react-table';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import { FAILED, NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { SupportingAssetTtps } from './supporting-asset-ttps';

interface PageProps {
  data: Array<{ id: string, origin?: string }>,
  columns: Array<ColumnDef<{ id: string }>>,
  isLoading?: boolean,
  leftHeaderContent?: ReactNode,
  highlightedTechniques: Array<HighlightedTechnique>,
}

const pageProps: { current: PageProps | null } = { current: null };

vi.mock('../../../components/ui/data-page-layout', () => ({
  DataPageWithTtpMatrix: (props: PageProps) => {
    pageProps.current = props;
    return <div data-testid="page">{props.leftHeaderContent}</div>;
  },
}));

vi.mock('../../mitre-attack/components', () => ({
  createTechniqueColumn: () => ({ id: 'externalId', accessorKey: 'externalId' }),
  useTechniqueRowNavigate: () => vi.fn(),
}));

vi.mock('./technique-score-dialog', () => ({
  TechniqueScoreDialog: () => null,
}));

vi.mock('./technique-test-tiles', () => ({
  TechniqueTestTiles: () => null,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  pageProps.current = null;
});

const TECHNIQUES = [
  { id: 't1190', externalId: 'T1190', name: 'Exploit Public-Facing Application' },
  { id: 't1133', externalId: 'T1133', name: 'External Remote Services' },
  { id: 't1078', externalId: 'T1078', name: 'Valid Accounts' },
];

const scored = (id: string, externalId: string, score: number) => ({
  mitreTechniqueId: id,
  externalId,
  name: externalId,
  score,
  evidenceId: 'finding',
  source: 'finding',
  lane: 'curated',
});

const susceptible = (id: string, score: number) => ({
  mitreTechniqueId: id,
  externalId: 'T1566',
  name: 'Phishing',
  score,
  evidenceId: null,
  source: 'susceptibility',
  lane: null,
  susceptibility: { declared: false, expired: false, measuredOn: null, rate: 0.07 },
});

const NO_TESTS = { prevention: null, detection: null, techniques: [] };

/** Renders the tab once every read that is not left pending has settled, and returns the props the page got. */
const renderTab = async (scores: unknown, tests: unknown = NO_TESTS, applicable: Array<object> = []) => {
  const { queryClient } = renderWithTrpc(
    <SupportingAssetTtps categoryId="web_application" supportingAssetId="00000000-0000-0000-0000-0000000000a1" />,
    {
      answers: {
        'supportingAssets.getTechniquesByCategory': TECHNIQUES,
        'supportingAssets.getApplicableTechniquesForAsset': applicable,
        'findingScore.getAssetTechniqueScores': scores,
        'findingScore.getAssetTechniqueTests': tests,
      },
    },
  );
  const pendingReads = [scores, tests].filter((answer) => answer === NEVER).length;
  await waitFor(() => expect(queryClient.isFetching()).toBe(pendingReads));
  await act(async () => {});
  return pageProps.current;
};

const columnIds = (props: PageProps | null) => (props?.columns ?? []).map((column) => column.id);

describe('SupportingAssetTtps', () => {
  it('should show the page loading, not the empty state, while its reads are pending', () => {
    renderWithTrpc(<SupportingAssetTtps categoryId="web_application" supportingAssetId="00000000-0000-0000-0000-0000000000a1" />, {
      answers: {
        'supportingAssets.getTechniquesByCategory': NEVER,
        'supportingAssets.getApplicableTechniquesForAsset': NEVER,
        'findingScore.getAssetTechniqueScores': NEVER,
        'findingScore.getAssetTechniqueTests': NEVER,
      },
    });

    expect(pageProps.current?.isLoading).toBe(true);
    expect(screen.queryByText('No ATT&CK techniques associated')).toBeNull();
  });

  it('should keep the page loading until the scores are read', async () => {
    expect((await renderTab(NEVER))?.isLoading).toBe(true);
  });

  it('should say the scores could not be loaded rather than draw a dash for every technique', async () => {
    const props = await renderTab(FAILED);

    expect(screen.getByText('The technique scores could not be loaded.')).toBeTruthy();
    expect(columnIds(props)).not.toContain('score');
    expect(columnIds(props)).not.toContain('finding');
    expect(props?.isLoading).toBe(false);
  });

  it('should mark a technique with an applicable result as applicable, one outside the category included', async () => {
    const props = await renderTab({ techniques: [], findings: [] }, NO_TESTS, [
      { id: 't1133', externalId: 'T1133', name: 'External Remote Services' },
      { id: 't1059', externalId: 'T1059', name: 'Command and Scripting Interpreter' },
    ]);

    const origins = Object.fromEntries((props?.data ?? []).map((row) => [row.id, row.origin]));
    expect(origins).toEqual({ t1190: 'inherent', t1133: 'applicable', t1078: 'inherent', t1059: 'applicable' });
  });

  it('should draw the score and finding columns once the scores are read', async () => {
    const props = await renderTab({ techniques: [], findings: [] });

    expect(columnIds(props)).toEqual(expect.arrayContaining(['score', 'finding']));
    expect(screen.queryByText('The technique scores could not be loaded.')).toBeNull();
  });

  it('should sort an unscored technique after every score, in both directions', async () => {
    const props = await renderTab({ techniques: [scored('t1190', 'T1190', 98), scored('t1133', 'T1133', 0)], findings: [] });
    const sortedBy = (sorting: SortingState): Array<string> => {
      const table = createTable({
        data: props!.data,
        columns: props!.columns,
        state: { sorting, columnPinning: {}, columnVisibility: {}, columnOrder: [] },
        onStateChange: () => {},
        renderFallbackValue: null,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
      });
      return table.getSortedRowModel().rows.map((row) => row.original.id);
    };

    expect(sortedBy([{ id: 'score', desc: false }])).toEqual(['t1133', 't1190', 't1078']);
    expect(sortedBy([{ id: 'score', desc: true }])).toEqual(['t1190', 't1133', 't1078']);
  });

  it('should name the susceptibility, not a missing finding, on the phishing cell of a person', async () => {
    const props = await renderTab({ techniques: [susceptible('t1078', 7)], findings: [] });
    const column = props!.columns.find((candidate) => candidate.id === 'finding')!;
    const row = { original: props!.data.find((candidate) => candidate.id === 't1078') };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the cell reads only its row
    render(<I18nProvider i18n={i18n}>{(column.cell as (context: unknown) => ReactNode)({ row })}</I18nProvider>);

    expect(screen.getByText('Susceptibility')).toBeTruthy();
    expect(screen.queryByText('No finding')).toBeNull();
  });

  it('should keep the page loading until the OpenAEV results are read', async () => {
    expect((await renderTab({ techniques: [], findings: [] }, NEVER))?.isLoading).toBe(true);
  });

  it('should draw a prevention and a detection column after the score and the finding', async () => {
    const ids = columnIds(await renderTab({ techniques: [], findings: [] }));

    expect(ids.slice(-4)).toEqual(['score', 'finding', 'prevention', 'detection']);
  });

  describe('a matrix cell', () => {
    const TESTS = {
      prevention: { held: 23, total: 100 },
      detection: null,
      techniques: [
        { mitreTechniqueId: 't1190', prevention: null, detection: null },
        { mitreTechniqueId: 't1133', prevention: { held: 23, total: 100 }, detection: null },
      ],
    };
    const highlightOf = (props: PageProps | null, id: string) => props?.highlightedTechniques.find((technique) => technique.id === id);
    const barLabels = (highlight: HighlightedTechnique | undefined) => highlight?.bars?.map((bar) => bar.label);

    it('should read a vulnerability score beside two empty rows when OpenAEV never tested it', async () => {
      const highlight = highlightOf(await renderTab({ techniques: [scored('t1190', 'T1190', 98)], findings: [] }, TESTS), 't1190');

      expect(barLabels(highlight)).toEqual([
        'Vulnerability: 98 out of 100, Critical band',
        'Prevention: never tested here',
        'Detection: never tested here',
      ]);
      expect(highlight?.bars?.slice(1).map((bar) => bar.figure)).toEqual(['-', '-']);
      expect(highlight?.accent).toBeDefined();
    });

    it('should read the susceptibility of a person as such, never as a vulnerability', async () => {
      const highlight = highlightOf(await renderTab({ techniques: [susceptible('t1078', 7)], findings: [] }, TESTS), 't1078');

      expect(barLabels(highlight)?.[0]).toBe('Susceptibility: 7 out of 100, Low band');
    });

    it('should read the ratio, never the share, on a cell OpenAEV tested that no finding opens', async () => {
      const highlight = highlightOf(await renderTab({ techniques: [], findings: [] }, TESTS), 't1133');

      expect(barLabels(highlight)).toEqual([
        'Vulnerability: no finding',
        'Prevention: prevented 23/100 on this asset',
        'Detection: never tested here',
      ]);
      expect(highlight?.bars?.[1]).toMatchObject({ figure: '23/100', ratio: 0.23 });
      expect(highlight?.accent).toBeUndefined();
      expect(highlight?.renderLink).toBeDefined();
    });

    it('should stay as it is today with none of the three', async () => {
      const highlight = highlightOf(await renderTab({ techniques: [], findings: [] }, TESTS), 't1078');

      expect(highlight).toEqual({ id: 't1078', color: 'blue', categoryLabel: 'Inherent' });
    });
  });
});
