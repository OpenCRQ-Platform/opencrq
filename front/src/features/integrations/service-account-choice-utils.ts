import { t } from '@lingui/core/macro';
import { z } from 'zod';

/** Whether the integration runs as an account created with it, or as one the tenant already has. */
export const SERVICE_ACCOUNT_MODES = ['new', 'existing'] as const;
export type ServiceAccountMode = (typeof SERVICE_ACCOUNT_MODES)[number];

export interface ServiceAccountOption {
  id: string,
  name: string,
  active: boolean,
}

export interface ServiceAccountChoiceValues {
  serviceAccountMode: ServiceAccountMode,
  newServiceAccountName: string,
  serviceAccountId: string,
}

/** What the configure mutations take: an account to create in the same transaction, or one to bind. */
export type ServiceAccountChoice =
  | { newServiceAccount: { name: string } }
  | { serviceAccountId: string | null };

/**
 * The accounts the select offers: the active ones, plus the configured one once deactivated, so a
 * bound account does not silently vanish from the list.
 */
export const selectableServiceAccounts = (
  serviceAccounts: ReadonlyArray<ServiceAccountOption>,
  configuredServiceAccountId: string | undefined,
): Array<ServiceAccountOption> => {
  const active = serviceAccounts.filter((account) => account.active);
  const configuredInactive = serviceAccounts.find((account) => !account.active && account.id === configuredServiceAccountId);
  return configuredInactive === undefined ? active : [...active, configuredInactive];
};

/** The name a new account is prefilled with, editable before saving. */
export const defaultServiceAccountName = (connectorName: string): string => `${connectorName} connector`;

/**
 * An integration already bound to an account the select still offers keeps it; any other starts on a
 * new account, the one-step path, like a connector created in OpenCTI.
 */
export const defaultServiceAccountChoice = (
  connectorName: string,
  serviceAccounts: ReadonlyArray<ServiceAccountOption>,
  configuredServiceAccountId: string | null | undefined,
): ServiceAccountChoiceValues => {
  const configured = configuredServiceAccountId ?? undefined;
  const keepsConfigured = configured !== undefined
    && selectableServiceAccounts(serviceAccounts, configured).some((account) => account.id === configured);
  return {
    serviceAccountMode: keepsConfigured ? 'existing' : 'new',
    newServiceAccountName: defaultServiceAccountName(connectorName),
    serviceAccountId: keepsConfigured ? configured : '',
  };
};

/** An empty existing account is a legitimate unbind; the mutation reads it as `null`. */
export const toServiceAccountChoice = (values: ServiceAccountChoiceValues): ServiceAccountChoice => (
  values.serviceAccountMode === 'new'
    ? { newServiceAccount: { name: values.newServiceAccountName.trim() } }
    : { serviceAccountId: values.serviceAccountId === '' ? null : values.serviceAccountId }
);

/** The fields of the choice, merged into each configure form's schema. */
export const serviceAccountChoiceFields = () => ({
  serviceAccountMode: z.enum(SERVICE_ACCOUNT_MODES),
  newServiceAccountName: z.string(),
  serviceAccountId: z.string(),
});

/** Refinements of the choice: a new account needs a name, an existing one a selection when it is required. */
export const refineServiceAccountChoice = (
  values: ServiceAccountChoiceValues,
  ctx: z.RefinementCtx,
  { accountRequired }: { accountRequired: boolean },
): void => {
  if (values.serviceAccountMode === 'new' && values.newServiceAccountName.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['newServiceAccountName'], message: t`Enter a name for the service account.` });
  }
  if (values.serviceAccountMode === 'existing' && accountRequired && values.serviceAccountId === '') {
    ctx.addIssue({ code: 'custom', path: ['serviceAccountId'], message: t`Select a service account.` });
  }
};
