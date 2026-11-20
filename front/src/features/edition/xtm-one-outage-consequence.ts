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

import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { formatDate } from '../../utils';

/**
 * Where the platform's edition comes from, as far as an XTM One outage is concerned:
 * - `community`: no license, so XTM One has nothing to take away but the grant it cannot give;
 * - `xtm-one`: Enterprise Edition granted by the Filigran license XTM One distributes, which stops
 *   being extended while XTM One fails and ends on `endsAt` (or at the next restart);
 * - `installed`: Enterprise Edition granted by a Filigran license installed on this instance, which
 *   does not depend on XTM One at all.
 */
export type XtmOneOutageEdition =
  | { kind: 'community' }
  | { kind: 'xtm-one', endsAt: Date | null }
  | { kind: 'installed' };

export const xtmOneOutageEdition = (
  isEnterpriseEdition: boolean,
  licenseSource: 'local' | 'remote' | null | undefined,
  endsAt: Date | null,
): XtmOneOutageEdition => {
  if (!isEnterpriseEdition) {
    return { kind: 'community' };
  }
  // `endsAt` is the later of the two grants: with an installed license it is that license's own
  // end, which an XTM One outage does not bring forward, so it is never named here.
  return licenseSource === 'local' ? { kind: 'installed' } : { kind: 'xtm-one', endsAt };
};

/**
 * What an XTM One outage (unreachable, refused or unreadable) takes away from this platform, in one
 * sentence: shared by the Filigran license card and the application-wide toast so both say the
 * same thing. Ask Ariane is Enterprise-only, so a Community platform never had it to lose.
 */
export const xtmOneOutageConsequence = (edition: XtmOneOutageEdition): string => {
  switch (edition.kind) {
    case 'community':
      return t`XTM One cannot grant Enterprise Edition to this platform.`;
    case 'installed':
      return t`Ask Ariane is unavailable.`;
    case 'xtm-one': {
      if (edition.endsAt === null) {
        return t`Ask Ariane is unavailable and Enterprise Edition is no longer extended: it ends at the next restart.`;
      }
      const endDate = formatDate(edition.endsAt);
      return i18n._({ id: 'Ask Ariane is unavailable and Enterprise Edition is no longer extended: it ends on {endDate}, or at the next restart.', message: 'Ask Ariane is unavailable and Enterprise Edition is no longer extended: it ends on {endDate}, or at the next restart.', values: { endDate } });
    }
  }
};
