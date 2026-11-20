import { createFileRoute, redirect } from '@tanstack/react-router';
import { xtmJoinHref } from '../../features/auth/xtm-sign-in-utils';

export const Route = createFileRoute('/join/$token')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: xtmJoinHref(params.token), reloadDocument: true });
  },
});
