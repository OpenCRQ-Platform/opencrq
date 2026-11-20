export const CVE_LIST_SORT_KEYS = ['cveId', 'cvss', 'epss', 'kev', 'updatedAt'] as const;

export type CveListSortKey = (typeof CVE_LIST_SORT_KEYS)[number];
