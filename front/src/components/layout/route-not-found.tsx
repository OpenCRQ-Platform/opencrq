import { Button } from '@filigran/design-system';
import { useCanGoBack, useRouter } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { ServerOff } from 'lucide-react';
import { ErrorPage } from './error-page';

export const RouteNotFoundComponent = () => {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  return (
    <ErrorPage>
      <div className="relative mb-m mx-auto w-fit">
        <div className="absolute inset-0 rounded-full blur-xl bg-red/15" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red/10">
          <ServerOff className="h-8 w-8 text-red/80" />
        </div>
      </div>
      <h1 className="mb-s">{t`Page not found`}</h1>
      <p className="txt-sub-content text-muted-foreground">{t`The page you are looking for doesn't exist.`}</p>
      <div className="mt-l flex justify-center gap-s">
        {canGoBack ? (
          <Button priority="secondary" onClick={() => router.history.back()}><Trans>Go Back</Trans></Button>
        ) : null}
        <Button priority="secondary" onClick={() => window.location.reload()}><Trans>Reload</Trans></Button>
      </div>
    </ErrorPage>
  );
};
