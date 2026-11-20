import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { CompanyFormValues } from '../company-form';
import { NullableNumberInput } from '../../../components/shared';
import { Loader } from '../../../components/ui/loader';
import { useTRPC } from '../../../lib';
import { CountrySelect, RevenueBandSelect, SectorSelect } from '../../organizations';
import { companyFormSchema } from '../company-form';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { OnboardingStepLayout } from './onboarding-step-layout';
import { SeeAllLink } from './see-all-link';

const CompanyForm: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data: organization } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }));
  const updateOrganization = useMutation(trpc.organizations.updateOrganization.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: { name: '', sectorId: null, countryId: null, revenueBand: null, employeeCount: null },
    // A doorbell refetching the scope must not undo what the reader is typing.
    resetOptions: { keepDirtyValues: true },
    values: organization
      ? {
        name: organization.name,
        sectorId: organization.sectorId,
        countryId: organization.countryId,
        revenueBand: organization.revenueBand,
        employeeCount: organization.employeeCount,
      }
      : undefined,
  });

  /** Writes the given fields alone, and nothing when the scope already holds them. */
  const saveFields = async (patch: Partial<CompanyFormValues>) => {
    if (!organization) {
      return;
    }
    if (Object.keys(patch).every((key) => Reflect.get(patch, key) === Reflect.get(organization, key))) {
      return;
    }
    try {
      await updateOrganization.mutateAsync({ id: organizationId, ...patch });
    } catch {
      // The failed write already raised its own error toast.
    }
  };

  const saveName = async () => {
    // A blank name is refused by the schema: it shows its error and nothing is written.
    if (await form.trigger('name')) {
      await saveFields({ name: form.getValues('name').trim() });
    }
  };

  const saveEmployeeCount = async () => {
    if (await form.trigger('employeeCount')) {
      await saveFields({ employeeCount: form.getValues('employeeCount') });
    }
  };

  if (!organization) {
    return <Loader />;
  }

  return (
    <OnboardingStepLayout
      stepKey="company"
      why={t`Your sector, country and size set how often organizations like yours are attacked. This step describes your first risk scope.`}
    >
      <form noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-4">
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Input
              {...field}
              onBlur={() => {
                field.onBlur();
                void saveName();
              }}
              label={t`Name`}
              required
              error={fieldState.error?.message}
            />
          )}
        />
        <div className="grid grid-cols-2 items-start gap-4">
          <Controller
            control={form.control}
            name="sectorId"
            render={({ field, fieldState }) => (
              <SectorSelect
                value={field.value}
                onValueChange={(sectorId) => {
                  field.onChange(sectorId);
                  void saveFields({ sectorId });
                }}
                onBlur={field.onBlur}
                triggerRef={field.ref}
                label={t`Sector`}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="countryId"
            render={({ field, fieldState }) => (
              <CountrySelect
                value={field.value}
                onValueChange={(countryId) => {
                  field.onChange(countryId);
                  void saveFields({ countryId });
                }}
                onBlur={field.onBlur}
                triggerRef={field.ref}
                label={t`Country`}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="revenueBand"
            render={({ field, fieldState }) => (
              <RevenueBandSelect
                value={field.value}
                onValueChange={(revenueBand) => {
                  field.onChange(revenueBand);
                  void saveFields({ revenueBand });
                }}
                onBlur={field.onBlur}
                triggerRef={field.ref}
                label={t`Revenue band`}
                helperText={t`Derived from the annual revenue you can set in the Finances step.`}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="employeeCount"
            render={({ field, fieldState }) => (
              <NullableNumberInput
                {...field}
                onBlur={() => {
                  field.onBlur();
                  void saveEmployeeCount();
                }}
                label={t`Employee Count`}
                min="0"
                step="1"
                error={fieldState.error?.message}
              />
            )}
          />
        </div>
      </form>
      <div>
        <SeeAllLink to="/$tenantId/{-$organizationId}/details/overview" organizationId={organizationId} label={t`See the risk scope`} />
      </div>
    </OnboardingStepLayout>
  );
};

export const CompanyStep: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();

  if (wizard === null || wizard === undefined) {
    return <Loader />;
  }

  return <CompanyForm organizationId={wizard.organizationId} />;
};
