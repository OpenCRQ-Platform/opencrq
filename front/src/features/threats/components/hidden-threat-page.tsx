import { Alert, Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { DetailPageLayout } from '../../../components/shared/detail-page-layout';
import { useReaderAccess } from '../../xtm/use-reader-access';
import { ReaderAccessNotice } from './hidden-threats-notice';

/**
 * What a link to a threat the reader's OpenCTI rights hide opens, in place of "not found": the
 * threat exists, which is all this page says of it. Once the reader's access is answered it says
 * what kept OpenCRQ from reading the threat for them; with no category to give (the reader's rights
 * play no part in the connector's mode, and a failed answer tells nothing) it names no cause.
 */
export const HiddenThreatPage: FunctionComponent = () => {
  const { threats, isPending } = useReaderAccess();
  return (
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
      {!isPending && (threats
        ? <ReaderAccessNotice issue={threats} />
        : (
          <Alert
            severity="info"
            title={t`You cannot read this threat.`}
            description={t`This threat exists, but OpenCRQ does not show it to you. If you need it, ask an administrator.`}
          />
        ))}
    </DetailPageLayout>
  );
};
