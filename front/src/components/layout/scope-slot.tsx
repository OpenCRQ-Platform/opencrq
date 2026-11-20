/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { HeaderGroup, Text } from '@filigran/design-system';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select';
import { useTRPC } from '../../lib';
import { useOptionalTenant } from '../../providers';

/** The header's scope slot: the tenant, named once for the whole application. */
export const ScopeSlot: FunctionComponent = () => {
  const trpc = useTRPC();
  const tenantContext = useOptionalTenant();
  const navigate = useNavigate();
  const { data: tenants } = useQuery(trpc.tenants.getTenants.queryOptions());

  if (!tenantContext || !tenants || tenants.length === 0) {
    return <HeaderGroup />;
  }

  return (
    <HeaderGroup>
      <div className="flex items-center gap-3">
        {tenants.length > 1 ? (
          <Select
            value={tenantContext.tenantId}
            onValueChange={(value) => {
              void navigate({ to: '/$tenantId/{-$organizationId}', params: { tenantId: value, organizationId: undefined } });
            }}
          >
            <SelectLabel className="mb-0"><Trans>Tenant</Trans></SelectLabel>
            <SelectTrigger>
              <SelectValue placeholder={t`Select a tenant`} />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <Text as="span" variant="content-compact" className="text-default-secondary"><Trans>Tenant</Trans></Text>
            <Text as="span" variant="content-compact">{tenants[0].name}</Text>
          </>
        )}
      </div>
    </HeaderGroup>
  );
};
