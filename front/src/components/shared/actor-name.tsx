import { Icon } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link, linkOptions } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import type { Actor } from '../../utils/actor-utils';
import { cn } from '../../utils/cn';
import { SECURITY_ENTRY_ICONS } from '../layout/settings-layout/security-scope-utils';

const SCOPE_ROUTE = '/$tenantId/{-$organizationId}';

/** Who did something, wherever a service account can be the one: it is credited with its icon, and linked when its name is known. */
export const ActorName: FunctionComponent<{ actor: Actor, className?: string }> = ({ actor, className }) => {
  if (actor.kind === 'user') {
    return <span className={className}>{actor.label}</span>;
  }
  const { id, name } = actor;
  // A global rule sets every element's font family: the label and the link take their context's instead (monospace on the jobs pages).
  return (
    <span className={cn('inline-flex items-center gap-1 align-middle', className)}>
      <Icon name={SECURITY_ENTRY_ICONS['service-accounts']} size={16} aria-hidden className="size-3.5 shrink-0" />
      {name === null
        ? <span className="[font-family:inherit]">{t`Service account`}</span>
        : <Link {...linkOptions({ from: SCOPE_ROUTE, to: 'settings/security/service-accounts/$serviceAccountId', params: { serviceAccountId: id } })} title={id} className="[font-family:inherit] underline-offset-2 hover:underline">{name}</Link>}
    </span>
  );
};
