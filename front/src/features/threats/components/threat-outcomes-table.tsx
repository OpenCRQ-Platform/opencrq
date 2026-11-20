import { Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DebouncedSearchField, OutcomeScoreBadge, SectionCard } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils/date-utils';
import { weighsOnOutcome } from './relevance-proof-utils';
import { selectOutcomeRows } from './threat-overview-utils';

const PAGE_SIZE = 20;

interface OutcomeRow {
  id: string,
  name: string,
  score: number,
}

interface ThreatOutcomesTableProps {
  analysisId: string,
}

/**
 * Every attack outcome of the tenant with the probability stored for this threat, highest first,
 * the ones the threat weighs on marked, each name leading to the outcome's own page. A threat
 * without minimum evidence has no percentages to show. The card says once that they were judged when
 * every one is: a partial judgment leaves some to the counter, which a single line would mislabel.
 */
export const ThreatOutcomesTable: FunctionComponent<ThreatOutcomesTableProps> = ({ analysisId }) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.threats.getOutcomeScoresForAnalysis.queryOptions({ analysisId }));
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const outcomes = (data ?? []).flatMap((outcome) => (outcome.score === null ? [] : [{ ...outcome, score: outcome.score }]));
  const judgedOn = outcomes.length > 0 && outcomes.every((outcome) => outcome.judgedOn !== null) ? outcomes[0].judgedOn : null;
  const judgedOnLabel = judgedOn === null ? null : formatDate(judgedOn);
  const { rows, unmatchedCount } = selectOutcomeRows(outcomes, search, showUnmatched);
  const tableRows: Array<OutcomeRow> = rows.map((outcome) => ({ id: outcome.attackOutcomeId, name: outcome.outcomeName, score: outcome.score }));

  const columns: Array<ColumnDefWithOptionsHeader<OutcomeRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Attack outcome`,
      cell: ({ row }): ReactElement => {
        const { id, name, score } = row.original;
        return (
          <span className="flex items-center gap-2">
            <Link
              from="/$tenantId/{-$organizationId}"
              to="/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId"
              params={{ attackOutcomeId: id }}
              title={name}
              className="block max-w-full truncate whitespace-nowrap rounded font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {name}
            </Link>
            {weighsOnOutcome({ probability: score, evidenceSufficient: true }) && <Chip label={t`Weighs on`} />}
          </span>
        );
      },
    },
    {
      id: 'score',
      accessorKey: 'score',
      header: t`Probability`,
      size: 180,
      cell: ({ row }): ReactElement => <OutcomeScoreBadge score={row.original.score} />,
    },
  ];

  const emptyMessage = (): string => {
    if ((data ?? []).length === 0) {
      return t`No attack outcome defined for this tenant.`;
    }
    if (outcomes.length === 0) {
      return t`Not enough data on this threat to assess its attack outcomes.`;
    }
    if (unmatchedCount === 0) {
      return t`No attack outcome matches this search.`;
    }
    return search.trim() === ''
      ? t`This threat matches none of your attack outcomes.`
      : t`This search only finds outcomes this threat does not match.`;
  };

  return (
    <SectionCard title={t`Attack outcomes`} className="h-full" cardClassName="flex-1">
      <div className="flex flex-col gap-2">
        {judgedOnLabel !== null && <p className="txt-sub-content text-muted-foreground">{t`Judged by OpenCRQ on ${judgedOnLabel}`}</p>}
        <DataPageLayout
          data={tableRows}
          columns={columns}
          isLoading={isLoading}
          storageKey="threat-overview-attack-outcomes"
          initialPageSize={PAGE_SIZE}
          pageIndex={pageIndex}
          onServerPageChange={(pagination) => setPageIndex(pagination.pageIndex)}
          initialSorting={[{ id: 'score', desc: true }]}
          leftHeaderContent={(
            <DebouncedSearchField
              value={search}
              onCommit={(next) => {
                setSearch(next);
                setPageIndex(0);
              }}
              clearLabel={t`Clear the search`}
              aria-label={t`Search for an attack outcome`}
              placeholder={t`Search for an attack outcome`}
              className="w-64"
            />
          )}
          emptyState={<p className="txt-sub-content text-muted-foreground">{emptyMessage()}</p>}
        />
        {unmatchedCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowUnmatched((shown) => !shown);
              setPageIndex(0);
            }}
            aria-expanded={showUnmatched}
            className="self-start txt-sub-content text-filigran-brand-primary hover:underline"
          >
            {showUnmatched
              ? plural(unmatchedCount, { one: 'Hide the # outcome with no match', other: 'Hide the # outcomes with no match' })
              : plural(unmatchedCount, { one: 'Show the # outcome with no match', other: 'Show the # outcomes with no match' })}
          </button>
        )}
      </div>
    </SectionCard>
  );
};
