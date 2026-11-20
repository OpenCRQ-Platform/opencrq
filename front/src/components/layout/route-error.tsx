import { Button } from '@filigran/design-system';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { isNotFound, useCanGoBack, useMatches, useRouter } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useEffect } from 'react';
import { ServerOff } from 'lucide-react';
import { clientReportQueue } from '../../stores';
import { ErrorPage } from './error-page';
import { useIsInsideLayout } from './main-layout';

export const RouteErrorComponent = ({ error }: ErrorComponentProps) => {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const matches = useMatches();

  const isInsideLayout = useIsInsideLayout();
  const lastCrumb = [...matches].reverse().find((m) => m.loaderData?.crumb)?.loaderData?.crumb;
  const notFound = isNotFound(error);

  useEffect(() => {
    if (!notFound && error instanceof Error) {
      clientReportQueue.reportClientError(error, 'route');
    }
  }, [error, notFound]);

  let title: string;
  if (!isInsideLayout) {
    title = t`Could not load page`;
  } else if (lastCrumb) {
    title = t`Could not load ${lastCrumb}`;
  } else {
    title = t`Something went wrong`;
  }

  const description = notFound
    ? t`The page you are looking for doesn't exist.`
    : t`Something went wrong while loading this page.`;

  return (
    <ErrorPage>
      <div className="relative mb-m mx-auto w-fit">
        <div className="absolute inset-0 rounded-full blur-xl bg-red/15" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red/10">
          <ServerOff className="h-8 w-8 text-red/80" />
        </div>
      </div>
      <h1 className="mb-s">{title}</h1>
      <p className="txt-sub-content text-muted-foreground">{description}</p>
      <div className="mt-l flex justify-center gap-s">
        {canGoBack ? (
          <Button priority="secondary" onClick={() => router.history.back()}><Trans>Go Back</Trans></Button>
        ) : null}
        <Button priority="secondary" onClick={() => window.location.reload()}><Trans>Reload</Trans></Button>
      </div>
    </ErrorPage>
  );
};
