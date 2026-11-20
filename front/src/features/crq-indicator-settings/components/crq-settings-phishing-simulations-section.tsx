import { Button } from '@filigran/design-system';
import { DEFAULT_PHISHING_SUSCEPTIBILITY, utcCalendarDay } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller, useWatch } from 'react-hook-form';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import type { PhishingDeclarationError } from '../crq-indicator-settings-utils';
import { DateFormInput, NullableNumberInput, SectionCard } from '../../../components/shared';
import { percentToShare, shareToPercent } from '../crq-indicator-settings-utils';

interface CrqSettingsPhishingSimulationsSectionProps {
  control: Control<CrqIndicatorSettingsFormValues>,
  onClear: () => void,
}

const isPhishingDeclarationError = (message: string | undefined): message is PhishingDeclarationError => (
  message === 'RATE_OUT_OF_RANGE' || message === 'RATE_REQUIRED' || message === 'DATE_REQUIRED' || message === 'DATE_IN_FUTURE'
);

const phishingErrorMessage = (message: string | undefined): string | undefined => {
  if (!isPhishingDeclarationError(message)) {
    return message;
  }
  switch (message) {
    case 'RATE_OUT_OF_RANGE':
      return t`The share must be between 0 and 100.`;
    case 'RATE_REQUIRED':
      return t`Enter the share of people caught in that campaign.`;
    case 'DATE_REQUIRED':
      return t`Pick the day the campaign was measured.`;
    case 'DATE_IN_FUTURE':
      return t`The campaign cannot be measured after today (UTC).`;
  }
};

export const CrqSettingsPhishingSimulationsSection: FunctionComponent<CrqSettingsPhishingSimulationsSectionProps> = ({ control, onClear }) => {
  const [rate, measuredOn] = useWatch({ control, name: ['phishingFailureRate', 'phishingFailureMeasuredOn'] });
  const isDeclared = rate !== null || measuredOn !== null;
  const defaultPercent = shareToPercent(DEFAULT_PHISHING_SUSCEPTIBILITY);

  return (
    <SectionCard title={t`Phishing simulations`}>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>
          The share of your people caught by your last phishing simulation campaign. Without a
          declaration, the engine reads {defaultPercent} %: the share of recipients who enter credentials
          or enable a macro on a phishing email, before any awareness training.
        </Trans>
      </p>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>
          The rate is read as measured under the awareness training declared today: update it when
          the training changes. Once the campaign is older than the validity of a test result, the
          engine reads the default again.
        </Trans>
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Controller
          control={control}
          name="phishingFailureRate"
          render={({ field, fieldState }) => (
            <NullableNumberInput
              label={t`People caught (%)`}
              step="any"
              min={0}
              max={100}
              value={shareToPercent(field.value)}
              onChange={(percent) => field.onChange(percentToShare(percent))}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
              error={phishingErrorMessage(fieldState.error?.message)}
            />
          )}
        />
        <Controller
          control={control}
          name="phishingFailureMeasuredOn"
          render={({ field, fieldState }) => (
            <DateFormInput
              label={t`Campaign measured on`}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              maxDate={utcCalendarDay(new Date())}
              inputRef={field.ref}
              error={phishingErrorMessage(fieldState.error?.message)}
            />
          )}
        />
      </div>
      {isDeclared && (
        <div>
          <Button type="button" priority="secondary" size="sm" onClick={onClear}>
            <Trans>Clear the declaration</Trans>
          </Button>
        </div>
      )}
    </SectionCard>
  );
};
