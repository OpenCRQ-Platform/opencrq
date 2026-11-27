import { createFileRoute, redirect } from '@tanstack/react-router';
import { xtmSignInHref } from '../../features/auth/xtm-sign-in-utils';

// Invitation emails XTM One sent with a `/join/<token>` path land here. The token is ignored: the
// sign-in ties a pending account by its email.
export const Route = createFileRoute('/join/$token')({
  beforeLoad: () => {
    throw redirect({ href: xtmSignInHref(), reloadDocument: true });
  },
});
