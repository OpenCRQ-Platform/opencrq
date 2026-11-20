import { includesFolded } from '@app/utils/text-fold';

export interface HomeDashboards<T extends string> {
  /** What Home opens for a member who has not chosen their own. */
  tenantHomeId: T,
  /** What Home opens for this user: their choice, else the tenant's. */
  userHomeId: T,
  /** The user's own choice, null when they have none or it is no longer registered. */
  userChoiceId: T | null,
}

/** The first level naming a registered dashboard wins, so an id dropped from the registry falls through to the next one. */
export const resolveDashboardId = <T extends string>(
  levels: ReadonlyArray<string | null | undefined>,
  isKnown: (value: string) => value is T,
  fallback: T,
): T => levels.find((level): level is T => level != null && isKnown(level)) ?? fallback;

export const resolveHomeDashboards = <T extends string>(
  stored: { user: string | null | undefined, tenant: string | null | undefined },
  isKnown: (value: string) => value is T,
  fallback: T,
): HomeDashboards<T> => {
  const tenantHomeId = resolveDashboardId([stored.tenant], isKnown, fallback);
  const userChoiceId = stored.user != null && isKnown(stored.user) ? stored.user : null;
  return { tenantHomeId, userHomeId: userChoiceId ?? tenantHomeId, userChoiceId };
};

export const filterDashboards = <T extends { name: string, description: string }>(rows: ReadonlyArray<T>, search: string): Array<T> =>
  rows.filter((row) => includesFolded(row.name, search) || includesFolded(row.description, search));
