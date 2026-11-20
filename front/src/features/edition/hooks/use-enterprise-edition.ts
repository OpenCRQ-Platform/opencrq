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

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';

/**
 * Matches the XTM One registration heartbeat cadence (5 minutes): the
 * entitlement can be granted or revoked on the XTM One side at runtime, and
 * every EE gate should converge without waiting for a remount or a refocus.
 */
const EDITION_REFRESH_MS = 5 * 60_000;

/**
 * The platform's Enterprise Edition entitlement - the OpenCRQ counterpart
 * of OpenCTI's `useEnterpriseEdition()`.
 *
 * Read from the bootstrap payload, the one query the frontend already makes
 * before login, so no EE gate costs an extra round-trip. The backend
 * enforces the entitlement on every EE endpoint regardless: this only
 * decides what the UI offers.
 */
export const useEnterpriseEdition = (): boolean => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.authStatus.queryOptions(undefined, {
    staleTime: EDITION_REFRESH_MS,
    refetchInterval: EDITION_REFRESH_MS,
  }));
  return data?.edition === 'ee';
};
