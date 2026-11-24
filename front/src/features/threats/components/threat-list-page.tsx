import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import type { ReaderAccessIssue } from '../../xtm/use-reader-access';
import { DetailPageLayout } from '../../../components/shared/detail-page-layout';
import { ImportProgressIndicator } from '../../../components/shared/import-progress-indicator';
import { ReaderAccessNotice } from './hidden-threats-notice';

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
  /** Why the list may lack threats the reader can read in OpenCTI; null when it lacks none. */
  readerAccessIssue: ReaderAccessIssue | null,
  catalogEmpty: boolean,
  emptyState: ReactNode,
  kpiBand: ReactNode,
  uploadAction: ReactNode,
  backfillStatus: ReactNode,
  children: ReactNode,
}

export const ThreatListPage: FunctionComponent<ThreatListPageProps> = ({
  pending,
  readerAccessIssue,
  catalogEmpty,
  emptyState,
  kpiBand,
  uploadAction,
  backfillStatus,
  children,
}) => {
  const notice = readerAccessIssue ? <ReaderAccessNotice issue={readerAccessIssue} /> : null;
  // The empty card carries the upload action itself.
  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ThreatsProcessingIndicator pending={pending} />
      {backfillStatus}
      {catalogEmpty ? null : uploadAction}
    </div>
  );

  if (catalogEmpty) {
    return <DetailPageLayout title={t`Threats`} actions={actions}>{notice}{emptyState}</DetailPageLayout>;
  }

  return (
    <DetailPageLayout title={t`Threats`} actions={actions}>
      {notice}
      {kpiBand}
      {children}
    </DetailPageLayout>
  );
};
