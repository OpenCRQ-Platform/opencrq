import { Chip } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';

/** Renders nothing when the scenario breaks no requirement. */
export const BrokenRequirements: FunctionComponent<{ riskScenarioId: string }> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const { data: broken } = useQuery(trpc.requirements.getBrokenRequirements.queryOptions({ riskScenarioId }));
  if (!broken || broken.length === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="txt-sub-content text-muted-foreground">
        <Trans>Breaks</Trans>:
      </span>
      <div className="flex flex-wrap gap-1">
        {broken.map((requirement) => (
          <Chip
            key={requirement.id}
            label={i18n._({
              id: '{requirement}, owed to {party}',
              message: '{requirement}, owed to {party}',
              values: { requirement: requirement.name, party: requirement.interestedParty },
            })}
          />
        ))}
      </div>
    </div>
  );
};
