import {
  Alert,
  Button,
  Chip,
  Paper,
  ProgressBar,
  Text,
} from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import type { DeclaredEstateKind } from '@app/module/client';
import { computeProgress, DEFAULT_REACTION_TIME_HOURS, isQuestionAnswered, QUESTION_IDS } from '@app/module/client';
import { zodResolver } from '@hookform/resolvers/zod';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { Controller, useForm, useFormState, useWatch } from 'react-hook-form';
import { uuidv7 } from 'uuidv7';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { MissingDataRow } from '../../../components/shared';
import type { DeclaredEstateDraft } from '../../declared-estate/declared-estate-utils';
import type { OptionalToleranceValues } from '../../risk-tolerance';
import type { ScopeCreationShortfall, ScopeLaterItem } from '../risk-scope-wizard-utils';
import type { ScopeFormValues } from './scope-form-fields';
import { InfoField, InfoTooltip, MISSING_DATA_ACTION_CLASS, MissingDataAccordion, SectionCard, UnsavedChangesDialog } from '../../../components/shared';
import { WizardStepIndicator } from '../../../components/shared/wizard-step-indicator';
import { useTRPC } from '../../../lib';
import { useHoldDoorbells } from '../../../providers/event-stream-provider';
import { formatNumber } from '../../../utils';
import { DeclaredEstateQuestionnaire } from '../../declared-estate';
import { declaredEstateKindLabel, declaredEstateStateLabel } from '../../declared-estate/declared-estate-labels';
import { changedAnswers, DECLARED_ESTATE_KINDS_IN_ASSET_ORDER, hasDraftErrors, hasUnsavedDrafts, resolveDrafts } from '../../declared-estate/declared-estate-utils';
import {
  answerSummary,
  EMPTY_FINANCIAL_PROFILE_ANSWERS,
  FinancialProfileQuestionnaireFields,
  QUESTION_LABELS,
  useFinancialProfileForm,
} from '../../financial-profiles';
import {
  AnnualLossField,
  completeTolerance,
  formatThreshold,
  MaxExceedancePercentField,
  optionalRiskToleranceSchema,
} from '../../risk-tolerance';
import {
  creationMappedAssetIds,
  creationShortfall,
  NO_CREATION_PROGRESS,
  pendingCreationWrites,
  runCreationWrites,
  scopeItemsToFillLater,
} from '../risk-scope-wizard-utils';
import { EMPTY_SCOPE_FORM, ScopeEstateFields, scopeFormSchema, ScopeIdentityFields } from './scope-form-fields';

type WizardStepKey = 'identity' | 'estate' | 'declared-estate' | 'financial-profile' | 'review';

interface WizardStep {
  key: WizardStepKey,
  label: () => string,
}

const STEPS: Array<WizardStep> = [
  { key: 'identity', label: () => t`Identity` },
  { key: 'estate', label: () => t`Estate` },
  { key: 'declared-estate', label: () => t`Declared estate` },
  { key: 'financial-profile', label: () => t`Financial profile` },
  { key: 'review', label: () => t`Review & Create` },
];

const stepIndex = (key: WizardStepKey): number => STEPS.findIndex((step) => step.key === key);

const estateKindCount = DECLARED_ESTATE_KINDS_IN_ASSET_ORDER.length;

const answeredOf = (answeredCount: number, totalCount: number): string => t`${answeredCount} of ${totalCount} answered`;

const LATER_ITEM_STEP: Record<ScopeLaterItem, WizardStepKey> = {
  'reaction-time': 'identity',
  'mapping': 'estate',
  'declared-estate': 'declared-estate',
  'tolerance': 'financial-profile',
  'questionnaire': 'financial-profile',
};

const shortfallAlert = (shortfall: ScopeCreationShortfall): { title: string, description: string } => {
  switch (shortfall) {
    case 'financial-profile':
      return {
        title: t`The risk scope is created, but part of its financial profile could not be saved.`,
        description: t`Retry, or open the risk scope and complete it from its Financial profile tab.`,
      };
    case 'declared-estate':
      return {
        title: t`The risk scope is created, but its declared estate could not be saved.`,
        description: t`Retry, or open the risk scope and complete it from its Declared estate tab.`,
      };
    case 'both':
      return {
        title: t`The risk scope is created, but part of its financial profile and its declared estate could not be saved.`,
        description: t`Retry, or open the risk scope and complete them from its Financial profile and Declared estate tabs.`,
      };
  }
};

const StepHeading: FunctionComponent<{ children: ReactNode, aside?: ReactNode }> = ({ children, aside }) => (
  <div className="flex items-center gap-2">
    <Text as="h2" variant="title-sm">{children}</Text>
    {aside}
  </div>
);

/** `handleSubmit` rather than `trigger`: only a submitted form re-validates on change, which clears a corrected field's error as it is typed. */
const passes = <T extends FieldValues>(target: UseFormReturn<T>): Promise<boolean> => new Promise((resolve) => {
  void target.handleSubmit(() => resolve(true), () => resolve(false))();
});

const formatReactionTime = (min: number | null, likely: number | null, max: number | null): string | null => (
  min === null || likely === null || max === null
    ? null
    : i18n._({
      id: '{min} / {likely} / {max} hours',
      message: '{min} / {likely} / {max} hours',
      values: { min: formatNumber(min), likely: formatNumber(likely), max: formatNumber(max) },
    })
);

export const RiskScopeWizard: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { toast } = useToast();
  const topRef = useRef<HTMLDivElement>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [createdId] = useState(uuidv7);
  const [progress, setProgress] = useState(NO_CREATION_PROGRESS);
  const [isCreating, setCreating] = useState(false);
  const isLocked = progress.scopeCreated;
  const isFrozen = isLocked || isCreating;
  // Set just before a navigation that must not be held, which runs before the render that unlocks it.
  const leavingRef = useRef(false);
  // A creation still running when the reader leaves must not pull them back to the scope.
  const mountedRef = useRef(true);
  const holdDoorbells = useHoldDoorbells();

  const form = useForm<ScopeFormValues>({
    resolver: zodResolver(scopeFormSchema),
    defaultValues: EMPTY_SCOPE_FORM,
  });
  const toleranceForm = useForm<OptionalToleranceValues>({
    resolver: zodResolver(optionalRiskToleranceSchema()),
  });

  const { data: countries } = useQuery(trpc.countries.getCountries.queryOptions());
  const { data: sectors } = useQuery(trpc.sectors.getSectors.queryOptions());
  const [
    name,
    description,
    legalEntityName,
    domain,
    sectorId,
    countryId,
    employeeCount,
    reactionTimeMin,
    reactionTimeLikely,
    reactionTimeMax,
    estateMode,
    mapping,
  ] = useWatch({
    control: form.control,
    name: ['name', 'description', 'legalEntityName', 'domain', 'sectorId', 'countryId', 'employeeCount', 'reactionTimeMin', 'reactionTimeLikely', 'reactionTimeMax', 'estateMode', 'mapping'],
  });
  const country = countries?.find((candidate) => candidate.id === countryId);
  const sector = sectors?.find((candidate) => candidate.id === sectorId);
  const reactionTime = formatReactionTime(reactionTimeMin, reactionTimeLikely, reactionTimeMax);

  const questionnaire = useFinancialProfileForm(undefined);
  const answersDirty = useFormState({ control: questionnaire.form.control }).isDirty;
  const identityDirty = useFormState({ control: form.control }).isDirty;
  const toleranceDirty = useFormState({ control: toleranceForm.control }).isDirty;
  const [estateDrafts, setEstateDrafts] = useState<Partial<Record<DeclaredEstateKind, DeclaredEstateDraft>>>({});
  // Nothing is stored before the scope exists, so the changed answers are the answered kinds.
  const estateAnswers = changedAnswers(estateDrafts, []);
  const estateDirty = hasUnsavedDrafts(estateDrafts, []);
  // Once the scope exists, leaving is what the failure alert offers, and it names what is lost.
  const hasUnsavedInput = !isLocked && (identityDirty || answersDirty || toleranceDirty || estateDirty);
  const blocker = useBlocker({
    shouldBlockFn: () => hasUnsavedInput && !leavingRef.current,
    withResolver: true,
    enableBeforeUnload: hasUnsavedInput,
  });
  const answers = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, ...useWatch({ control: questionnaire.form.control }) };
  const { answeredCount, totalCount } = computeProgress(answers);
  const tolerance = completeTolerance(useWatch({ control: toleranceForm.control }));
  const shortfall = creationShortfall(progress, { answers: answersDirty, declaredEstate: estateAnswers.length > 0, tolerance: tolerance !== null });

  const isReview = STEPS[currentStep]?.key === 'review';
  const mappedCount = creationMappedAssetIds(estateMode, mapping).length;
  const { data: estatePage } = useQuery(trpc.supportingAssets.listSupportingAssets.queryOptions(
    { page: 1, limit: 1, search: null, source: null, organizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false },
    { enabled: isReview && estateMode === 'closed' },
  ));

  const createOrganizations = useMutation(trpc.organizations.createOrganizationsTransaction.mutationOptions({
    meta: { skipSuccessToast: true },
  }));
  const setRiskTolerance = useMutation(trpc.organizations.setRiskTolerance.mutationOptions({
    meta: { skipSuccessToast: true },
  }));
  const saveDeclaredEstate = useMutation(trpc.declaredEstate.save.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start' });
  }, [currentStep]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const goToStep = (index: number) => {
    setCurrentStep(index);
  };

  const navigateToList = () => {
    void navigate({
      to: '/$tenantId/{-$organizationId}/risk-scopes',
      params: (prev) => ({ ...prev, tenantId: prev.tenantId! }),
    });
  };

  const navigateToCreatedScope = () => {
    leavingRef.current = true;
    void navigate({
      to: '/$tenantId/{-$organizationId}/details/overview',
      params: (prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId: createdId }),
    });
  };

  const isStepValid = async (key: WizardStepKey): Promise<boolean> => {
    switch (key) {
      case 'identity':
      case 'estate':
        return passes(form);
      case 'declared-estate':
        return !hasDraftErrors(estateDrafts);
      case 'financial-profile': {
        const [toleranceValid, answersValid] = await Promise.all([passes(toleranceForm), passes(questionnaire.form)]);
        return toleranceValid && answersValid;
      }
      case 'review':
        return true;
    }
  };

  const handleNext = async () => {
    const step = STEPS[currentStep];
    if (step !== undefined && await isStepValid(step.key)) {
      goToStep(Math.min(currentStep + 1, STEPS.length - 1));
    }
  };

  const create = async () => {
    for (const step of STEPS) {
      if (!await isStepValid(step.key)) {
        goToStep(stepIndex(step.key));
        return;
      }
    }
    const { mapping: delta, ...columns } = form.getValues();
    const answerValues = questionnaire.form.getValues();
    const toleranceValue = completeTolerance(toleranceForm.getValues());
    const wanted = { answers: answersDirty, declaredEstate: estateAnswers.length > 0, tolerance: toleranceValue !== null };
    setCreating(true);
    const release = holdDoorbells();
    const reached = await runCreationWrites(progress, pendingCreationWrites(progress, wanted), {
      scope: () => createOrganizations.mutateAsync([{
        id: createdId,
        ...columns,
        mappedAssetIds: creationMappedAssetIds(columns.estateMode, delta),
      }]),
      answers: () => questionnaire.save(answerValues, createdId),
      declaredEstate: () => saveDeclaredEstate.mutateAsync({ organizationId: createdId, answers: estateAnswers }),
      tolerance: () => (toleranceValue === null
        ? Promise.resolve()
        : setRiskTolerance.mutateAsync({ organizationId: createdId, tolerance: toleranceValue })),
    }, () => setProgress((previous) => ({ ...previous, scopeCreated: true }))).finally(release);
    setProgress(reached);
    setCreating(false);
    if (mountedRef.current && reached.scopeCreated && pendingCreationWrites(reached, wanted).length === 0) {
      toast({ description: t`Risk scope created successfully.` });
      navigateToCreatedScope();
    }
  };

  const editAction = (key: WizardStepKey): ReactNode => (isFrozen ? undefined : (
    <Button type="button" priority="tertiary" size="sm" onClick={() => goToStep(stepIndex(key))}>{t`Edit`}</Button>
  ));

  const laterRow = (item: ScopeLaterItem): MissingDataRow => {
    const action = isFrozen ? undefined : (
      <button type="button" className={MISSING_DATA_ACTION_CLASS} onClick={() => goToStep(stepIndex(LATER_ITEM_STEP[item]))}>{t`Edit`}</button>
    );
    switch (item) {
      case 'reaction-time':
        return {
          key: item,
          label: t`Containment time (MTTC)`,
          description: i18n._({
            id: 'Priced with {min} / {likely} / {max} hours until set.',
            message: 'Priced with {min} / {likely} / {max} hours until set.',
            values: {
              min: formatNumber(DEFAULT_REACTION_TIME_HOURS.min),
              likely: formatNumber(DEFAULT_REACTION_TIME_HOURS.likely),
              max: formatNumber(DEFAULT_REACTION_TIME_HOURS.max),
            },
          }),
          action,
        };
      case 'mapping':
        return { key: item, label: t`Mapped assets`, description: t`No asset is mapped yet.`, action };
      case 'declared-estate':
        return {
          key: item,
          label: t`Declared estate`,
          description: plural(estateKindCount - estateAnswers.length, { one: '# kind of asset unanswered', other: '# kinds of asset unanswered' }),
          action,
        };
      case 'tolerance':
        return { key: item, label: t`Risk tolerance`, description: t`Not set: no scenario of the scope is judged against a threshold.`, action };
      case 'questionnaire':
        return {
          key: item,
          label: t`Financial profile`,
          description: plural(totalCount - answeredCount, { one: '# question unanswered', other: '# questions unanswered' }),
          action,
        };
    }
  };

  const laterRows = scopeItemsToFillLater({
    reactionTimeSet: reactionTime !== null,
    estateMode,
    mappedCount,
    unansweredEstateKindCount: estateKindCount - estateAnswers.length,
    toleranceSet: tolerance !== null,
    unansweredCount: totalCount - answeredCount,
  }).map(laterRow);

  const answeredQuestions = QUESTION_IDS.filter((id) => isQuestionAnswered(id, answers));
  const answeredEstateKinds = DECLARED_ESTATE_KINDS_IN_ASSET_ORDER.flatMap((kind) => estateAnswers.filter((answer) => answer.kind === kind));
  const stepKey = STEPS[currentStep]?.key;

  return (
    <div ref={topRef} className="flex flex-col gap-8">
      <Text as="h1" variant="title-xl"><Trans>Create a risk scope</Trans></Text>

      <WizardStepIndicator steps={STEPS} currentStep={currentStep} />

      <form noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-6">
        <Paper padding={24} className="flex flex-col gap-4">
          {stepKey === 'identity' && (
            <>
              <StepHeading><Trans>What is this risk scope?</Trans></StepHeading>
              <ScopeIdentityFields control={form.control} />
            </>
          )}

          {stepKey === 'estate' && (
            <>
              <StepHeading><Trans>Which assets is this risk scope measured over?</Trans></StepHeading>
              <ScopeEstateFields control={form.control} mappedCount={0} />
            </>
          )}

          {stepKey === 'declared-estate' && (
            <>
              <StepHeading aside={<Chip label={t`Optional`} />}>
                <Trans>How many assets of each kind does this risk scope hold?</Trans>
              </StepHeading>
              <DeclaredEstateQuestionnaire
                drafts={resolveDrafts(estateDrafts, [])}
                onChange={(kind, draft) => setEstateDrafts((previous) => ({ ...previous, [kind]: draft }))}
              />
            </>
          )}

          {stepKey === 'financial-profile' && (
            <>
              <StepHeading aside={<Chip label={t`Optional`} />}>
                <Trans>What would an attack cost this risk scope?</Trans>
              </StepHeading>
              <div className="flex items-center gap-1">
                <Text as="h3" variant="content-compact-bold"><Trans>Risk tolerance</Trans></Text>
                <InfoTooltip label={t`Risk tolerance`}>
                  <Trans>The highest probability of a year's loss exceeding an amount the organisation accepts.</Trans>
                  <Trans>Applied to each scenario of the scope on its own, never to their sum. A scenario can set its own threshold from its loss exceedance curve.</Trans>
                </InfoTooltip>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  control={toleranceForm.control}
                  name="annualLoss"
                  render={({ field, fieldState }) => (
                    <AnnualLossField
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      inputRef={field.ref}
                      error={fieldState.error?.message}
                      required={false}
                    />
                  )}
                />
                <Controller
                  control={toleranceForm.control}
                  name="maxExceedancePercent"
                  render={({ field, fieldState }) => (
                    <MaxExceedancePercentField
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      inputRef={field.ref}
                      error={fieldState.error?.message}
                      required={false}
                    />
                  )}
                />
              </div>
              <Text as="h3" variant="content-compact-bold" className="border-t border-[var(--fds-border-elevation-subtle)] pt-4">
                <Trans>Questionnaire</Trans>
              </Text>
              <FinancialProfileQuestionnaireFields
                form={questionnaire.form}
                revenueBand={null}
                countryName={country?.name}
                countryIsoAlpha3={country?.isoAlpha3}
              />
            </>
          )}

          {stepKey === 'review' && (
            <>
              <StepHeading>{name}</StepHeading>
              {description !== null && (
                <Text as="p" variant="content-compact" className="text-default-secondary">{description}</Text>
              )}
              <div className="grid grid-cols-2 items-start gap-6">
                <SectionCard title={t`Identity`} headerAction={editAction('identity')}>
                  <div className="flex flex-col gap-3">
                    <InfoField title={t`Legal Entity Name`} value={legalEntityName} />
                    <InfoField title={t`Domain`} value={domain} />
                    <InfoField title={t`Sector`} value={sector?.name} />
                    <InfoField title={t`Country`} value={country?.name} />
                    <InfoField title={t`Employee Count`} value={employeeCount != null ? formatNumber(employeeCount) : null} />
                    <InfoField title={t`Containment time (MTTC)`} value={reactionTime} />
                  </div>
                </SectionCard>
                <SectionCard title={t`Estate`} headerAction={editAction('estate')}>
                  <div className="flex flex-col gap-3">
                    <InfoField title={t`Estate measured`} value={estateMode === 'open' ? t`Whole estate` : t`Mapped assets only`} />
                    {estateMode === 'closed' && (
                      <InfoField
                        title={t`Mapped assets`}
                        value={estatePage === undefined
                          ? formatNumber(mappedCount)
                          : i18n._({
                            id: '{selected} of {total}',
                            message: '{selected} of {total}',
                            values: { selected: formatNumber(mappedCount), total: formatNumber(estatePage.estateTotal) },
                          })}
                      />
                    )}
                  </div>
                </SectionCard>
                <SectionCard title={t`Declared estate`} headerAction={editAction('declared-estate')}>
                  <div className="flex flex-col gap-3">
                    <InfoField
                      title={t`Answers`}
                      value={answeredOf(answeredEstateKinds.length, estateKindCount)}
                    />
                    {answeredEstateKinds.map((answer) => (
                      <InfoField key={answer.kind} title={declaredEstateKindLabel(answer.kind)} value={declaredEstateStateLabel(answer)} />
                    ))}
                  </div>
                </SectionCard>
                <SectionCard title={t`Financial profile`} headerAction={editAction('financial-profile')}>
                  <div className="flex flex-col gap-3">
                    <InfoField title={t`Risk tolerance`} value={tolerance === null ? null : formatThreshold(tolerance)} />
                    <div className="flex flex-col gap-1.5">
                      <InfoField
                        title={t`Questionnaire`}
                        value={answeredOf(answeredCount, totalCount)}
                      />
                      <ProgressBar aria-label={t`Progress`} value={(answeredCount / totalCount) * 100} />
                    </div>
                    {answeredQuestions.map((id) => (
                      <InfoField key={id} title={QUESTION_LABELS[id]()} value={answerSummary(id, answers)} />
                    ))}
                  </div>
                </SectionCard>
              </div>
              <MissingDataAccordion title={t`To complete later`} items={laterRows} />
              {isLocked && !isCreating && shortfall !== null && (
                <Alert severity="error" {...shortfallAlert(shortfall)} />
              )}
            </>
          )}
        </Paper>

        <div className="flex items-center justify-between border-t pt-4">
          {isLocked
            ? <Button type="button" priority="secondary" onClick={navigateToCreatedScope}>{t`Open the risk scope`}</Button>
            : (
              <Button type="button" priority="secondary" disabled={isCreating} onClick={currentStep === 0 ? navigateToList : () => goToStep(currentStep - 1)}>
                {currentStep === 0 ? t`Cancel` : t`Back`}
              </Button>
            )}
          {isReview
            ? (
              <Button type="button" onClick={() => void create()} disabled={isCreating}>
                {isCreating ? t`Creating...` : (isLocked ? t`Retry` : t`Create risk scope`)}
              </Button>
            )
            : <Button type="button" onClick={() => void handleNext()}>{t`Next`}</Button>}
        </div>
      </form>

      <UnsavedChangesDialog open={blocker.status === 'blocked'} onStay={() => blocker.reset?.()} onDiscard={() => blocker.proceed?.()} />
    </div>
  );
};
