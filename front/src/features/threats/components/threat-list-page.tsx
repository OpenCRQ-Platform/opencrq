import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { DetailPageLayout } from '../../../components/shared/detail-page-layout';
import { ImportProgressIndicator } from '../../../components/shared/import-progress-indicator';

const ThreatsProcessingIndicator: FunctionComponent<{ pending: number }> = ({ pending }) => (
  pending > 0
    ? (
      <ImportProgressIndicator
        label={plural(pending, { one: '# threat being processed', other: '# threats being processed' })}
        detail={<Trans>Their outcome probability, CVEs and techniques fill in once processing ends.</Trans>}
      />
    )
    : null
);

interface ThreatListPageProps {
  /** Threats the list admits before their outcome probability, CVEs and techniques are computed. */
  pending: number,
  catalogEmpty: boolean,
  emptyState: ReactNode,
  kpiBand: ReactNode,
  uploadAction: ReactNode,
  backfillStatus: ReactNode,
  children: ReactNode,
}

export const ThreatListPage: FunctionComponent<ThreatListPageProps> = ({
  pending,
  catalogEmpty,
  emptyState,
  kpiBand,
  uploadAction,
  backfillStatus,
  children,
}) => {
  // The empty card carries the upload action itself.
  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ThreatsProcessingIndicator pending={pending} />
      {backfillStatus}
      {catalogEmpty ? null : uploadAction}
    </div>
  );

  if (catalogEmpty) {
    return <DetailPageLayout title={t`Threats`} actions={actions}>{emptyState}</DetailPageLayout>;
  }

  return (
    <DetailPageLayout title={t`Threats`} actions={actions}>
      {kpiBand}
      {children}
    </DetailPageLayout>
  );
};
