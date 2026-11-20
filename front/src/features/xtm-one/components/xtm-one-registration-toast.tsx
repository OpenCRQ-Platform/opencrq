import { ToastAction, useToast } from '@filigran/ui';
import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useEffect, useRef } from 'react';
import type { XtmOneRegistration, XtmOneRegistrationFailure } from '../hooks/use-xtm-one-settings';
// Direct module imports: the edition barrel reaches the edition cards, which read the XTM One
// settings, and the cycle would break at boot.
import { useEditionStatus } from '../../edition/hooks/use-edition-status';
import { useEnterpriseEdition } from '../../edition/hooks/use-enterprise-edition';
import { xtmOneOutageConsequence, xtmOneOutageEdition } from '../../edition/xtm-one-outage-consequence';
import { useFeatureFlag } from '../../feature-flags';
import { useXtmOneSettings } from '../hooks/use-xtm-one-settings';

const CAUSE_MESSAGE: Record<XtmOneRegistrationFailure, MessageDescriptor> = {
  unreachable: msg`XTM One cannot be reached.`,
  refused: msg`This platform's registration with XTM One is refused.`,
  unreadable: msg`This platform's registration with XTM One got an answer that cannot be read.`,
};

const detailsLink = (navigate: ReturnType<typeof useNavigate>, tenantId: string, organizationId: string | undefined) => (
  <ToastAction
    altText={t`Open Parameters`}
    // A link, not a button: the bordered default reads as a second call to action.
    className="h-auto gap-1 self-start border-0 px-0 items-center hover:underline"
    onClick={() => {
      void navigate({
        to: '/$tenantId/{-$organizationId}/settings/parameters',
        params: { tenantId, organizationId },
      });
    }}
  >
    {t`Go to details`}
    <ArrowRight className="size-4" aria-hidden />
  </ToastAction>
);

/**
 * Application-wide, persistent notice that XTM One is configured but its registration fails -
 * mounted once in `MainLayout` so it reaches every page, since every XTM One-dependent feature is
 * unavailable while it holds. Renders nothing itself: the toast is the UI.
 *
 * Silent while `useXtmOneSettings` has not settled or has no opinion (`'ok'`, `'pending'`, `null`),
 * matching that hook's own silence on a failed request, and while the edition has not settled: what
 * the outage takes away depends on it (see `xtmOneOutageConsequence`).
 *
 * `@filigran/ui` keeps one toast at a time, so the next one evicts this notice. It comes back at the
 * next poll that still reports the outage, not at once, which would evict that other toast in turn.
 */
export const XtmOneRegistrationToast: FunctionComponent = () => {
  const { data: settings, dataUpdatedAt } = useXtmOneSettings();
  const { toast, toasts } = useToast();
  const navigate = useNavigate();
  const { tenantId, organizationId } = useParams({ strict: false });
  const detailsFlagOn = useFeatureFlag('enterprise-edition-status');
  const { pathname } = useLocation();
  // A link to the page the reader is on leads nowhere.
  const linkTenantId = detailsFlagOn && !pathname.includes('/settings/parameters') ? tenantId : undefined;

  const isEnterpriseEdition = useEnterpriseEdition();
  const { data: editionStatus, isPending: editionPending } = useEditionStatus();

  const registration: XtmOneRegistration | undefined = settings?.registration;
  const cause: XtmOneRegistrationFailure | null = registration === undefined || registration === null || registration === 'pending' || registration === 'ok' ? null : registration;
  // A failed edition read falls back on the bootstrap edition, with no license form or end date.
  const editionIsEnterprise = editionStatus !== undefined ? editionStatus.edition === 'ee' : isEnterpriseEdition;
  const editionEndsAt = editionStatus?.endsAt != null ? new Date(editionStatus.endsAt) : null;
  const description = cause === null || editionPending
    ? null
    : `${i18n._(CAUSE_MESSAGE[cause])} ${xtmOneOutageConsequence(xtmOneOutageEdition(editionIsEnterprise, editionStatus?.licenseSource, editionEndsAt))}`;

  const activeToast = useRef<ReturnType<typeof toast> | null>(null);
  const activeDescription = useRef<string | null>(null);
  const openToastIds = useRef<Array<string>>([]);

  useEffect(() => {
    openToastIds.current = toasts.filter((shown) => shown.open).map((shown) => shown.id);
  }, [toasts]);

  useEffect(() => {
    if (description === null) {
      activeToast.current?.dismiss();
      activeToast.current = null;
      activeDescription.current = null;
      return;
    }
    if (activeDescription.current === description && openToastIds.current.includes(activeToast.current?.id ?? '')) {
      return;
    }
    activeToast.current?.dismiss();
    activeDescription.current = description;
    activeToast.current = toast({
      variant: 'destructive',
      description,
      duration: Infinity,
      action: linkTenantId !== undefined ? detailsLink(navigate, linkTenantId, organizationId) : undefined,
    });
  }, [description, dataUpdatedAt, linkTenantId, organizationId, toast, navigate]);

  // The toast outlives navigation: the link follows the reader onto, and off, the details page.
  useEffect(() => {
    const active = activeToast.current;
    active?.update({ id: active.id, action: linkTenantId !== undefined ? detailsLink(navigate, linkTenantId, organizationId) : undefined });
  }, [linkTenantId, organizationId, navigate]);

  // Drop a lingering toast if the layout itself unmounts.
  useEffect(() => () => {
    activeToast.current?.dismiss();
  }, []);

  return null;
};
