import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { ThreatAnalysisDetailData } from './threat-detail-tabs';
import { CardField, InfoField, SectionCard } from '../../../components/shared';
import { formatDate, formatPointsAsPercentAtMost } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { sourceKindLabel } from './threat-list-utils';

const StatedValues: FunctionComponent<{ values: Array<string> }> = ({ values }) => (
  values.length === 0
    ? <span className="text-muted-foreground">{EMPTY_VALUE}</span>
    : (
      <div className="flex flex-wrap gap-2">
        {values.map((value) => <Chip key={value} label={value} />)}
      </div>
    )
);

const optionalDate = (value: string | null): string | null => (value ? formatDate(value) : null);

interface ThreatProfileCardProps {
  detail: Pick<ThreatAnalysisDetailData, 'analysis' | 'origin' | 'declaredIntent' | 'threatActorTypes' | 'roles'>,
}

/**
 * What the threat's sources say it is: its declared intent, the fields its type alone carries,
 * where it came from and how sure that source is. The STIX id is shown for a STIX import only,
 * since a connector threat is reached through OpenCTI instead.
 */
export const ThreatProfileCard: FunctionComponent<ThreatProfileCardProps> = ({ detail }) => {
  const { analysis, origin, declaredIntent, threatActorTypes, roles } = detail;
  const nothingDeclared = declaredIntent.primaryMotivations.length === 0
    && declaredIntent.secondaryMotivations.length === 0
    && declaredIntent.goals.length === 0;

  return (
    <SectionCard title={t`Profile`} className="h-full" cardClassName="flex-1">
      <div className="flex flex-col gap-3">
        <p className="txt-sub-content text-muted-foreground">{t`Declared intent`}</p>
        {nothingDeclared ? <p>{t`No source describing this threat declared a motivation or a goal.`}</p> : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <CardField title={t`Primary motivation`}>
              <StatedValues values={declaredIntent.primaryMotivations.map(({ value }) => value)} />
            </CardField>
            <CardField title={t`Secondary motivations`}>
              <StatedValues values={declaredIntent.secondaryMotivations.map(({ value }) => value)} />
            </CardField>
            {/* Plain text, never a chip: a goal is free text and a chip would truncate it. */}
            <CardField title={t`Goals`} className="col-span-2">
              {declaredIntent.goals.length === 0
                ? <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                : (
                  <ul className="flex flex-col gap-1">
                    {declaredIntent.goals.map(({ value }) => <li key={value}>{value}</li>)}
                  </ul>
                )}
            </CardField>
          </div>
        )}
      </div>
      <div className="border-t border-border-light" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {analysis.entityType === 'threat-actor' && (
          <>
            <InfoField title={t`Sophistication`} value={analysis.sophistication} />
            <CardField title={t`Threat actor types`}>
              <StatedValues values={threatActorTypes} />
            </CardField>
            <CardField title={t`Roles`}>
              <StatedValues values={roles} />
            </CardField>
          </>
        )}
        {analysis.entityType === 'campaign' && (
          <InfoField title={t`Objective`} value={analysis.objective} />
        )}
        <CardField title={t`Source`}>
          <Chip className="w-fit" label={sourceKindLabel(origin.kind)} />
        </CardField>
        <InfoField title={t`Confidence`} value={analysis.confidence !== null ? formatPointsAsPercentAtMost(analysis.confidence, 3) : null} />
        <InfoField title={t`Last ingested`} value={formatDate(origin.lastIngestedAt)} />
        <InfoField title={t`First Seen`} value={optionalDate(analysis.firstSeen)} />
        <InfoField title={t`Last Seen`} value={optionalDate(analysis.lastSeen)} />
        <InfoField title={t`Original Creation Date`} value={optionalDate(analysis.stixCreated)} />
        {origin.kind === 'stix-import' && (
          <CardField title={t`STIX ID`} className="col-span-2">
            <span className="font-mono txt-sub-content text-muted-foreground break-all">{origin.stixId}</span>
          </CardField>
        )}
      </div>
    </SectionCard>
  );
};
