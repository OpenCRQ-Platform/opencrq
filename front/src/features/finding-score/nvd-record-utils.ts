import type { NvdRecordState } from '@app/module/client';

/** Whether an NVD pass read the CVE and found no usable record, which a CVE not read yet does not say. */
export const isNvdRecordMissing = (info: { nvdRecord: NvdRecordState } | null | undefined): boolean => info?.nvdRecord === 'none';
