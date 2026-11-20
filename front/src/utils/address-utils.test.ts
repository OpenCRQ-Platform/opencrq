import { describe, expect, it } from 'vitest';
import { abbreviateIpAddress, formatIpAddress, formatMacAddress } from './address-utils';

describe('formatMacAddress', () => {
  it('groups a stored MAC into colon-separated upper-case pairs', () => {
    expect(formatMacAddress('a4b1c2d3e4f5')).toBe('A4:B1:C2:D3:E4:F5');
  });

  it('leaves a value it cannot group untouched rather than mangling it', () => {
    expect(formatMacAddress('')).toBe('');
  });
});

describe('formatIpAddress', () => {
  it('lower-cases an IPv6 address', () => {
    expect(formatIpAddress('FD00:ACME:7::18')).toBe('fd00:acme:7::18');
  });

  it('leaves an IPv4 address alone', () => {
    expect(formatIpAddress('10.42.7.18')).toBe('10.42.7.18');
  });
});

describe('abbreviateIpAddress', () => {
  it('keeps the first two and last two groups of a long IPv6 address', () => {
    expect(abbreviateIpAddress('2A01:CB1D:9271:F300:7B7B:3D50:14E4:F97A')).toBe('2a01:cb1d:…:14e4:f97a');
  });

  it('keeps a group past a `::`, so it never sits beside the ellipsis', () => {
    expect(abbreviateIpAddress('2a01::9271:f300:7b7b:3d50:14e4:f97a')).toBe('2a01::9271:…:14e4:f97a');
    expect(abbreviateIpAddress('2a01:cb1d:1234:5678:9abc:def0::1')).toBe('2a01:cb1d:…:def0::1');
    expect(abbreviateIpAddress('::1234:5678:9abc:def0:1234:5678')).toBe('::1234:5678:…:1234:5678');
  });

  it('leaves an IPv4 address and a short compressed IPv6 one whole', () => {
    expect(abbreviateIpAddress('192.168.1.23')).toBe('192.168.1.23');
    expect(abbreviateIpAddress('fd00:acme:7::18')).toBe('fd00:acme:7::18');
  });
});
