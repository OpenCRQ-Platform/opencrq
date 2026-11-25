/**
 * What NVD is known to hold on a CVE: `unread` until an NVD pass has read the record, `none` when the
 * pass found no record or a rejected one with nothing to enrich, `held` once NVD reported on it.
 */
export type NvdRecordState = 'unread' | 'none' | 'held';

/**
 * An NVD observation proves a record whether or not the remediation was read: a CVE a threat brought
 * in gets its scores before any finding asks for the remediation.
 */
export const nvdRecordState = (remediationReadAt: Date | null, hasNvdObservation: boolean): NvdRecordState => {
  if (hasNvdObservation) {
    return 'held';
  }
  return remediationReadAt === null ? 'unread' : 'none';
};
