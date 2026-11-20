import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/platform/security/')({
  beforeLoad: () => {
    throw redirect({ from: '/platform/security', to: 'users' });
  },
});
