import { Alert } from '@filigran/design-system';
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

const HiddenThreatsNotice: FunctionComponent = () => (
  <Alert
    elevation={1}
    severity="warning"
    title={t`Some threats may be hidden from you.`}
    description={t`OpenCRQ could not read what you are allowed to see in OpenCTI, so it lists threats from OpenCTI only when they carry no marking and no sharing restriction. Ask an administrator to check that your OpenCTI account exists and that OpenCTI accepts sign-in from this platform.`}
  />
);

interface ThreatListPageProps {
  /** Threats the list admits before their outcome probability, CVEs and techniques are computed. */
  pending: number,
  /** OpenCTI did not answer for the reader, so the list is short of the threats they may hold there. */
  readerScopeUnresolved: boolean,
  catalogEmpty: boolean,
  emptyState: ReactNode,
  kpiBand: ReactNode,
  uploadAction: ReactNode,
  backfillStatus: ReactNode,
  children: ReactNode,
}

export const ThreatListPage: FunctionComponent<ThreatListPageProps> = ({
  pending,
  readerScopeUnresolved,
  catalogEmpty,
  emptyState,
  kpiBand,
  uploadAction,
  backfillStatus,
  children,
}) => {
  const notice = readerScopeUnresolved ? <HiddenThreatsNotice /> : null;
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
