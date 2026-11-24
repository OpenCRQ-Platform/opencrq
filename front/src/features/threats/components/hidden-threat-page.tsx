import { Alert, Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { DetailPageLayout } from '../../../components/shared/detail-page-layout';
import { useReaderAccess } from '../../xtm/use-reader-access';
import { HiddenThreatsNotice } from './hidden-threats-notice';

/**
 * What a link to a threat the reader's OpenCTI rights hide opens, in place of "not found": the
 * threat exists, which is all this page says of it. Once the reader's access is known, it says why
 * it is hidden: their rights, or what kept OpenCRQ from learning them.
 */
export const HiddenThreatPage: FunctionComponent = () => {
  const { threats, isLoaded } = useReaderAccess();
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
      {isLoaded && (threats
        ? <HiddenThreatsNotice issue={threats} />
        : (
          <Alert
            severity="info"
            title={t`OpenCTI does not let you read this threat.`}
            description={t`This threat exists, but your rights in OpenCTI do not allow you to read it, so OpenCRQ does not show it. If you need it, ask an OpenCTI administrator for access.`}
          />
        ))}
    </DetailPageLayout>
  );
};
