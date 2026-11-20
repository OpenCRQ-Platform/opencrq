import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';

export interface LastObservedViaThreat {
  id: string,
  name: string,
}

export const LastObservedVia: FunctionComponent<{ via: LastObservedViaThreat }> = ({ via }) => {
  const { id, name } = via;
  return (
    <Trans>
      via{' '}
      <Link
        from="/$tenantId/{-$organizationId}"
        to="threat-center/threats/$threatId"
        params={{ threatId: id }}
        className="text-primary hover:underline"
      >
        {name}
      </Link>
    </Trans>
  );
};
