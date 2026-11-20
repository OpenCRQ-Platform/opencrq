import { Skeleton, SkeletonGroup } from '@filigran/design-system';
import { t } from '@lingui/core/macro';

/** What the `_auth` route shows on a first load while its loader runs past the router's pending delay. */
export const RoutePendingComponent = () => (
  <SkeletonGroup loading label={t`Loading`} className="flex flex-col gap-m p-l">
    <Skeleton className="h-8 w-64 max-w-full" />
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-32 w-full" />
  </SkeletonGroup>
);
