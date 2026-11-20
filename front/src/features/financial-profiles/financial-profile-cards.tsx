import type { RevenueBand } from '@app/module/client';
import { loadedDailyLabourCostBenchmark, MAX_FINANCIAL_AMOUNT_USD } from '@app/module/client';
import { Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useFormState, useWatch } from 'react-hook-form';
import type { FieldError, UseFormReturn } from 'react-hook-form';
import type { FinancialProfileAnswers } from './financial-profile-schema';
import { FormattedNumberInput, NullableNumberInput } from '../../components/shared';
import { formatDollar, formatNumber, formatRevenueBand } from '../../utils';
import {
  cardTransactionsBandOptions,
  contractedRevenueBandOptions,
  contractualLiabilityCapBandOptions,
  costliestIncidentBandOptions,
  customerCountBandOptions,
  fullRestoreBandOptions,
  individualsBandOptions,
  largestRepositoryBandOptions,
  operatingDaysBandOptions,
  paymentFlowBandOptions,
  rdIpValueBandOptions,
  regulatoryRegimeOptions,
  restoreTestRecencyOptions,
  revenueRecaptureBandOptions,
  sensitiveRecordsBandOptions,
  timeToRevenueImpactBandOptions,
  worstOutageBandOptions,
} from './financial-profile-band-labels';
import { bandFromRevenueAmount, isMtdRtoInconsistent } from './financial-profile-utils';
import { BandSelect, FieldWithSuffix, QuestionCard, YesNoGate } from './financial-profile-controls';

/** Zod words an amount over the ceiling in English, with the raw bound: the reader gets it formatted, in their language. */
const amountError = (error: FieldError | undefined): string | undefined => {
  if (error?.type === 'too_big') {
    const ceiling = formatDollar(MAX_FINANCIAL_AMOUNT_USD);
    return t`Enter at most ${ceiling}.`;
  }
  return error?.message;
};

interface CardProps {
  form: UseFormReturn<FinancialProfileAnswers>,
}

interface Q1AnnualRevenueCardProps extends CardProps {
  revenueBand: RevenueBand | null,
}

interface LoadedDailyLabourCostCardProps extends CardProps {
  countryName: string | null | undefined,
  countryIsoAlpha3: string | null | undefined,
}

/**
 * Rendered alongside the Section A cards, but not one of the twenty-one questions, so it carries no
 * Q# badge or "informs" chips. Never pre-filled: the country benchmark is shown beside the empty
 * field as guidance, and the kernel falls back to it at low confidence, as Q1 does with the band.
 */
export const LoadedDailyLabourCostCard: FunctionComponent<LoadedDailyLabourCostCardProps> = ({ form, countryName, countryIsoAlpha3 }) => {
  const value = useWatch({ control: form.control, name: 'loadedDailyLabourCost' });
  const benchmark = formatNumber(loadedDailyLabourCostBenchmark(countryIsoAlpha3));

  return (
    <Paper elevation={1} className="flex flex-col gap-3 p-4">
      <Text as="span" variant="content-compact-bold">{t`Loaded daily labour cost`}</Text>
      <div className="max-w-[170px]">
        <Controller
          control={form.control}
          name="loadedDailyLabourCost"
          render={({ field, fieldState }) => (
            <FieldWithSuffix suffix={t`USD / day`}>
              <FormattedNumberInput aria-label={t`Loaded daily labour cost`} value={field.value} onChange={field.onChange} error={amountError(fieldState.error)} />
            </FieldWithSuffix>
          )}
        />
      </div>
      {value === null && (
        <Text as="p" variant="content-compact" className="text-default-secondary">
          {countryIsoAlpha3 && countryName
            ? t`Left blank, the ${benchmark} USD / day benchmark for ${countryName} is used and internal response labour is flagged as low confidence.`
            : t`Left blank, the ${benchmark} USD / day platform default is used and internal response labour is flagged as low confidence.`}
        </Text>
      )}
    </Paper>
  );
};

/**
 * What a blank Q1 costs, said before the analyst leaves it blank: the figure is the same either
 * way, the confidence flag is not.
 */
const StoredBandFallbackNote: FunctionComponent<{ band: RevenueBand }> = ({ band }) => {
  const bandLabel = formatRevenueBand(band);
  return (
    <Text as="p" variant="content-compact" className="text-default-secondary">
      {t`Left blank, the ${bandLabel} band's midpoint is used and the drivers it scales are flagged as low confidence.`}
    </Text>
  );
};

const RevenueBandEcho: FunctionComponent<{ amount: number }> = ({ amount }) => {
  const bandLabel = formatRevenueBand(bandFromRevenueAmount(amount));
  return (
    <Text as="p" variant="content-compact" className="text-default-secondary">
      {t`Falls in the ${bandLabel} band.`}
    </Text>
  );
};

export const Q1AnnualRevenueCard: FunctionComponent<Q1AnnualRevenueCardProps> = ({ form, revenueBand }) => {
  const amount = useWatch({ control: form.control, name: 'annualRevenue' });
  const { errors } = useFormState({ control: form.control, name: 'annualRevenue' });

  return (
    <QuestionCard id="Q1" definition={t`Drives every revenue-scaled loss driver. The risk scope's revenue band is derived from this amount.`}>
      <div className="max-w-[170px]">
        <Controller
          control={form.control}
          name="annualRevenue"
          render={({ field, fieldState }) => (
            <FieldWithSuffix suffix={t`USD`}>
              <FormattedNumberInput value={field.value} onChange={field.onChange} label={t`Exact amount`} error={amountError(fieldState.error)} />
            </FieldWithSuffix>
          )}
        />
      </div>
      {amount !== null && errors.annualRevenue === undefined && <RevenueBandEcho amount={amount} />}
      {amount === null && revenueBand !== null && <StoredBandFallbackNote band={revenueBand} />}
    </QuestionCard>
  );
};

export const Q2GrossMarginCard: FunctionComponent<CardProps> = ({ form }) => (
  <QuestionCard id="Q2" definition={t`Revenue minus cost of goods sold, divided by revenue.`}>
    <Controller
      control={form.control}
      name="grossMarginPct"
      render={({ field, fieldState }) => (
        <div className="max-w-[90px]">
          <FieldWithSuffix suffix="%">
            <NullableNumberInput value={field.value} onChange={field.onChange} label={t`Percentage`} error={fieldState.error?.message} />
          </FieldWithSuffix>
        </div>
      )}
    />
  </QuestionCard>
);

export const Q3OperatingDaysCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = operatingDaysBandOptions();
  return (
    <QuestionCard id="Q3" definition={t`Turns annual revenue into a daily rate.`}>
      <Controller control={form.control} name="operatingDaysBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
      <Controller
        control={form.control}
        name="seasonalPeakPct"
        render={({ field, fieldState }) => (
          <div className="max-w-[180px]">
            <FieldWithSuffix suffix="%">
              <NullableNumberInput value={field.value} onChange={field.onChange} label={t`Seasonal peak uplift`} error={fieldState.error?.message} />
            </FieldWithSuffix>
          </div>
        )}
      />
    </QuestionCard>
  );
};

export const Q5ItDependentRevenueCard: FunctionComponent<CardProps> = ({ form }) => (
  <QuestionCard id="Q5" definition={t`Revenue that cannot be produced or invoiced while systems are down.`}>
    <Controller
      control={form.control}
      name="itDependentRevenuePct"
      render={({ field, fieldState }) => (
        <div className="max-w-[90px]">
          <FieldWithSuffix suffix="%">
            <NullableNumberInput value={field.value} onChange={field.onChange} label={t`Percentage`} error={fieldState.error?.message} />
          </FieldWithSuffix>
        </div>
      )}
    />
  </QuestionCard>
);

const InconsistencyWarning: FunctionComponent<{ message: string }> = ({ message }) => (
  <div className="rounded-md border border-feedback-alert-primary bg-feedback-alert-secondary-transparency-30 p-3">
    <Text as="p" variant="content-compact">{message}</Text>
  </div>
);

export const Q6TimeToImpactCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = timeToRevenueImpactBandOptions();

  return (
    <QuestionCard id="Q6" definition={t`Loss starts after this delay, never the instant systems go down.`}>
      <Controller control={form.control} name="timeToRevenueImpactBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

/**
 * The MTD/RTO verdict is stated here alone, though it reads both cards: the recovery time
 * objective is the answer a reader goes and changes, and both cards are on one scroll, so
 * raising it twice would put the same finding on screen in two wordings.
 */
export const Q7FullRestoreCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = fullRestoreBandOptions();
  const timeToRevenueImpactBand = useWatch({ control: form.control, name: 'timeToRevenueImpactBand' });
  const fullRestoreBand = useWatch({ control: form.control, name: 'fullRestoreBand' });
  const mtdInconsistent = isMtdRtoInconsistent({ timeToRevenueImpactBand, fullRestoreBand });

  return (
    <QuestionCard id="Q7" definition={t`Assuming backups are intact.`}>
      <Controller control={form.control} name="fullRestoreBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
      {mtdInconsistent && <InconsistencyWarning message={t`This recovery time objective is more than four times the stated maximum tolerable downtime, so the plan targets a restore long after the business says it can no longer cope.`} />}
    </QuestionCard>
  );
};

export const Q8RevenueRecaptureCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = revenueRecaptureBandOptions();
  return (
    <QuestionCard id="Q8" definition={t`Whether business lost during downtime comes back later, or is gone.`}>
      <Controller control={form.control} name="revenueRecaptureBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q16RestoreTestRecencyCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = restoreTestRecencyOptions();
  return (
    <QuestionCard
      id="Q16"
      definition={t`A restore time that has never been tested is not evidence. A blank is treated as tested.`}
    >
      <Controller control={form.control} name="restoreTestRecency" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q9aRecordsHeldCard: FunctionComponent<CardProps> = ({ form }) => {
  const gate = useWatch({ control: form.control, name: 'recordsHeldGate' });
  const individualsOptions = individualsBandOptions();

  return (
    <QuestionCard id="Q9a">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Text as="p" variant="content-compact">{t`Do you hold personal data beyond your own employees?`}</Text>
          <Text as="p" variant="content-compact" className="text-default-secondary">{t`Answering no closes the band below.`}</Text>
        </div>
        <Controller
          control={form.control}
          name="recordsHeldGate"
          render={({ field }) => (
            <YesNoGate
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                if (value === false) {
                  form.setValue('individualsBand', null, { shouldDirty: true });
                }
              }}
            />
          )}
        />
      </div>
      {gate === true && (
        <div className="flex flex-col gap-2 border-t border-dashed border-elevation-subtle-soft pt-4">
          <Text as="span" variant="content-compact">{t`Individuals whose data you hold`}</Text>
          <Controller control={form.control} name="individualsBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={individualsOptions} />} />
        </div>
      )}
    </QuestionCard>
  );
};

export const Q9bCardTransactionsCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = cardTransactionsBandOptions();
  return (
    <QuestionCard id="Q9b">
      <Controller control={form.control} name="cardTransactionsBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q9cSensitiveRecordsCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = sensitiveRecordsBandOptions();
  return (
    <QuestionCard id="Q9c" definition={t`Health, biometric, financial identifiers.`}>
      <Controller control={form.control} name="sensitiveRecordsBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q20LargestRepositoryCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = largestRepositoryBandOptions();
  return (
    <QuestionCard
      id="Q20"
      definition={t`Bounds the likely population; the max still reads the whole estate.`}
    >
      <Controller control={form.control} name="largestRepositoryBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q10RegulatedServicesCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = regulatoryRegimeOptions();
  return (
    <QuestionCard id="Q10" definition={t`Pick the strictest that applies.`}>
      <Controller control={form.control} name="regulatoryRegime" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q11aCustomerBaseCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = customerCountBandOptions();
  return (
    <QuestionCard id="Q11a">
      <div className="flex flex-col gap-2">
        <Text as="span" variant="content-compact">{t`Customer count`}</Text>
        <Controller control={form.control} name="customerCountBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
      </div>
      <div className="max-w-[150px] border-t border-dashed border-elevation-subtle-soft pt-4">
        <Controller
          control={form.control}
          name="b2cRevenuePct"
          render={({ field, fieldState }) => (
            <FieldWithSuffix suffix="%">
              <NullableNumberInput value={field.value} onChange={field.onChange} label={t`B2C share`} error={fieldState.error?.message} />
            </FieldWithSuffix>
          )}
        />
      </div>
    </QuestionCard>
  );
};

export const Q11bRecurringRevenueCard: FunctionComponent<CardProps> = ({ form }) => (
  <QuestionCard id="Q11b">
    <div className="max-w-[150px]">
      <Controller
        control={form.control}
        name="recurringRevenuePct"
        render={({ field, fieldState }) => (
          <FieldWithSuffix suffix="%">
            <NullableNumberInput value={field.value} onChange={field.onChange} label={t`Recurring share`} error={fieldState.error?.message} />
          </FieldWithSuffix>
        )}
      />
    </div>
  </QuestionCard>
);

export const Q19ContractualLiabilityCapCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = contractualLiabilityCapBandOptions();
  return (
    <QuestionCard id="Q19" definition={t`Expressed as a share of the revenue under SLA or breach-liability clauses.`}>
      <Controller control={form.control} name="contractualLiabilityCapBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q12ContractedRevenueCard: FunctionComponent<CardProps> = ({ form }) => {
  const options = contractedRevenueBandOptions();
  return (
    <QuestionCard id="Q12" definition={t`Contracts carrying service credits or liquidated damages on a security breach.`}>
      <Controller control={form.control} name="contractedRevenueBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
    </QuestionCard>
  );
};

export const Q13PaymentFlowsCard: FunctionComponent<CardProps> = ({ form }) => {
  const gate = useWatch({ control: form.control, name: 'outOfBandVerificationGate' });
  const options = paymentFlowBandOptions();
  return (
    <QuestionCard id="Q13">
      <div className="flex flex-col gap-2">
        <Text as="span" variant="content-compact">{t`Daily value of outbound electronic payments`}</Text>
        <Controller control={form.control} name="paymentFlowDailyValueBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-dashed border-elevation-subtle-soft pt-4">
        <div>
          <Text as="p" variant="content-compact">{t`Approval ceiling above which out-of-band verification is required?`}</Text>
          <Text as="p" variant="content-compact" className="text-default-secondary">{t`Left blank, the estimate is unbounded.`}</Text>
        </div>
        <Controller
          control={form.control}
          name="outOfBandVerificationGate"
          render={({ field }) => (
            <YesNoGate
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                if (value === false) {
                  form.setValue('outOfBandThreshold', null, { shouldDirty: true });
                }
              }}
            />
          )}
        />
      </div>
      {gate === true && (
        <Controller
          control={form.control}
          name="outOfBandThreshold"
          render={({ field, fieldState }) => (
            <div className="max-w-[170px]">
              <FieldWithSuffix suffix={t`USD`}>
                <FormattedNumberInput value={field.value} onChange={field.onChange} label={t`Approval ceiling`} error={amountError(fieldState.error)} />
              </FieldWithSuffix>
            </div>
          )}
        />
      )}
    </QuestionCard>
  );
};

export const Q14RdIpValueCard: FunctionComponent<CardProps> = ({ form }) => {
  const answer = useWatch({ control: form.control, name: 'rdIpValueBand' });
  const options = rdIpValueBandOptions();

  return (
    <QuestionCard id="Q14" definition={t`What your research and development, and any proprietary or strategic information, is worth to a competitor.`}>
      <Controller control={form.control} name="rdIpValueBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={options} />} />
      {answer === null && (
        <div className="rounded-md border border-feedback-alert-primary bg-feedback-alert-secondary-transparency-30 p-3">
          <Text as="p" variant="content-compact">
            {t`Left blank, competitive-advantage erosion produces no estimate, and scenarios reaching that category will report their dominant loss driver as needing input.`}
          </Text>
        </div>
      )}
    </QuestionCard>
  );
};

export const Q15RansomPostureCard: FunctionComponent<CardProps> = ({ form }) => {
  const posture = useWatch({ control: form.control, name: 'ransomPaymentPosture' });

  return (
    <QuestionCard id="Q15" definition={t`Would your organization pay a ransom?`}>
      <Controller
        control={form.control}
        name="ransomPaymentPosture"
        render={({ field }) => (
          <YesNoGate
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              if (value !== true) {
                form.setValue('ransomPaymentCeiling', null, { shouldDirty: true });
              }
            }}
          />
        )}
      />
      {posture === true && (
        <>
          <Controller
            control={form.control}
            name="ransomPaymentCeiling"
            render={({ field, fieldState }) => (
              <div className="max-w-[170px]">
                <FieldWithSuffix suffix={t`USD`}>
                  <FormattedNumberInput value={field.value} onChange={field.onChange} label={t`Payment ceiling (optional)`} error={amountError(fieldState.error)} />
                </FieldWithSuffix>
              </div>
            )}
          />
          <div className="rounded-md border border-feedback-info-primary bg-feedback-info-secondary-transparency-30 p-3">
            <Text as="p" variant="content-compact">
              {t`The model draws this amount on every simulated extortion event. This is a known conservative simplification. A ceiling caps that amount rather than replacing it, and a blank ceiling leaves it unchanged.`}
            </Text>
          </div>
        </>
      )}
      {posture === false && (
        <div className="rounded-md border border-feedback-info-primary bg-feedback-info-secondary-transparency-30 p-3">
          <Text as="p" variant="content-compact">
            {t`Extortion payment will be recorded as zero across the board, rather than left unestimated.`}
          </Text>
        </div>
      )}
    </QuestionCard>
  );
};

export const Q18LossHistoryCard: FunctionComponent<CardProps> = ({ form }) => {
  const worstOutageOptions = worstOutageBandOptions();
  const costliestIncidentOptions = costliestIncidentBandOptions();

  return (
    <QuestionCard
      id="Q18"
      definition={t`Worst outage and costliest incident in the past three years. Neither is a likelihood and neither is clamped: an outage that overran your recovery target widens the worst case of the downtime drivers, and the costliest incident raises the floor the totals are checked against.`}
    >
      <div className="flex flex-col gap-2">
        <Text as="span" variant="content-compact">{t`Worst outage`}</Text>
        <Controller control={form.control} name="worstOutageBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={worstOutageOptions} />} />
      </div>
      <div className="flex flex-col gap-2 border-t border-dashed border-elevation-subtle-soft pt-4">
        <Text as="span" variant="content-compact">{t`Costliest incident`}</Text>
        <Controller control={form.control} name="costliestIncidentBand" render={({ field }) => <BandSelect value={field.value} onChange={field.onChange} options={costliestIncidentOptions} />} />
      </div>
    </QuestionCard>
  );
};
