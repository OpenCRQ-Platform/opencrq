import type { FunctionComponent } from 'react';
import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, linkOptions } from '@tanstack/react-router';
import type { CapabilityDetail } from '../types/capability';
import { CardField, SectionCard } from '../../../../components/shared';
import { ExpandableText } from '../../../../components/ui/expandable-text';
import { getAssetCategoryLabel } from '../../../../utils';
import { useFunctionPostures } from '../hooks/use-function-postures';
import { useLifelineGuide } from '../hooks/use-lifeline-guide';
import { ControlTypeBadge } from '../ui/control-type-badge';
import { deriveControlType } from '../utils/control-type';
import { CapabilityAssessmentEvidence } from './capability-assessment-evidence';
import { CapabilityAssessmentSection } from './capability-assessment-section';
import { CapabilityDrataEvidence } from './capability-drata-evidence';
import { CapabilityFunctionSection } from './capability-function-section';
import { CrosswalkSection } from './crosswalk-section';

// The catalogue definition runs past two thousand characters and its closing sentences say where
// the control stops applying, so it opens the page clamped rather than truncated for good.
const DEFINITION_LINE_CLAMP = 8;

type LifelineSource = 'assessment' | 'prevent' | 'detect';

export const CapabilityOverviewContent: FunctionComponent<{ capability: CapabilityDetail }> = ({ capability }) => {
  const controlType = deriveControlType(capability.edges);
  const { postureOf, notDeployedOnScope } = useFunctionPostures(capability);
  const guideFor = useLifelineGuide<LifelineSource>();
  const preventionLink = linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'prevention' });
  const detectionLink = linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'detection' });

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex gap-x-6 items-stretch">
        <SectionCard title={t`Entity detail`} className="w-1/2" cardClassName="flex-1">
          {/* Derived from the effective coverage, never declared: a control that only prevents
              reads preventive, one that only detects reads detective. A control the tenant has
              emptied of every technique carries no type, so the field is left out entirely. */}
          {controlType !== null && (
            <CardField title={t`Type`}>
              <ControlTypeBadge value={controlType} />
            </CardField>
          )}
          {/* The families this control protects, which is what the engine scopes its contribution
              to a finding on: a control earns nothing on an asset outside this list. */}
          <CardField title={t`Protected asset families`}>
            {capability.protectedFamilies.length === 0
              ? <span className="text-muted-foreground">{t`None`}</span>
              : (
                <div className="flex flex-wrap gap-2">
                  {capability.protectedFamilies.map((family) => (
                    <Chip key={family} label={getAssetCategoryLabel(family)} />
                  ))}
                </div>
              )}
          </CardField>
          {/* Platform reference data: which security tooling implements this control. Read-only,
              it is the join ingested platform instances will resolve on. */}
          <CardField title={t`Security platform families`}>
            {capability.securityPlatformFamilies.length === 0
              ? <span className="text-muted-foreground">{t`None`}</span>
              : (
                <div className="flex flex-wrap gap-2">
                  {capability.securityPlatformFamilies.map((family) => (
                    <Chip key={family.id} label={family.name} />
                  ))}
                </div>
              )}
          </CardField>
        </SectionCard>

        <SectionCard title={t`Definition`} className="w-1/2" cardClassName="flex-1">
          <ExpandableText
            text={capability.description}
            lineClamp={DEFINITION_LINE_CLAMP}
          />
        </SectionCard>
      </div>

      <div className="flex flex-col gap-4">
        <CapabilityAssessmentSection capability={capability} guide={guideFor('assessment')} />
        <CapabilityFunctionSection
          capability={capability}
          capabilityFunction="prevent"
          posture={postureOf('prevent')}
          notDeployedOnScope={notDeployedOnScope}
          guide={guideFor('prevent')}
          action={(
            <Link {...preventionLink} className="txt-sub-content text-primary hover:underline">
              <Trans>Open prevention</Trans>
            </Link>
          )}
        />
        <CapabilityFunctionSection
          capability={capability}
          capabilityFunction="detect"
          posture={postureOf('detect')}
          notDeployedOnScope={notDeployedOnScope}
          guide={guideFor('detect')}
          action={(
            <Link {...detectionLink} className="txt-sub-content text-primary hover:underline">
              <Trans>Open detection</Trans>
            </Link>
          )}
        />
      </div>

      <CapabilityAssessmentEvidence capabilityId={capability.id} />
      <CapabilityDrataEvidence capability={capability} />

      {capability.crosswalk.length > 0 && (
        <CrosswalkSection crosswalk={capability.crosswalk} />
      )}

    </div>
  );
};
