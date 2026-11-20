import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { MAX_UNKNOWN_ACTIVITY_AGE_DAYS, MIN_UNKNOWN_ACTIVITY_AGE_DAYS } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { ThreatRelevanceSettingsFormValues } from './threat-relevance-settings-schema';
import { NumberFormInput, SectionCard } from '../../../components/shared';
import { UNKNOWN_ACTIVITY_AGE_STEP_DAYS } from './threat-relevance-settings-schema';

interface ThreatRelevanceUnknownActivitySectionProps {
  control: Control<ThreatRelevanceSettingsFormValues>,
}

export const ThreatRelevanceUnknownActivitySection: FunctionComponent<ThreatRelevanceUnknownActivitySectionProps> = ({ control }) => (
  <SectionCard title={t`Threats Without a Dated Activity`}>
    <p className="txt-sub-content text-muted-foreground">
      <Trans>A threat with no dated activity weighs in its score as if it had a single activity this many days old. Where it ranks also depends on its relevance and, for a dated threat, on all its observed activity days.</Trans>
    </p>
    <Controller
      control={control}
      name="unknownActivityAgeDays"
      render={({ field, fieldState }) => (
        <NumberFormInput
          label={t`Assumed activity age (days)`}
          required
          step={UNKNOWN_ACTIVITY_AGE_STEP_DAYS}
          min={MIN_UNKNOWN_ACTIVITY_AGE_DAYS}
          max={MAX_UNKNOWN_ACTIVITY_AGE_DAYS}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
          error={fieldState.error?.message}
        />
      )}
    />
  </SectionCard>
);
