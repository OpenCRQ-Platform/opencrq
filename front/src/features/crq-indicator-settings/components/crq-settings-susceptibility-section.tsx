import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import { NumberFormInput, SectionCard } from '../../../components/shared';

interface CrqSettingsSusceptibilitySectionProps {
  control: Control<CrqIndicatorSettingsFormValues>,
}

export const CrqSettingsSusceptibilitySection: FunctionComponent<CrqSettingsSusceptibilitySectionProps> = ({ control }) => (
  <SectionCard title={t`Control aggregation`}>
    <p className="txt-sub-content text-muted-foreground">
      <Trans>
        When several controls defend the same technique, their protection is combined with
        diminishing returns: the strongest control counts fully, each additional one is discounted
        by this factor (γ). This prevents stacking many controls from mechanically driving
        resistance to 100%.
      </Trans>
    </p>
    <ul className="txt-sub-content text-muted-foreground list-disc pl-4">
      <li>
        <Trans><strong>γ = 1</strong> — every stacked control counts fully (most optimistic about defense-in-depth).</Trans>
      </li>
      <li>
        <Trans><strong>γ = 0.7</strong> — recommended default: extra controls add value but with diminishing returns.</Trans>
      </li>
      <li>
        <Trans><strong>γ = 0</strong> — only the single strongest control on a technique is counted (conservative "max" aggregation).</Trans>
      </li>
    </ul>
    <Controller
      control={control}
      name="susceptibilityGamma"
      render={({ field, fieldState }) => (
        <NumberFormInput
          label={t`Diminishing returns factor (γ)`}
          required
          step="0.05"
          min={0}
          max={1}
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
