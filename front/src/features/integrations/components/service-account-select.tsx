import { IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import type { FunctionComponent, Ref } from 'react';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';

interface ServiceAccountSelectProps {
  value: string,
  onChange: (value: string) => void,
  onBlur?: () => void,
  triggerRef?: Ref<HTMLButtonElement>,
  serviceAccounts: Array<{ id: string, name: string, active: boolean }>,
  /**
   * The currently persisted service account id, if any — kept selectable (flagged "(inactive)")
   * even once deactivated, so an already-configured account doesn't silently vanish from the list.
   */
  configuredServiceAccountId?: string,
  /** Whether the field may be emptied, which unbinds the connector from the account it runs as. */
  allowClear?: boolean,
  label?: string,
  required?: boolean,
  error?: string,
}

export const ServiceAccountSelect: FunctionComponent<ServiceAccountSelectProps> = ({
  value,
  onChange,
  onBlur,
  triggerRef,
  serviceAccounts,
  configuredServiceAccountId,
  allowClear,
  label,
  required,
  error,
}) => {
  const activeServiceAccounts = serviceAccounts.filter((sa) => sa.active);
  const configuredInactiveAccount = serviceAccounts.find((sa) => !sa.active && sa.id === configuredServiceAccountId);
  const selectableServiceAccounts = configuredInactiveAccount ? [...activeServiceAccounts, configuredInactiveAccount] : activeServiceAccounts;

  if (selectableServiceAccounts.length === 0) {
    return (
      <div>
        {label !== undefined && <SelectLabel required={required}>{label}</SelectLabel>}
        <p className="txt-sub-content text-muted-foreground">
          <Trans>No service account is available on this tenant.</Trans>
          {' '}
          <Link from="/$tenantId/{-$organizationId}" to="settings/security/service-accounts" className="underline">
            <Trans>Create one first.</Trans>
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <Select value={value} onValueChange={onChange} error={error !== undefined}>
        {label !== undefined && <SelectLabel required={required}>{label}</SelectLabel>}
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <SelectTrigger ref={triggerRef} className="w-full" onBlur={onBlur}>
              <SelectValue placeholder={t`Select a service account`} />
            </SelectTrigger>
            <SelectContent>
              {selectableServiceAccounts.map((sa) => {
                const name = sa.name;
                return (
                  <SelectItem key={sa.id} value={sa.id}>
                    {sa.active ? name : <Trans>{name} (inactive)</Trans>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </span>
          {/* Radix rejects an empty option value, so unbinding is its own control rather than a row. */}
          {allowClear === true && value !== '' && (
            <IconButton
              type="button"
              priority="tertiary"
              size="md"
              aria-label={t`Remove the service account`}
              onClick={() => onChange('')}
              icon={<X className="size-4" />}
            />
          )}
        </span>
        {error !== undefined && <SelectHelperText>{error}</SelectHelperText>}
      </Select>
    </div>
  );
};
