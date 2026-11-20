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

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTRPC } from '../../../lib';
import { useEnterpriseEdition } from './use-enterprise-edition';

/**
 * Multi-tenancy is Enterprise Edition, so losing the entitlement shrinks the reader's tenant list
 * to one. The edition is polled rather than announced, so the list has to be asked again when it
 * flips.
 */
export const useRefetchTenantsOnEditionChange = (): void => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const isEnterpriseEdition = useEnterpriseEdition();

  useEffect(() => {
    // eslint-disable-next-line no-restricted-syntax -- the edition is process-local state relayed between processes, never a table, so no doorbell can tell this list that a downgrade shrank it.
    void queryClient.invalidateQueries(trpc.tenants.getTenants.queryFilter());
  }, [isEnterpriseEdition, queryClient, trpc]);
};
