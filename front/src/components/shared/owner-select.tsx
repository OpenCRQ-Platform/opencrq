import { t } from '@lingui/core/macro';
import type { FunctionComponent, Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib';
import { useTenant } from '../../providers';
import { SingleSelectField } from './select-field';

interface OwnerSelectProps {
  value: string | null,
  onChange: (value: string | null) => void,
  label: string,
  onBlur?: () => void,
  inputRef?: Ref<HTMLInputElement>,
  required?: boolean,
  error?: string,
}

export const OwnerSelect: FunctionComponent<OwnerSelectProps> = (props) => {
  const trpc = useTRPC();
  const { tenantId } = useTenant();
  const { data } = useQuery(trpc.tenants.getTenantUsers.queryOptions({ tenantId }));

  const options = (data ?? []).map((tenantUser) => ({
    label: tenantUser.user.name || tenantUser.user.email,
    value: tenantUser.userId,
  }));

  return (
    <SingleSelectField
      {...props}
      options={options}
      placeholder={t`Select owner`}
      emptyMessage={t`No users found`}
    />
  );
};
