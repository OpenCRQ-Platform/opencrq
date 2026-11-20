import { createFileRoute, notFound } from '@tanstack/react-router';
import { PlatformUserDetails } from '../../../../../features/users/components/platform-user-details';
import { trpcClient } from '../../../../../lib';

export const Route = createFileRoute('/_auth/platform/security/users/$userId')({
  loader: async ({ params }) => {
    const user = await trpcClient.users.getUser.query({ id: params.userId });
    if (!user) {
      throw notFound();
    }
    return { user, crumb: user.name ?? user.email };
  },
  component: function PlatformUserComponent() {
    const { user } = Route.useLoaderData();
    return <PlatformUserDetails userId={user.id} initialUser={user} />;
  },
});
