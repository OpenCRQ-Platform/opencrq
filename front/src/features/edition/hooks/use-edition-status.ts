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

/** Matches the XTM One registration heartbeat cadence (5 minutes): the license's validity can change on any heartbeat. */
const EDITION_STATUS_REFRESH_MS = 5 * 60_000;

/**
 * The platform's license validity and expiry, for the detail card. Silent on failure like
 * `useXtmOneSettings`: a transient error here must not blank out the card or spam a toast.
 */
export const useEditionStatus = () => {
  const trpc = useTRPC();
  return useQuery(trpc.edition.getStatus.queryOptions(undefined, {
    staleTime: EDITION_STATUS_REFRESH_MS,
    refetchInterval: EDITION_STATUS_REFRESH_MS,
    retry: false,
    meta: { skipErrorToast: true },
  }));
};
