import type { Logger } from '../../utils/logger';

export const ensureDefaultPlatformRolesAndGroups = async (
  platformGroups: { createDefaultPlatformRolesAndGroups: () => Promise<boolean> },
  { logTrace, logFromError }: Pick<Logger, 'logTrace' | 'logFromError'>,
): Promise<void> => {
  try {
    if (await platformGroups.createDefaultPlatformRolesAndGroups()) {
      logTrace('Created the default platform roles and groups.');
    } else {
      logTrace('The platform already holds platform roles or groups, no default created.');
    }
  } catch (error) {
    logFromError(error, 'Creating the default platform roles and groups failed, booting without them');
  }
};
