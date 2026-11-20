import { t } from '@lingui/core/macro';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { securityScopeHref, securityScopeLabel } from '../../../../../../../components/layout/settings-layout/security-scope-utils';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/users')({
  beforeLoad: ({ context, params }) => {
    if (!context.securityEntries.includes('users')) {
      throw redirect({ href: securityScopeHref(params.tenantId, params.organizationId, context.securityScope, context.securityEntries[0]) });
    }
  },
  loaderDeps: ({ search }) => ({ scope: search.scope }),
  loader: ({ context, params }) => ({
    ancestorCrumbs: [{
      label: securityScopeLabel(context.securityScope),
      to: securityScopeHref(params.tenantId, params.organizationId, context.securityScope),
    }],
    crumb: t`Users`,
  }),
});
