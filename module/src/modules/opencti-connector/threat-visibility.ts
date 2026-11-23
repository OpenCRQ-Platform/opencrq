/**
 * Who decides which mirrored OpenCTI objects a member reads. `per_member`: OpenCTI, asked as that
 * member, which needs OpenCTI registered with this platform's XTM One. `service_account`: every
 * member of the tenant reads what the deployment's connector token reads there, an administrator's
 * explicit choice.
 */
export const OPENCTI_THREAT_VISIBILITIES = ['per_member', 'service_account'] as const;

export type OpenctiThreatVisibility = typeof OPENCTI_THREAT_VISIBILITIES[number];
