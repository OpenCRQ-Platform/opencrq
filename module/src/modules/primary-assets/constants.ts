/** Ordered lowest first, so the highest of several is the one with the highest index. */
export const SECURITY_NEED_LEVELS = ['not_applicable', 'low', 'medium', 'high', 'very_high'] as const;
export type SecurityNeedLevel = (typeof SECURITY_NEED_LEVELS)[number];

export const SECURITY_NEED_CRITERIA = ['availability', 'integrity', 'confidentiality', 'traceability'] as const;
export type SecurityNeedCriterion = (typeof SECURITY_NEED_CRITERIA)[number];

/** The Get started Protect templates a primary asset can be created from, stored on the asset so a rename or a language never hides it. */
export const PRIMARY_ASSET_ONBOARDING_TEMPLATES = [
  'customer-data',
  'payments-and-treasury',
  'production-and-operations',
  'hr-data',
  'intellectual-property',
  'email-and-collaboration',
] as const;
export type PrimaryAssetOnboardingTemplate = (typeof PRIMARY_ASSET_ONBOARDING_TEMPLATES)[number];

export const PRIMARY_ASSET_REFERENCE_MAX_LENGTH = 64;
export const PRIMARY_ASSET_BUSINESS_FUNCTION_MAX_LENGTH = 128;
/** Ten years: far beyond any recovery objective, and well inside a Postgres integer. */
export const PRIMARY_ASSET_DURATION_MAX_MINUTES = 10 * 365 * 24 * 60;
