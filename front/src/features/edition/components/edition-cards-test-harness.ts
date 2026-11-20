import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import type { FunctionComponent } from 'react';
import { createElement } from 'react';
import type { XtmOneRegistration } from '../../xtm-one/hooks/use-xtm-one-settings';
import { createTrpcTestClient, TrpcTestProviders } from '../../../providers/trpc-test-harness';

export interface EditionCardState {
  edition?: 'ce' | 'ee',
  xtmOneConfigured?: boolean,
  entitlementRefusal?: string | null,
  registration?: XtmOneRegistration,
  failingSince?: string | null,
  lastAnsweredAt?: string | null,
  check?: { registration: string, failingSince: string | null, lastAnsweredAt: string | null },
  endsAt?: string | null,
  licenseExpiresAt?: string | null,
  licenseSource?: 'local' | 'remote' | null,
  licenseType?: string | null,
  canManagePlatform?: boolean,
  installedLicense?: { entitled: boolean, reason: string | null, expiresAt: string | null, type: string | null } | null,
}

export const XTM_ONE_URL = 'https://xtm-one.example.com';

/** Renders a card against canned answers for every query the edition cards make. */
export const renderEditionCard = (card: FunctionComponent, {
  edition = 'ce',
  xtmOneConfigured = true,
  entitlementRefusal = null,
  registration = xtmOneConfigured ? 'ok' : null,
  failingSince = null,
  lastAnsweredAt = null,
  check,
  endsAt = null,
  licenseExpiresAt = null,
  licenseSource = edition === 'ee' ? 'remote' : null,
  licenseType = null,
  canManagePlatform = false,
  installedLicense = null,
}: EditionCardState = {}) => {
  const responses: Record<string, unknown> = {
    authStatus: { edition, featureFlags: ['enterprise-edition-status'] },
    'xtmOne.getSettings': { configured: xtmOneConfigured, url: xtmOneConfigured ? XTM_ONE_URL : null, entitlementRefusal, registration, failingSince, lastAnsweredAt },
    'edition.getStatus': { edition, endsAt, licenseExpiresAt, licenseSource, licenseType },
    'platformCapabilities.hasPlatformCapability': canManagePlatform,
    'edition.getFiligranLicense': installedLicense,
    'edition.checkWithXtmOne': check,
  };
  const { trpcClient } = createTrpcTestClient(responses);

  return render(
    createElement(TrpcTestProviders, {
      trpcClient,
      children: createElement(I18nProvider, { i18n }, createElement(card)),
    }),
  );
};

/** A hair under a whole number of days, so it still rounds up to `days` regardless of test runtime. */
export const inDays = (days: number): string => new Date(Date.now() + days * 24 * 60 * 60 * 1000 - 1_000).toISOString();
