export const PRIMARY_TO_PRIMARY_LINK_STRENGTHS = ['critical', 'important', 'minor', 'unknown'] as const;
export type PrimaryToPrimaryLinkStrength = (typeof PRIMARY_TO_PRIMARY_LINK_STRENGTHS)[number];

export const UNKNOWN_LINK_STRENGTH = 'unknown' satisfies PrimaryToPrimaryLinkStrength;
