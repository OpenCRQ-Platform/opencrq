import { Button } from '@filigran/design-system';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { useTRPC } from '../../../lib/trpc';
import { useOpenScopeWizard } from '../use-open-scope-wizard';
import { isPerimeterEmpty } from './perimeter-empty-card-utils';
import { PerimeterEmptyActionLabel, PerimeterEmptyBody, PerimeterEmptyTitle } from './perimeter-empty-copy';

export const PerimeterEmptyCard: FunctionComponent = () => {
  const trpc = useTRPC();
  const openScopeWizard = useOpenScopeWizard();
  const { data: organizations } = useQuery(trpc.organizations.getOrganizations.queryOptions());

  if (!isPerimeterEmpty(organizations)) {
    return null;
  }

  return (
    <ListEmptyCard
      title={<PerimeterEmptyTitle />}
      body={<PerimeterEmptyBody />}
      actions={(
        <Button onClick={openScopeWizard}>
          <PerimeterEmptyActionLabel />
        </Button>
      )}
    />
  );
};
