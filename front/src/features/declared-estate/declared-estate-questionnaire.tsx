import type { DeclaredEstateKind } from '@app/module/client';
import { DECLARED_ESTATE_BAND_VALUES, DECLARED_ESTATE_MAX_COUNT } from '@app/module/client';
import { Paper, Text } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { DeclaredEstateChoice, DeclaredEstateDraft, DeclaredEstateDraftError } from './declared-estate-utils';
import { NullableNumberInput } from '../../components/shared';
import { formatNumber } from '../../utils/format-number';
import { BandSelect, YesNoGate } from '../financial-profiles/financial-profile-controls';
import { declaredEstateBandLabel, declaredEstateKindLabel, declaredEstateKindNames } from './declared-estate-labels';
import { asksExposure, DECLARED_ESTATE_KINDS_IN_ASSET_ORDER, draftError, EMPTY_DRAFT, pickChoice, pickMode } from './declared-estate-utils';

interface DeclaredEstateQuestionnaireProps {
  drafts: ReadonlyMap<DeclaredEstateKind, DeclaredEstateDraft>,
  onChange: (kind: DeclaredEstateKind, draft: DeclaredEstateDraft) => void,
  /** Omitted where the scope does not exist yet, as while it is being created. */
  measured?: ReadonlyMap<DeclaredEstateKind, number>,
}

const MeasuredLine: FunctionComponent<{ measured: number }> = ({ measured }) => (
  <Text as="p" variant="content-caption" className="text-default-secondary">
    {measured === 0
      ? t`None measured`
      : plural(measured, {
        one: 'Measured: # asset',
        other: 'Measured: # assets',
      })}
  </Text>
);

const choiceOptions = (): ReadonlyArray<{ value: DeclaredEstateChoice, label: string }> => [
  ...DECLARED_ESTATE_BAND_VALUES.map((band) => ({ value: band, label: declaredEstateBandLabel(band) })),
  { value: 'custom', label: t`Specify` },
];

const draftErrorLabel = (error: DeclaredEstateDraftError): string => {
  switch (error) {
    case 'MISSING_COUNT':
      return t`Enter a number.`;
    case 'NOT_A_COUNT': {
      const max = formatNumber(DECLARED_ESTATE_MAX_COUNT);
      return t`Enter a whole number from 0 to ${max}.`;
    }
    case 'LOW_ABOVE_HIGH':
      return t`The minimum is above the maximum.`;
  }
};

interface KindRowProps {
  kind: DeclaredEstateKind,
  draft: DeclaredEstateDraft,
  onChange: (draft: DeclaredEstateDraft) => void,
  measured: number | undefined,
}

const KindRow: FunctionComponent<KindRowProps> = ({ kind, draft, onChange, measured }) => {
  const label = declaredEstateKindLabel(kind);
  const { category, subcategory } = declaredEstateKindNames(kind);
  const error = draftError(draft);

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-x-6 gap-y-2 border-t border-elevation-subtle-soft py-3 first:border-t-0">
      <div className="flex min-w-0 flex-[1_1_200px] flex-col pt-2 sm:max-w-[240px]">
        <Text as="span" variant="content-compact-bold">{category}</Text>
        {subcategory !== null && <Text as="span" variant="content-caption" className="text-default-secondary">{subcategory}</Text>}
      </div>
      <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-2">
        {measured !== undefined && <MeasuredLine measured={measured} />}
        <BandSelect value={draft.choice} onChange={(choice) => onChange(pickChoice(draft, choice))} options={choiceOptions()} />
        {draft.choice === 'over_5000' && (
          <Text as="p" variant="content-caption" className="text-default-secondary">
            {i18n._({ id: 'Read as {low} to {high}. Specify the number beyond that.', message: 'Read as {low} to {high}. Specify the number beyond that.', values: { low: formatNumber(5001), high: formatNumber(25_000) } })}
          </Text>
        )}
        {draft.choice === 'custom' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <BandSelect
              value={draft.mode}
              onChange={(mode) => onChange(pickMode(draft, mode ?? draft.mode))}
              options={[{ value: 'exact', label: t`Exact number` }, { value: 'range', label: t({ message: 'Range', context: 'a number of assets between two bounds' }) }]}
            />
            {draft.mode === 'exact'
              ? (
                <NullableNumberInput
                  aria-label={t`Exact number`}
                  min={0}
                  className="w-[140px]"
                  value={draft.low}
                  onChange={(low) => onChange({ ...draft, low, high: low })}
                />
              )
              : (
                <div className="flex items-center gap-2">
                  <Text as="span" variant="content-compact"><Trans>Between</Trans></Text>
                  <NullableNumberInput aria-label={t`Minimum`} min={0} className="w-[110px]" value={draft.low} onChange={(low) => onChange({ ...draft, low })} />
                  <Text as="span" variant="content-compact"><Trans>and</Trans></Text>
                  <NullableNumberInput aria-label={t`Maximum`} min={0} className="w-[110px]" value={draft.high} onChange={(high) => onChange({ ...draft, high })} />
                </div>
              )}
          </div>
        )}
        {error !== null && (
          <Text as="p" variant="content-caption" className="text-feedback-error-primary" role="alert">
            {draftErrorLabel(error)}
          </Text>
        )}
        {asksExposure(kind, draft) && (
          <div className="flex flex-wrap items-center gap-2">
            <Text as="span" variant="content-caption" className="text-default-secondary">
              <Trans>At least one reachable from the Internet?</Trans>
            </Text>
            <YesNoGate value={draft.internetFacing} onChange={(internetFacing) => onChange({ ...draft, internetFacing })} />
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Nothing is prefilled: an unanswered kind is what the engine reads as nothing declared. The caller
 * holds the drafts and owns the save, so the questionnaire mounts wherever a scope is edited.
 */
export const DeclaredEstateQuestionnaire: FunctionComponent<DeclaredEstateQuestionnaireProps> = ({ drafts, onChange, measured }) => (
  <Paper elevation={1} className="flex max-w-[960px] flex-col p-[4px_20px_8px]">
    {DECLARED_ESTATE_KINDS_IN_ASSET_ORDER.map((kind) => (
      <KindRow
        key={kind}
        kind={kind}
        draft={drafts.get(kind) ?? EMPTY_DRAFT}
        onChange={(draft) => onChange(kind, draft)}
        measured={measured?.get(kind)}
      />
    ))}
  </Paper>
);
