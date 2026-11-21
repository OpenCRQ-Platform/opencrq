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

import { Icon, Menu, MenuContent, MenuItem, MenuTrigger, NavbarItem, useNavbarCollapsed } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../lib';
import { useOptionalTenant } from '../../providers';
import { NavbarRowContent } from './main-layout/fds-navbar/navbar-row-content';

/**
 * The tenant switcher, the first row of the navbar as in OpenAEV: shown only to a reader who can
 * switch, that is who reaches two tenants or more. With one tenant nothing names it anywhere.
 */
export const ScopeSlot: FunctionComponent = () => {
  const trpc = useTRPC();
  const tenantContext = useOptionalTenant();
  const collapsed = useNavbarCollapsed();
  const { data: tenants } = useQuery(trpc.tenants.getTenants.queryOptions());

  if (!tenantContext || !tenants || tenants.length <= 1) {
    return null;
  }

  const current = tenants.find((tenant) => tenant.id === tenantContext.tenantId);
  const displayName = current?.name ?? t`Select a tenant`;

  return (
    <Menu>
      <MenuTrigger asChild>
        <NavbarItem asChild tooltipLabel={displayName}>
          <button type="button">
            <NavbarRowContent icon={<Icon name="building-2" size={16} aria-hidden />}>
              {displayName}
            </NavbarRowContent>
            {!collapsed && (
              <span className="inline-flex shrink-0 text-default-secondary" aria-hidden>
                <Icon name="chevrons-up-down" size={16} />
              </span>
            )}
          </button>
        </NavbarItem>
      </MenuTrigger>
      <MenuContent align="start" side="right">
        {tenants.map((tenant) => (
          <MenuItem key={tenant.id} asChild selected={tenant.id === tenantContext.tenantId}>
            <Link to="/$tenantId/{-$organizationId}" params={{ tenantId: tenant.id, organizationId: undefined }}>
              {tenant.name}
            </Link>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
};
