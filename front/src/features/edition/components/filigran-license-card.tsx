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

import { Alert, Button, Chip } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { msg, plural, t } from '@lingui/core/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { EntitlementRefusal, LicenseMessage, LicenseType, ShownLicense } from '../filigran-license-utils';
import type { XtmOneOutageEdition } from '../xtm-one-outage-consequence';
import { SettingsCard, SettingsField } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
// Direct module import: the xtm-one barrel reaches Ask Ariane, which reads
// the edition, and the cycle would break at boot.
import { useXtmOneSettings } from '../../xtm-one/hooks/use-xtm-one-settings';
import { toHttpUrl } from '../../xtm-one/utils/to-http-url';
import { useCanManagePlatform } from '../../../hooks/utils/use-can-manage-platform';
import { useEditionStatus } from '../hooks/use-edition-status';
import { useEnterpriseEdition } from '../hooks/use-enterprise-edition';
import { formatDate } from '../../../utils';
import { useTRPC } from '../../../lib';
import { installedLicenseRefusal, licenseMessage, shownLicense, xtmOneLicenseSettingsUrl } from '../filigran-license-utils';
import { licenseDaysRemaining } from '../license-expiry-utils';
import { xtmOneOutageConsequence, xtmOneOutageEdition } from '../xtm-one-outage-consequence';

const LICENSE_TYPE_LABELS: Record<LicenseType, () => string> = {
  standard: () => t`Standard`,
  lts: () => t`LTS (long-term support)`,
  trial: () => t`Trial`,
  nfr: () => t`NFR (not for resale)`,
  ci: () => t`CI (continuous integration)`,
};

// A Record keyed on the backend's refusal codes: a new code fails type-check until it has a text.
const REFUSALS: Record<EntitlementRefusal, () => { title: string, description: string }> = {
  license_withheld_default_token: () => ({
    title: t`XTM One does not pass on the Filigran license`,
    description: t`The password linking OpenCRQ to XTM One is still the one shipped with the installation. For security, XTM One keeps the license until it is changed. Ask whoever manages the installation to replace it.`,
  }),
  xtm_one_outdated: () => ({
    title: t`XTM One does not pass on the Filigran license`,
    description: t`This version of XTM One reports Enterprise Edition without the signed Filigran license that proves it. Upgrade XTM One to a release that returns it.`,
  }),
  license_withheld: () => ({
    title: t`XTM One does not pass on the Filigran license`,
    description: t`XTM One reports Enterprise Edition without returning the Filigran license that proves it. The backend log gives the reason.`,
  }),
  license_missing: () => ({
    title: t`XTM One does not pass on the Filigran license`,
    description: t`XTM One reports Enterprise Edition without returning the Filigran license that proves it. The backend log gives the reason.`,
  }),
  license_untrusted: () => ({
    title: t`The Filigran license from XTM One cannot be verified`,
    description: t`This instance cannot verify it as signed by Filigran. The backend log gives the reason.`,
  }),
  license_invalid: () => ({
    title: t`The Filigran license from XTM One does not entitle this instance`,
    description: t`It may have expired, not sub-license this instance, or cover another product. The backend log gives the reason.`,
  }),
};

const validityText = (expiresAt: Date): string => {
  const until = formatDate(expiresAt);
  const daysLeft = licenseDaysRemaining(expiresAt);
  // Only a license with a grace period keeps entitling past its own date.
  if (daysLeft === 0) {
    return i18n._({ id: '{until} (expired, in grace period)', message: '{until} (expired, in grace period)', values: { until } });
  }
  return plural(daysLeft, { one: `${until} (# day left)`, other: `${until} (# days left)` });
};

const toDate = (value: Date | string | null | undefined): Date | null => (value == null ? null : new Date(value));

const LicenseFields: FunctionComponent<{ license: ShownLicense }> = ({ license }) => (
  <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-6 gap-y-4">
    <SettingsField label={t`License type`}>
      {license.type !== null ? LICENSE_TYPE_LABELS[license.type]() : <EmptyValue />}
    </SettingsField>
    <SettingsField label={t`License valid until`}>
      {license.expiresAt !== null ? validityText(license.expiresAt) : <EmptyValue />}
    </SettingsField>
    <SettingsField label={t`Source`}>
      {license.source === 'local' ? t`Installed on this instance` : t`Distributed by XTM One`}
    </SettingsField>
  </div>
);

interface LicenseMessageViewProps {
  message: LicenseMessage,
  outageEdition: XtmOneOutageEdition,
  xtmOneUrl: string | null,
}

const LicenseMessageView: FunctionComponent<LicenseMessageViewProps> = ({ message, outageEdition, xtmOneUrl }) => {
  switch (message.kind) {
    case 'xtm-one-outage':
      return outageEdition.kind === 'community'
        ? <Alert elevation={1} severity="info" title={t`Ask Ariane and license activation are unavailable.`} />
        : <Alert elevation={1} severity={outageEdition.kind === 'xtm-one' ? 'warning' : 'info'} title={xtmOneOutageConsequence(outageEdition)} />;
    case 'refusal': {
      const { title, description } = REFUSALS[message.refusal]();
      return <Alert elevation={1} severity="warning" title={title} description={description} />;
    }
    case 'install-in-xtm-one':
      return (
        <>
          <Alert elevation={1} severity="info" title={t`Install the Filigran license in XTM One to switch this instance to Enterprise Edition.`} />
          {xtmOneUrl !== null && (
            <div>
              <Button asChild>
                <a href={xtmOneLicenseSettingsUrl(xtmOneUrl)} target="_blank" rel="noopener noreferrer">
                  {t`Install the license in XTM One`}
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          )}
        </>
      );
  }
};

const useRefreshLicense = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async () => {
    // eslint-disable-next-line no-restricted-syntax -- the Filigran license lives in `platform_metadata`, which carries no trigger, so no doorbell rings when it is installed or removed.
    await Promise.all([queryClient.invalidateQueries(trpc.authStatus.queryFilter()), queryClient.invalidateQueries(trpc.edition.pathFilter())]);
  };
};

/**
 * The Filigran license comes from XTM One only (Filigran License v2, 17 Nov 2026): the card points
 * to XTM One and never offers to install one here. A license installed here before is still shown,
 * with "Remove"; the Enterprise Edition XTM One grants cannot be removed from OpenCRQ.
 */
export const FiligranLicenseCard: FunctionComponent = () => {
  const trpc = useTRPC();
  const isEnterpriseEdition = useEnterpriseEdition();
  const { data: xtmOne } = useXtmOneSettings();
  const { data: status } = useEditionStatus();
  const canManagePlatform = useCanManagePlatform();
  const { data: installed } = useQuery(trpc.edition.getFiligranLicense.queryOptions(undefined, {
    enabled: canManagePlatform,
    retry: false,
    meta: { skipErrorToast: true },
  }));
  const refresh = useRefreshLicense();
  const remove = useMutation(trpc.edition.removeFiligranLicense.mutationOptions({
    meta: { successMessage: msg`Filigran license removed.` },
    onSuccess: refresh,
  }));

  const xtmOneConfigured = xtmOne === undefined ? undefined : xtmOne.configured === true;
  const input = {
    isEnterpriseEdition,
    xtmOneConfigured,
    registration: xtmOne?.registration,
    entitlementRefusal: xtmOne?.entitlementRefusal,
    status: status && {
      licenseType: status.licenseType,
      licenseExpiresAt: toDate(status.licenseExpiresAt),
      licenseSource: status.licenseSource,
    },
    installed: installed == null ? installed : { ...installed, expiresAt: toDate(installed.expiresAt) },
  };
  const license = shownLicense(input);
  const installedRefusal = installedLicenseRefusal(input);
  const message = licenseMessage(input);
  const outageEdition = xtmOneOutageEdition(isEnterpriseEdition, license?.source ?? status?.licenseSource, toDate(status?.endsAt));

  return (
    <SettingsCard
      icon="key-round"
      title={t`Filigran license`}
      chip={(
        <Chip
          severity={isEnterpriseEdition ? 'ee' : 'neutral'}
          label={isEnterpriseEdition ? t`Enterprise Edition` : t`Community Edition`}
        />
      )}
    >
      {license !== null && <LicenseFields license={license} />}
      {installedRefusal !== null && (
        <Alert
          elevation={1}
          severity="warning"
          title={t`The Filigran license installed on this instance does not entitle it`}
          description={installedRefusal}
        />
      )}
      {message !== null && <LicenseMessageView message={message} outageEdition={outageEdition} xtmOneUrl={toHttpUrl(xtmOne?.url)} />}
      {canManagePlatform && installed != null && (
        <div>
          <Button priority="secondary" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {t`Remove`}
          </Button>
        </div>
      )}
      {xtmOneConfigured === false && (
        <Alert elevation={1} severity="info" title={t`OpenCRQ takes its Filigran license from XTM One. Connect this instance to XTM One to switch it to Enterprise Edition.`} />
      )}
    </SettingsCard>
  );
};
