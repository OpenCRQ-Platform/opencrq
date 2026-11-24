import { describe, expect, it } from 'vitest';
import { isNvdRecordMissing } from './nvd-record-utils';

describe('isNvdRecordMissing', () => {
  it('should be true once an NVD pass found no usable record', () => {
    expect(isNvdRecordMissing({ nvdRecord: 'none' })).toBe(true);
  });

  it('should be false on a CVE NVD reported on, or not read yet', () => {
    expect(isNvdRecordMissing({ nvdRecord: 'held' })).toBe(false);
    expect(isNvdRecordMissing({ nvdRecord: 'unread' })).toBe(false);
  });

  it('should be false while the CVE is loading or unknown', () => {
    expect(isNvdRecordMissing(undefined)).toBe(false);
    expect(isNvdRecordMissing(null)).toBe(false);
  });
});
