import { Button, Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MissingDataAccordion, NullableInput, OwnerSelect } from '../../../components/shared';
import { WizardStepIndicator } from '../../../components/shared/wizard-step-indicator';
import { useTRPC } from '../../../lib';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { countCompatibleCells, generateScenarioName, partitionAssetsByCompatibility, resolveAssetNames } from '../risk-scenario-utils';
import { WizardMultiSelectionGrid, WizardSelectionGrid } from './wizard-selection-card';

const formSchema = z.object({
  organizationId: z.string().min(1),
  attackOutcomeId: z.string().min(1),
  primaryAssetIds: z.array(z.string()).min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  ownerId: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

interface WizardStep {
  key: string,
  label: () => string,
  fields: Array<keyof FormValues>,
}

const ORGANIZATION_STEP: WizardStep = { key: 'organization', label: () => t`Risk scope`, fields: ['organizationId'] };

const BASE_STEPS: Array<WizardStep> = [
  { key: 'outcome', label: () => t`Outcome`, fields: ['attackOutcomeId'] },
  { key: 'asset', label: () => t`Target Assets`, fields: ['primaryAssetIds'] },
  { key: 'review', label: () => t`Review & Create`, fields: ['name'] },
];

interface ReviewSummaryCardProps {
  label: string,
  name: string,
}

const ReviewSummaryCard: FunctionComponent<ReviewSummaryCardProps> = ({ label, name }) => (
  <div className="flex flex-col gap-1">
    <span className="txt-sub-content font-medium text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="txt-body2 font-medium">{name}</span>
    </div>
  </div>
);

interface RiskScenarioWizardProps {
  organizationId?: string,
  /** Prefills the outcome step, e.g. from a threat's "Quantify risk" action; the reader can still change it. */
  initialAttackOutcomeId?: string,
}

export const RiskScenarioWizard: FunctionComponent<RiskScenarioWizardProps> = ({ organizationId, initialAttackOutcomeId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const nameManuallyEdited = useRef(false);

  const steps = organizationId === undefined ? [ORGANIZATION_STEP, ...BASE_STEPS] : BASE_STEPS;

  const navigateBack = () => {
    if (organizationId !== undefined) {
      void navigate({
        to: '/$tenantId/{-$organizationId}/risk-scenarios',
        params: (prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId }),
      });
    } else {
      void navigate({
        to: '/$tenantId/{-$organizationId}/risk-scenarios',
        params: (prev) => ({ ...prev, tenantId: prev.tenantId! }),
      });
    }
  };

  const createRiskScenario = useMutation(trpc.riskScenarios.createRiskScenario.mutationOptions({
    meta: { successMessage: msg`Risk scenario created successfully.` },
    onSuccess: (_data, variables) => {
      void navigate({
        to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/overview',
        params: (prev) => ({ ...prev, tenantId: prev.tenantId!, riskScenarioId: variables.id }),
      });
    },
  }));

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      organizationId: organizationId ?? '',
      attackOutcomeId: initialAttackOutcomeId ?? '',
      primaryAssetIds: [],
      name: '',
      description: null,
      ownerId: null,
    },
  });

  // Watch fields for auto-name generation
  const attackOutcomeId = useWatch({ control: form.control, name: 'attackOutcomeId' });
  const primaryAssetIds = useWatch({ control: form.control, name: 'primaryAssetIds' });
  const selectedOrganizationId = useWatch({ control: form.control, name: 'organizationId' });

  // Fetch data for selections and name generation
  const { data: organizations } = useQuery(trpc.organizations.getOrganizations.queryOptions(
    undefined,
    { enabled: organizationId === undefined },
  ));
  const { data: attackOutcomes } = useQuery(trpc.attackOutcomes.getAttackOutcomes.queryOptions());
  const { data: primaryAssets } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions(
    { organizationId: selectedOrganizationId },
    { enabled: !!selectedOrganizationId },
  ));

  // Auto-generate name
  useEffect(() => {
    if (nameManuallyEdited.current) {
      return;
    }

    const outcome = attackOutcomes?.find((o) => o.id === attackOutcomeId);
    const outcomeName = outcome?.name;
    const assetNames = resolveAssetNames(primaryAssetIds, primaryAssets);

    const scenarioName = generateScenarioName({ outcomeName, assetNames });
    if (scenarioName) {
      form.setValue('name', scenarioName);
    }
  }, [attackOutcomeId, primaryAssetIds, attackOutcomes, primaryAssets, form]);

  // Resolve selected names for review summary
  const selectedOutcome = attackOutcomes?.find((o) => o.id === attackOutcomeId);
  const selectedOutcomeName = selectedOutcome?.name;
  const selectedAssetNames = resolveAssetNames(primaryAssetIds, primaryAssets);

  // The categories the chosen outcome can reach. Re-queried whenever the outcome changes at step 0,
  // so going back and switching outcome refreshes the suggestion instead of freezing the first one.
  const { data: compatibleCategoryIds, isLoading: isLoadingCompatibleCategoryIds } = useQuery(trpc.lossDrivers.getCompatibleBusinessValueCategoryIds.queryOptions(
    { attackOutcomeId },
    { enabled: !!attackOutcomeId },
  ));
  const { suggested: suggestedAssets, others: otherAssets } = partitionAssetsByCompatibility(
    primaryAssets ?? [],
    compatibleCategoryIds ?? [],
  );
  const compatibleCellCount = countCompatibleCells(primaryAssets ?? [], primaryAssetIds, compatibleCategoryIds ?? []);

  const handleNext = async () => {
    const fields = steps[currentStep]?.fields;
    if (!fields) {
      return;
    }
    const valid = await form.trigger(fields);
    if (valid) {
      setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
    }
  };

  const selectOrganization = (id: string) => {
    form.setValue('organizationId', id, { shouldValidate: true });
    // Primary assets belong to the organization: a different unit invalidates the selection.
    form.setValue('primaryAssetIds', []);
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  const toggleAsset = (id: string) => {
    const current = form.getValues('primaryAssetIds');
    const updated = current.includes(id)
      ? current.filter((i) => i !== id)
      : [...current, id];
    form.setValue('primaryAssetIds', updated, { shouldValidate: true });
  };

  const onSubmit = (values: FormValues) => {
    createRiskScenario.mutate({
      id: uuidv7(),
      organizationId: values.organizationId,
      name: values.name,
      description: values.description,
      ownerId: values.ownerId,
      attackOutcomeId: values.attackOutcomeId,
      primaryAssetIds: values.primaryAssetIds,
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-bold"><Trans>Create Risk Scenario</Trans></h1>
        <p className="mt-1 txt-sub-content text-muted-foreground">
          <Trans>Define a risk scenario by selecting an outcome and target assets.</Trans>
        </p>
      </div>

      <WizardStepIndicator steps={steps} currentStep={currentStep} />

      <form noValidate onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-6">
        {steps[currentStep]?.key === 'organization' && (
          <div className="flex flex-col gap-4">
            <h2 className="font-semibold"><Trans>Select a risk scope</Trans></h2>
            <p className="txt-sub-content text-muted-foreground">
              <Trans>Which risk scope is this risk scenario about?</Trans>
            </p>
            <WizardSelectionGrid
              items={organizations ?? []}
              selectedId={selectedOrganizationId || null}
              onSelect={selectOrganization}
            />
          </div>
        )}

        {steps[currentStep]?.key === 'outcome' && (
          <div className="flex flex-col gap-4">
            <h2 className="font-semibold"><Trans>Select an Attack Outcome</Trans></h2>
            <p className="txt-sub-content text-muted-foreground">
              <Trans>What is the expected impact of this threat?</Trans>
            </p>
            <WizardSelectionGrid
              items={attackOutcomes ?? []}
              selectedId={attackOutcomeId || null}
              onSelect={(id) => form.setValue('attackOutcomeId', id, { shouldValidate: true })}
            />
          </div>
        )}

        {steps[currentStep]?.key === 'asset' && (
          <div className="flex flex-col gap-4">
            <h2 className="font-semibold"><Trans>Select Target Assets</Trans></h2>
            <p className="txt-sub-content text-muted-foreground">
              <Trans>Select the primary assets impacted by this risk scenario.</Trans>
            </p>
            {suggestedAssets.length > 0 && (
              <div className="flex flex-col gap-3">
                <span className="txt-category"><Trans>Suggested for this outcome</Trans></span>
                <WizardMultiSelectionGrid
                  items={suggestedAssets}
                  selectedIds={primaryAssetIds}
                  onToggle={toggleAsset}
                />
              </div>
            )}
            {otherAssets.length > 0 && (
              <div className="flex flex-col gap-3">
                {suggestedAssets.length > 0 && (
                  <span className="txt-category text-muted-foreground"><Trans>Other assets</Trans></span>
                )}
                <WizardMultiSelectionGrid
                  items={otherAssets}
                  selectedIds={primaryAssetIds}
                  onToggle={toggleAsset}
                />
              </div>
            )}
          </div>
        )}

        {steps[currentStep]?.key === 'review' && (
          <div className="flex flex-col gap-6">
            <h2 className="font-semibold"><Trans>Review & Create</Trans></h2>
            <p className="txt-sub-content text-muted-foreground">
              <Trans>Review your selections, adjust the name if needed, and create the scenario.</Trans>
            </p>

            {/* Summary grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {organizationId === undefined && (
                <ReviewSummaryCard
                  label={t`Risk scope`}
                  name={organizations?.find((organization) => organization.id === selectedOrganizationId)?.name ?? EMPTY_VALUE}
                />
              )}
              <ReviewSummaryCard label={t`Attack Outcome`} name={selectedOutcomeName ?? EMPTY_VALUE} />
              <ReviewSummaryCard label={t`Target Assets`} name={selectedAssetNames.length > 0 ? selectedAssetNames.join(', ') : EMPTY_VALUE} />
            </div>

            {/* Non-blocking: the scenario is legal, it simply recommends no loss driver. */}
            {!isLoadingCompatibleCategoryIds && compatibleCellCount === 0 && (
              <MissingDataAccordion
                title={t`No loss driver is recommended`}
                items={[{
                  key: 'no-recommendation',
                  label: t`Outcome and targets`,
                  description: t`This outcome and the business resources of these assets have no combination in the loss model. You can still create the scenario and price any driver.`,
                }]}
              />
            )}

            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Input
                  {...field}
                  label={t`Name`}
                  required
                  className="max-w-lg"
                  onChange={(e) => {
                    nameManuallyEdited.current = true;
                    field.onChange(e);
                  }}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <NullableInput
                  {...field}
                  label={t`Description`}
                  className="max-w-lg"
                  placeholder={t`Optional description`}
                  error={fieldState.error?.message}
                />
              )}
            />
            <div className="max-w-lg">
              <Controller
                control={form.control}
                name="ownerId"
                render={({ field, fieldState }) => (
                  <OwnerSelect
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    label={t`Owner`}
                    error={fieldState.error?.message}
                  />
                )}
              />
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between border-t pt-4">
          <Button
            type="button"
            priority="secondary"
            onClick={currentStep === 0 ? navigateBack : handleBack}
          >
            {currentStep === 0 ? t`Cancel` : t`Back`}
          </Button>
          {currentStep < steps.length - 1
            ? (
              <Button type="button" onClick={handleNext}>
                {t`Next`}
              </Button>
            )
            : (
              <Button type="button" onClick={() => void form.handleSubmit(onSubmit)()} disabled={createRiskScenario.isPending}>
                {createRiskScenario.isPending ? t`Creating...` : t`Create Scenario`}
              </Button>
            )}
        </div>
      </form>
    </div>
  );
};
