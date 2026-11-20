import type { AssetObservationProperties } from '@app/module/client';

export type IdentityDetailProperties = Extract<AssetObservationProperties, { family: 'identity' }>;

/**
 * Whether the block carries anything worth a section. An identity the directory never returned is
 * keyed by its SID and named from a logon event, so most of these are null; one whose every field
 * is null would draw a frame of dashes, which states less than drawing nothing.
 */
export const hasIdentityDetail = (identity: IdentityDetailProperties): boolean =>
  [
    identity.userPrincipalName,
    identity.accountName,
    identity.accountDomain,
    identity.identityProvider,
    identity.cloudSid,
    identity.onPremSid,
    identity.department,
    identity.jobTitle,
  ].some((value) => value !== null)
  || identity.isEnabled !== null
  || identity.assignedRoles.length > 0
  || identity.privilegedPimRoles.length > 0;

/** Whether `AssetPropertyCards` draws a card at all: a machine or AI target always has one, an identity only with detail. */
export const hasPropertyCard = (properties: AssetObservationProperties | null): boolean =>
  properties !== null && (properties.family !== 'identity' || hasIdentityDetail(properties));
