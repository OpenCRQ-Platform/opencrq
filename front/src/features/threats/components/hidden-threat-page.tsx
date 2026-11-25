import { Alert, Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { DetailPageLayout } from '../../../components/shared/detail-page-layout';
import { useReaderAccess } from '../../xtm/use-reader-access';
import { ReaderAccessNotice } from './hidden-threats-notice';

/**
 * Why the threat is hidden, once the reader's access is answered: what kept OpenCRQ from reading
 * it for them, else the reader's own OpenCTI rights when those decide, else no cause at all (in the
 * connector's mode their rights play no part, and a failed answer tells nothing).
 */
const HiddenReason: FunctionComponent = () => {
  const { threats, threatVisibility, isPending } = useReaderAccess();
  if (isPending) {
    return null;
  }
  if (threats) {
    return <ReaderAccessNotice issue={threats} />;
  }
  if (threatVisibility === 'per_member') {
    return (
      <Alert
        severity="info"
        title={t`OpenCTI does not let you read this threat.`}
        description={t`This threat exists, but your rights in OpenCTI do not allow you to read it, so OpenCRQ does not show it. If you need it, ask an OpenCTI administrator for access.`}
      />
    );
  }
  return (
    <Alert
      severity="info"
      title={t`You cannot read this threat.`}
      description={t`This threat exists, but OpenCRQ does not show it to you. If you need it, ask an administrator.`}
    />
  );
};

/** What a link to a threat the reader's OpenCTI rights hide opens, in place of "not found": it says the threat exists, and why it is hidden. */
export const HiddenThreatPage: FunctionComponent = () => (
  <DetailPageLayout
    title={t`This threat is hidden from you`}
    actions={(
      <Button asChild priority="secondary">
        <Link to="/$tenantId/{-$organizationId}/threat-center" params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '' })}>
          {t`See all threats`}
        </Link>
      </Button>
    )}
  >
    <HiddenReason />
  </DetailPageLayout>
);
