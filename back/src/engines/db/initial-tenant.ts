import type { Logger } from '../../utils/logger';

export const ensureInitialTenant = async (
  tenants: { createInitialTenant: (input: { id: string, name: string }, options: { provisionOnboarding: boolean }) => Promise<boolean> },
  initialTenant: { id: string, name: string },
  { logTrace, logFromError }: Pick<Logger, 'logTrace' | 'logFromError'>,
): Promise<void> => {
  try {
    // Born like any tenant created from the platform administration: with its risk scope and its Get started wizard.
    if (await tenants.createInitialTenant(initialTenant, { provisionOnboarding: true })) {
      logTrace('Created the initial tenant.', { tenantId: initialTenant.id, name: initialTenant.name });
    } else {
      logTrace('The platform already holds a tenant, no initial tenant created.');
    }
  } catch (error) {
    logFromError(error, 'Creating the initial tenant failed, booting without it');
  }
};
