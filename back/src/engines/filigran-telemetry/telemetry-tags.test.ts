import { describe, expect, it } from 'vitest';
import { normalizeTelemetryTags } from './telemetry-tags';

describe('normalizeTelemetryTags', () => {
  it.each([
    { raw: undefined, expected: [] },
    { raw: null, expected: [] },
    { raw: '', expected: [] },
    { raw: '   ', expected: [] },
    { raw: ',,,', expected: [] },
    { raw: 'saas', expected: ['saas'] },
    { raw: 'saas,eu-west', expected: ['eu-west', 'saas'] },
    { raw: ' SaaS , EU-West ', expected: ['eu-west', 'saas'] },
    { raw: 'saas,saas,SAAS', expected: ['saas'] },
    { raw: 'b,a,c,a', expected: ['a', 'b', 'c'] },
    { raw: 'saas,, eu-west ,', expected: ['eu-west', 'saas'] },
  ])('normalizes $raw to $expected', ({ raw, expected }) => {
    expect(normalizeTelemetryTags(raw)).toEqual(expected);
  });
});
