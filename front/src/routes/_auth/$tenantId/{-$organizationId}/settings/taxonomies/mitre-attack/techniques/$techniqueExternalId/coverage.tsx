import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { TechniqueControlsSection } from '../../../../../../../../../features/controls/capability/components/technique-controls-section';
import { Route as TechniqueRoute } from './route';

const TechniqueCoverage = () => {
  const { technique } = TechniqueRoute.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <TechniqueControlsSection technique={technique} />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId/coverage')({
  loader: () => ({ crumb: t`Coverage` }),
  component: TechniqueCoverage,
});
