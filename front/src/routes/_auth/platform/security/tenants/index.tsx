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

import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { TENANTS_LIST_SEARCH_DEFAULTS, tenantsListSearchSchema } from '../../../../../features/tenants/tenants-list-search';
import { TenantsDataTable } from '../../../../../features';

export const Route = createFileRoute('/_auth/platform/security/tenants/')({
  validateSearch: tenantsListSearchSchema,
  search: { middlewares: [stripSearchParams(TENANTS_LIST_SEARCH_DEFAULTS)] },
  component: () => <TenantsDataTable />,
});
