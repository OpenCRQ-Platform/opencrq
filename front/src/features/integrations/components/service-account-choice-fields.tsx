import { Input, RadioGroup } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { Control, FieldValues, Path } from 'react-hook-form';
import { Controller, useWatch } from 'react-hook-form';
import type { ServiceAccountChoiceValues, ServiceAccountMode, ServiceAccountOption } from '../service-account-choice-utils';
import { RadioCard } from '../../../components/shared';
import { selectableServiceAccounts, SERVICE_ACCOUNT_MODES } from '../service-account-choice-utils';
import { ServiceAccountSelect } from './service-account-select';

const isServiceAccountMode = (value: string): value is ServiceAccountMode =>
  (SERVICE_ACCOUNT_MODES as ReadonlyArray<string>).includes(value);

interface ServiceAccountChoiceFieldsProps<T extends FieldValues & ServiceAccountChoiceValues> {
  control: Control<T>,
  serviceAccounts: ReadonlyArray<ServiceAccountOption>,
  configuredServiceAccountId?: string,
  /** Whether an existing account may be emptied, which unbinds the connector from the account it runs as. */
  allowClear?: boolean,
}

/**
 * The account an integration runs as, chosen in the drawer: a new one created with the configuration
 * (the default, as when a connector is created in OpenCTI), or one the tenant already has. A tenant
 * with no account to reuse is offered the new one alone, so it never leaves the drawer to make one.
 */
export const ServiceAccountChoiceFields = <T extends FieldValues & ServiceAccountChoiceValues>({
  control,
  serviceAccounts,
  configuredServiceAccountId,
  allowClear,
}: ServiceAccountChoiceFieldsProps<T>) => {
  // The generic form type hides these names from react-hook-form's path inference: they are
  // guaranteed by `ServiceAccountChoiceValues`.
  const modeName = 'serviceAccountMode' as Path<T>;
  const nameName = 'newServiceAccountName' as Path<T>;
  const idName = 'serviceAccountId' as Path<T>;
  const mode = useWatch({ control, name: modeName }) as ServiceAccountMode;
  const canReuse = selectableServiceAccounts(serviceAccounts, configuredServiceAccountId).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <span className="txt-category">{t`Service account`}</span>
      {canReuse && (
        <Controller
          control={control}
          name={modeName}
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(value) => {
                if (isServiceAccountMode(value)) {
                  field.onChange(value);
                }
              }}
              aria-label={t`Service account`}
              className="flex flex-col gap-3"
            >
              <RadioCard
                value="new"
                title={t`Create a new service account`}
                description={t`Created with the integration, in the Connectors group.`}
              />
              <RadioCard
                value="existing"
                title={t`Use an existing service account`}
                description={t`The integration runs as an account the tenant already has.`}
              />
            </RadioGroup>
          )}
        />
      )}
      {!canReuse && (
        <p className="txt-sub-content text-muted-foreground">
          {t`A new service account is created with the integration, in the Connectors group.`}
        </p>
      )}
      {(mode === 'new' || !canReuse) && (
        <Controller
          control={control}
          name={nameName}
          render={({ field, fieldState }) => (
            <Input
              {...field}
              value={field.value as string}
              label={t`Service account name`}
              required
              error={fieldState.error?.message}
            />
          )}
        />
      )}
      {mode === 'existing' && canReuse && (
        <Controller
          control={control}
          name={idName}
          render={({ field, fieldState }) => (
            <ServiceAccountSelect
              value={field.value as string}
              onChange={field.onChange}
              onBlur={field.onBlur}
              triggerRef={field.ref}
              serviceAccounts={serviceAccounts}
              configuredServiceAccountId={configuredServiceAccountId}
              allowClear={allowClear}
              label={t`Service account`}
              required={allowClear !== true}
              error={fieldState.error?.message}
            />
          )}
        />
      )}
    </div>
  );
};
