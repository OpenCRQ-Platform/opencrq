import { Button } from '@filigran/design-system';
import { getRouteApi, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Building2 } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { ErrorPage } from './error-page';

const tenantRoute = getRouteApi('/_auth/$tenantId');

export const OrganizationNotFound: FunctionComponent = () => {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { tenant } = tenantRoute.useLoaderData();
  const navigate = useNavigate();
  const tenantName = tenant.name;

  return (
    <ErrorPage>
      <div className="relative mb-m mx-auto w-fit">
        <div className="absolute inset-0 rounded-full blur-xl bg-red/15" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red/10">
          <Building2 className="h-8 w-8 text-red/80" />
        </div>
      </div>
      <h1 className="mb-s">{t`Risk scope not found`}</h1>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>This risk scope is not part of {tenantName}. It may have been deleted, or the link may come from another tenant.</Trans>
      </p>
      <div className="mt-l flex justify-center gap-s">
        <Button onClick={() => void navigate({ to: '/$tenantId/{-$organizationId}', params: { tenantId: tenant.id, organizationId: undefined } })}>
          <Trans>Go to {tenantName}</Trans>
        </Button>
        {canGoBack ? (
          <Button priority="secondary" onClick={() => router.history.back()}><Trans>Go Back</Trans></Button>
        ) : null}
      </div>
    </ErrorPage>
  );
};
