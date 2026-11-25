import { describe, expect, it } from 'vitest';
import { nvdRecordState } from './nvd-record';

describe('nvdRecordState', () => {
  const readAt = new Date('2026-11-20T10:00:00Z');

  it('is unread before any NVD pass read the record', () => {
    expect(nvdRecordState(null, false)).toBe('unread');
  });

  it('is none once a pass read the record and NVD reported nothing', () => {
    expect(nvdRecordState(readAt, false)).toBe('none');
  });

  it('is held once NVD reported on the CVE', () => {
    expect(nvdRecordState(readAt, true)).toBe('held');
  });

  it('is held when NVD reported on it before any pass read its remediation', () => {
    expect(nvdRecordState(null, true)).toBe('held');
  });
});
