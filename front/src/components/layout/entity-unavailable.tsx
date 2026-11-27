import { Button } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router';
import { FileX2 } from 'lucide-react';
import type { ComponentProps, FunctionComponent } from 'react';
import { ErrorPage } from './error-page';

interface EntityUnavailableProps {
  title: string,
  description: string,
  listLabel: string,
  /** Where that list lives, built by the caller with `linkOptions(...)`. */
  listLink: Omit<ComponentProps<typeof Link>, 'children'>,
}

export const EntityUnavailable: FunctionComponent<EntityUnavailableProps> = ({ title, description, listLabel, listLink }) => {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  return (
    <ErrorPage>
      <div className="relative mb-m mx-auto w-fit">
        <div className="absolute inset-0 rounded-full blur-xl bg-red/15" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red/10">
          <FileX2 className="h-8 w-8 text-red/80" />
        </div>
      </div>
      <h1 className="mb-s">{title}</h1>
      <p className="txt-sub-content text-muted-foreground">{description}</p>
      <div className="mt-l flex justify-center gap-s">
        <Button asChild>
          <Link {...listLink}>{listLabel}</Link>
        </Button>
        {canGoBack ? (
          <Button priority="secondary" onClick={() => router.history.back()}><Trans>Go Back</Trans></Button>
        ) : null}
      </div>
    </ErrorPage>
  );
};
