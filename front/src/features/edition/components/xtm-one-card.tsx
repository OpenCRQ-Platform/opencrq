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

import type { ChipSeverity } from '@filigran/design-system';
import { Alert, Button, Chip, Text } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { XtmOneRegistration, XtmOneRegistrationFailure } from '../../xtm-one/hooks/use-xtm-one-settings';
import type { XtmOneCheck } from '../xtm-one-check-utils';
import { SettingsCard } from '../../../components/shared';
// Direct module import: the xtm-one barrel reaches Ask Ariane, which reads
// the edition, and the cycle would break at boot.
import { useXtmOneSettings } from '../../xtm-one/hooks/use-xtm-one-settings';
import { toHttpUrl } from '../../xtm-one/utils/to-http-url';
import { formatDate, formatDateTime, formatRelativeTime } from '../../../utils';
import { useTRPC } from '../../../lib';
import { useCanManagePlatform } from '../../../hooks/utils/use-can-manage-platform';
import { shownXtmOneRegistration } from '../xtm-one-check-utils';

type XtmOneConnectionState = 'checking' | 'connected' | XtmOneRegistrationFailure;

const XTM_ONE_STATE_SEVERITY: Record<XtmOneConnectionState, ChipSeverity> = {
  checking: 'neutral',
  connected: 'low',
  unreachable: 'high',
  unreadable: 'high',
  refused: 'critical',
};

const xtmOneConnectionState = (registration: NonNullable<XtmOneRegistration>): XtmOneConnectionState => {
  if (registration === 'pending') {
    return 'checking';
  }
  return registration === 'ok' ? 'connected' : registration;
};

const toDate = (instant: Date | string | null | undefined): Date | null => (instant != null ? new Date(instant) : null);

const xtmOneLastAnswer = (lastAnsweredAt: Date | null): string => (
  lastAnsweredAt !== null
    ? i18n._({ id: 'Last answer: {at} ({ago}).', message: 'Last answer: {at} ({ago}).', values: { at: formatDateTime(lastAnsweredAt), ago: formatRelativeTime(lastAnsweredAt) } })
    : t`No answer from XTM One yet.`
);

const xtmOneStateLabel = (state: XtmOneConnectionState): string => {
  switch (state) {
    case 'checking': return t`Checking`;
    case 'connected': return t`Connected`;
    case 'unreachable': return t`Unreachable`;
    case 'refused': return t`Registration refused`;
    case 'unreadable': return t`Unreadable answer`;
  }
};

const outageTitle = (state: XtmOneRegistrationFailure, failingSince: Date | null): string => {
  if (failingSince === null) {
    switch (state) {
      case 'unreachable': return t`XTM One does not answer.`;
      case 'refused': return t`This platform's registration is refused.`;
      case 'unreadable': return t`The registration answer cannot be read.`;
    }
  }
  const since = formatDate(failingSince);
  const ago = formatRelativeTime(failingSince);
  switch (state) {
    case 'unreachable':
      return i18n._({ id: 'Unreachable since {since} ({ago}).', message: 'Unreachable since {since} ({ago}).', values: { since, ago } });
    case 'refused':
      return i18n._({ id: 'Registration refused since {since} ({ago}).', message: 'Registration refused since {since} ({ago}).', values: { since, ago } });
    case 'unreadable':
      return i18n._({ id: 'Answer unreadable since {since} ({ago}).', message: 'Answer unreadable since {since} ({ago}).', values: { since, ago } });
  }
};

// A refusal is not blamed on XTM One itself: a proxy in front of it answers 401 and 403 too.
const outageCheck = (state: XtmOneRegistrationFailure): string | null => {
  switch (state) {
    case 'unreachable': return null;
    case 'refused': return t`Check that XTM_ONE__TOKEN matches PLATFORM_REGISTRATION_TOKEN on XTM One, and that no proxy in front of it rejects the request.`;
    case 'unreadable': return t`Check that XTM_ONE__URL points to XTM One and that its version is compatible with this OpenCRQ.`;
  }
};

export const XtmOneCard: FunctionComponent = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: xtmOne } = useXtmOneSettings();
  const canManagePlatform = useCanManagePlatform();
  const [check, setCheck] = useState<XtmOneCheck | null>(null);
  const checkWithXtmOne = useMutation(trpc.edition.checkWithXtmOne.mutationOptions({
    meta: { skipSuccessToast: true },
    onSuccess: async ({ registration, failingSince, lastAnsweredAt }) => {
      setCheck({ registration, failingSince: toDate(failingSince), lastAnsweredAt: toDate(lastAnsweredAt) });
      // eslint-disable-next-line no-restricted-syntax -- the edition and the registration state live in memory, not in a table, so no doorbell rings when a check changes them.
      await Promise.all([queryClient.invalidateQueries(trpc.authStatus.queryFilter()), queryClient.invalidateQueries(trpc.edition.pathFilter()), queryClient.invalidateQueries(trpc.xtmOne.getSettings.queryFilter())]);
    },
  }));
  if (xtmOne?.configured !== true || xtmOne.registration === null) {
    return null;
  }
  const lastAnsweredAt = toDate(xtmOne.lastAnsweredAt);
  const shown = shownXtmOneRegistration(
    { registration: xtmOne.registration, failingSince: toDate(xtmOne.failingSince), lastAnsweredAt },
    check,
  );
  const state = xtmOneConnectionState(shown.registration ?? 'pending');
  const failure = state === 'checking' || state === 'connected' ? null : state;
  const outageHint = failure !== null ? outageCheck(failure) : null;
  const openUrl = failure === null ? toHttpUrl(xtmOne.url) : null;

  return (
    <SettingsCard
      icon="custom/xtmone"
      title={t`XTM One`}
      chip={<Chip severity={XTM_ONE_STATE_SEVERITY[state]} label={xtmOneStateLabel(state)} />}
    >
      <Text as="p" variant="content-compact" className="text-default-secondary">{xtmOneLastAnswer(lastAnsweredAt)}</Text>
      {failure !== null && (
        <Alert
          elevation={1}
          severity="warning"
          title={outageTitle(failure, shown.failingSince)}
          description={(
            <span className="flex flex-col">
              {outageHint !== null && <span>{outageHint}</span>}
              {xtmOne.url !== null && <span className="break-all">{xtmOne.url}</span>}
            </span>
          )}
        />
      )}
      {(openUrl !== null || canManagePlatform) && (
        <div className="mt-auto flex flex-wrap gap-2">
          {openUrl !== null && (
            <Button priority="secondary" asChild>
              <a href={openUrl} target="_blank" rel="noopener noreferrer">
                {t`Open XTM One`}
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </Button>
          )}
          {canManagePlatform && (
            <Button priority="secondary" onClick={() => checkWithXtmOne.mutate()} disabled={checkWithXtmOne.isPending}>
              {t`Check now`}
            </Button>
          )}
        </div>
      )}
    </SettingsCard>
  );
};
