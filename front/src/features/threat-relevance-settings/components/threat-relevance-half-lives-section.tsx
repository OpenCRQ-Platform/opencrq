import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { MAX_ACT_HALF_LIFE_DAYS, MIN_ACT_HALF_LIFE_DAYS } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { ThreatRelevanceSettingsFormValues } from './threat-relevance-settings-schema';
import { NumberFormInput, SectionCard } from '../../../components/shared';
import { HALF_LIFE_STEP_DAYS } from './threat-relevance-settings-schema';

interface ThreatRelevanceHalfLivesSectionProps {
  control: Control<ThreatRelevanceSettingsFormValues>,
}

export const ThreatRelevanceHalfLivesSection: FunctionComponent<ThreatRelevanceHalfLivesSectionProps> = ({ control }) => (
  <SectionCard title={t`Activity Half-Lives`}>
    <p className="txt-sub-content text-muted-foreground">
      <Trans>A threat actor weighs less as its latest known activity ages. The half-life is the number of days after which that weight is halved. Observed anchors come from the reported start or stop date of an activity, authored anchors only from the date the intelligence relationship was written, so they deserve a slower decay.</Trans>
    </p>
    <div className="grid grid-cols-2 gap-4">
      {(
        [
          ['actHalfLifeObservedDays', t`Observed anchor half-life (days)`],
          ['actHalfLifeAuthoredDays', t`Authored anchor half-life (days)`],
        ] as const
      ).map(([name, label]) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field, fieldState }) => (
            <NumberFormInput
              label={label}
              required
              step={HALF_LIFE_STEP_DAYS}
              min={MIN_ACT_HALF_LIFE_DAYS}
              max={MAX_ACT_HALF_LIFE_DAYS}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
              error={fieldState.error?.message}
            />
          )}
        />
      ))}
    </div>
  </SectionCard>
);
