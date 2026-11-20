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

import type { XtmOneRegistration } from '../xtm-one/hooks/use-xtm-one-settings';

type XtmOneRegistrationOutcome = Exclude<NonNullable<XtmOneRegistration>, 'pending'>;

interface ReportedRegistration {
  registration: XtmOneRegistration,
  failingSince: Date | null,
  lastAnsweredAt: Date | null,
}

export interface XtmOneCheck {
  registration: XtmOneRegistrationOutcome,
  failingSince: Date | null,
  /** When XTM One had last answered, by the server's clock, once the check returned. */
  lastAnsweredAt: Date | null,
}

const sameInstant = (left: Date | null, right: Date | null): boolean => (left?.getTime() ?? null) === (right?.getTime() ?? null);

/**
 * The registration state the card reports. The reported one keeps saying `ok` through a grace after
 * a success, so a check that failed is shown instead, until XTM One answers again.
 */
export const shownXtmOneRegistration = (
  reported: ReportedRegistration,
  check: XtmOneCheck | null,
): { registration: XtmOneRegistration, failingSince: Date | null } => {
  if (check === null || check.registration === 'ok' || !sameInstant(reported.lastAnsweredAt, check.lastAnsweredAt)) {
    return { registration: reported.registration, failingSince: reported.failingSince };
  }
  return { registration: check.registration, failingSince: check.failingSince };
};
