import { t } from '@lingui/core/macro';
import type { ControlDomain } from '@app/module/client';

export const controlDomainLabel = (domain: ControlDomain): string => {
  switch (domain) {
    case 'endpoints_and_servers': return t`Endpoints and servers`;
    case 'network': return t`Network`;
    case 'identities': return t`Identities`;
    case 'email_and_saas': return t`Email and SaaS`;
    case 'applications': return t`Applications`;
    case 'cloud': return t`Cloud`;
    case 'data': return t`Data`;
    case 'detection_and_response': return t`Detection and response`;
    case 'people_and_third_parties': return t`People and third parties`;
    case 'ai': return t`AI`;
  }
};
