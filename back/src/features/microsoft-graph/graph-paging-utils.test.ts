import { describe, expect, it } from 'vitest';
import {
  chunkRowsByDevice,
  growPageSize,
  HUNTING_ROW_CAP,
  isResultTooLargeResponse,
  isTruncated,
  lastDeviceId,
  MAX_PAGE_DEVICES,
  shrinkPageSize,
} from './graph-paging-utils';

describe('isTruncated', () => {
  it('refuses a result sitting on the cap, whose missing rows cannot be told from none', () => {
    expect(isTruncated(HUNTING_ROW_CAP)).toBe(true);
    expect(isTruncated(HUNTING_ROW_CAP - 1)).toBe(false);
  });
});

describe('isResultTooLargeResponse', () => {
  it('recognizes a 400 carrying the result-size marker', () => {
    expect(isResultTooLargeResponse(
      400,
      'Query execution has exceeded the allowed result size. Optimize your query by limiting the amount of results and try again.',
    )).toBe(true);
  });
  it('is false for a 400 with a different message, whatever caused it', () => {
    expect(isResultTooLargeResponse(400, 'Bad request: invalid query syntax')).toBe(false);
  });
  it('is false for a non-400 status, even carrying the marker text', () => {
    expect(isResultTooLargeResponse(500, 'exceeded the allowed result size')).toBe(false);
  });
});

describe('page size', () => {
  it('halves down to a single device and no further', () => {
    expect(shrinkPageSize(500)).toBe(250);
    expect(shrinkPageSize(3)).toBe(1);
    expect(shrinkPageSize(1)).toBe(1);
  });

  it('doubles back only after a page came in well under the cap, never past the maximum', () => {
    expect(growPageSize(250, HUNTING_ROW_CAP / 4 - 1)).toBe(500);
    expect(growPageSize(250, HUNTING_ROW_CAP / 4)).toBe(250);
    expect(growPageSize(MAX_PAGE_DEVICES, 10)).toBe(MAX_PAGE_DEVICES);
  });
});

describe('lastDeviceId', () => {
  it('is the largest id whatever order the rows came in', () => {
    expect(lastDeviceId(['0b', '9f', '1a'])).toBe('9f');
  });

  it('is null for an empty page', () => {
    expect(lastDeviceId([])).toBeNull();
  });
});

describe('chunkRowsByDevice', () => {
  const rows = [
    { device: 'a', cve: '1' },
    { device: 'b', cve: '1' },
    { device: 'a', cve: '2' },
    { device: 'c', cve: '1' },
  ];

  it('keeps every row of a device in the same chunk', () => {
    const chunks = chunkRowsByDevice(rows, (row) => row.device, 2);

    expect(chunks.map((chunk) => chunk.deviceCount)).toEqual([2, 1]);
    expect(chunks[0].rows).toEqual([rows[0], rows[2], rows[1]]);
    expect(chunks[1].rows).toEqual([rows[3]]);
  });

  it('yields nothing for no rows', () => {
    expect(chunkRowsByDevice([], () => '', 2)).toEqual([]);
  });
});
