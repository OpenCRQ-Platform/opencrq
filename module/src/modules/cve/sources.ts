export const CVE_SOURCE_VALUES = ['nvd', 'first', 'cisa_kev', 'microsoft_defender'] as const;
export type CveSource = (typeof CVE_SOURCE_VALUES)[number];
