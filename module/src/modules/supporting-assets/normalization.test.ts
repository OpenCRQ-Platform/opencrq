import { describe, expect, it } from 'vitest';
import {
  isIpLiteral,
  normalizeAiTargetProperties,
  normalizeEndpointUrl,
  normalizeHostname,
  normalizeIdentifier,
  normalizeIdentityProperties,
  normalizeIps,
  normalizeMac,
  normalizeMachineProperties,
  normalizeMacs,
  normalizePlatform,
  normalizeRoleNames,
  normalizeSid,
  normalizeUpn,
} from './normalization';

describe('normalizeHostname', () => {
  it('lower-cases and trims', () => {
    expect(normalizeHostname(' WIN-Laptop01.corp.local ')).toBe('win-laptop01.corp.local');
  });
  it('returns null for empty input', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname(undefined)).toBeNull();
  });
});

describe('normalizeMac', () => {
  it('strips separators and lower-cases', () => {
    expect(normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('aabbccddeeff');
    expect(normalizeMac('aa-bb-cc-dd-ee-ff')).toBe('aabbccddeeff');
  });
  it('denylists broadcast, all-zero and multicast placeholders', () => {
    expect(normalizeMac('FF:FF:FF:FF:FF:FF')).toBeNull();
    expect(normalizeMac('00:00:00:00:00:00')).toBeNull();
    expect(normalizeMac('01:80:C2:00:00:00')).toBeNull();
  });
  it('denylists clone-prone virtual NIC OUIs', () => {
    expect(normalizeMac('00:50:56:aa:bb:cc')).toBeNull(); // VMware
    expect(normalizeMac('08:00:27:aa:bb:cc')).toBeNull(); // VirtualBox
    expect(normalizeMac('00:15:5d:aa:bb:cc')).toBeNull(); // Hyper-V
    expect(normalizeMac('02:42:aa:bb:cc:dd')).toBeNull(); // Docker
  });
  it('rejects malformed input', () => {
    expect(normalizeMac('not-a-mac')).toBeNull();
    expect(normalizeMac(null)).toBeNull();
  });
});

describe('normalizeMacs', () => {
  it('drops denylisted entries and dedupes', () => {
    expect(normalizeMacs(['AA:BB:CC:DD:EE:FF', 'aabbccddeeff', 'ff:ff:ff:ff:ff:ff'])).toEqual(['aabbccddeeff']);
  });
  it('returns one canonical order, whatever order the source reported them in', () => {
    const reported = ['eaee5e1c7fdc', '623c720747ab', 'a0b1c2d3e4f5'];
    expect(normalizeMacs(reported)).toEqual(['623c720747ab', 'a0b1c2d3e4f5', 'eaee5e1c7fdc']);
    expect(normalizeMacs([...reported].reverse())).toEqual(normalizeMacs(reported));
  });
  it('keeps an absent or empty list empty', () => {
    expect(normalizeMacs(null)).toEqual([]);
    expect(normalizeMacs([])).toEqual([]);
  });
});

describe('normalizeIdentifier', () => {
  it('trims', () => {
    expect(normalizeIdentifier(' abc-123 ')).toBe('abc-123');
  });
  it('returns null for an empty or whitespace-only string, as Advanced Hunting serializes an absent attribute', () => {
    expect(normalizeIdentifier('')).toBeNull();
    expect(normalizeIdentifier('   ')).toBeNull();
    expect(normalizeIdentifier(null)).toBeNull();
    expect(normalizeIdentifier(undefined)).toBeNull();
  });
});

describe('normalizePlatform', () => {
  it('folds the two connectors\' own vocabularies onto one family', () => {
    // Defender's `OSPlatform` against OpenAEV's `PLATFORM_TYPE`, as both are served today.
    expect(normalizePlatform('Windows11')).toBe(normalizePlatform('Windows'));
    expect(normalizePlatform('WindowsServer2019')).toBe(normalizePlatform('Windows'));
    expect(normalizePlatform('macOS')).toBe(normalizePlatform('MacOS'));
    expect(normalizePlatform('Linux')).toBe(normalizePlatform('Linux'));
  });
  it('keeps distinct families apart', () => {
    expect(normalizePlatform('Windows11')).not.toBe(normalizePlatform('Linux'));
    expect(normalizePlatform('macOS')).not.toBe(normalizePlatform('iOS'));
  });
  it('returns null for a family it does not know, so tier 3 declines rather than guesses', () => {
    expect(normalizePlatform('Generic')).toBeNull();
    expect(normalizePlatform('Internal')).toBeNull();
    expect(normalizePlatform('Unknown')).toBeNull();
    expect(normalizePlatform('Ubuntu22')).toBeNull();
    expect(normalizePlatform('')).toBeNull();
    expect(normalizePlatform(null)).toBeNull();
    expect(normalizePlatform(undefined)).toBeNull();
  });
});

describe('normalizeIps', () => {
  it('drops loopback and link-local addresses', () => {
    expect(normalizeIps(['127.0.0.1', '::1', '169.254.1.2', '10.0.0.5'])).toEqual(['10.0.0.5']);
  });
  it('drops the whole IPv4 loopback range, not just 127.0.0.1', () => {
    expect(normalizeIps(['127.0.0.2', '127.5.5.5', '127.255.255.255', '10.0.0.5'])).toEqual(['10.0.0.5']);
  });
  it('drops the whole IPv6 link-local range fe80::/10, case-insensitively', () => {
    expect(normalizeIps(['fe80::1', 'FE80::abcd', 'fe90::1', 'febf::ffff', '10.0.0.5'])).toEqual(['10.0.0.5']);
  });
  it('keeps an address that merely starts with the same digits as the loopback/link-local ranges', () => {
    expect(normalizeIps(['1270.0.0.1', 'fe8::1', '10.0.0.5'])).toEqual(['10.0.0.5', '1270.0.0.1', 'fe8::1']);
  });
  it('dedupes', () => {
    expect(normalizeIps(['10.0.0.5', '10.0.0.5'])).toEqual(['10.0.0.5']);
  });
  it('returns one canonical order, whatever order the source reported them in', () => {
    const reported = ['192.168.1.20', '10.0.0.5', 'FE00::1', '10.0.0.5'];
    expect(normalizeIps(reported)).toEqual(['10.0.0.5', '192.168.1.20', 'fe00::1']);
    expect(normalizeIps([...reported].reverse())).toEqual(normalizeIps(reported));
  });
  it('orders the numbers of an address by value, not by their digits', () => {
    expect(normalizeIps(['10.0.0.10', '10.0.0.2', '9.1.1.1'])).toEqual(['9.1.1.1', '10.0.0.2', '10.0.0.10']);
  });
  it('keeps an absent or empty list empty', () => {
    expect(normalizeIps(undefined)).toEqual([]);
    expect(normalizeIps([])).toEqual([]);
  });
});

describe('normalizeEndpointUrl', () => {
  it('lower-cases scheme and host', () => {
    expect(normalizeEndpointUrl('HTTPS://API.Example.COM/v1/chat')).toBe('https://api.example.com/v1/chat');
  });
  it('drops the default port for the scheme', () => {
    expect(normalizeEndpointUrl('https://api.example.com:443/v1/chat')).toBe('https://api.example.com/v1/chat');
    expect(normalizeEndpointUrl('http://api.example.com:80/v1/chat')).toBe('http://api.example.com/v1/chat');
  });
  it('keeps a non-default port', () => {
    expect(normalizeEndpointUrl('https://api.example.com:8443/v1/chat')).toBe('https://api.example.com:8443/v1/chat');
  });
  it('drops a trailing slash but keeps the rest of the path', () => {
    expect(normalizeEndpointUrl('https://api.example.com/v1/chat/')).toBe('https://api.example.com/v1/chat');
  });
  it('drops a bare root path entirely', () => {
    expect(normalizeEndpointUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(normalizeEndpointUrl('https://api.example.com')).toBe('https://api.example.com');
  });
  it('keeps the query string, which names a different target', () => {
    expect(normalizeEndpointUrl('https://api.example.com/v1/chat?deployment=prod'))
      .not.toBe(normalizeEndpointUrl('https://api.example.com/v1/chat?deployment=staging'));
  });
  it('sorts query parameters so one order does not read as a different endpoint', () => {
    expect(normalizeEndpointUrl('https://api.example.com/v1/chat?b=2&a=1'))
      .toBe(normalizeEndpointUrl('https://api.example.com/v1/chat?a=1&b=2'));
  });
  it('returns null for malformed input rather than throwing', () => {
    expect(normalizeEndpointUrl('not a url')).toBeNull();
    expect(normalizeEndpointUrl('')).toBeNull();
    expect(normalizeEndpointUrl(null)).toBeNull();
    expect(normalizeEndpointUrl(undefined)).toBeNull();
  });
});

describe('normalizeMachineProperties', () => {
  it('normalises a hand-typed MAC onto the same identifier a connector would store', () => {
    expect(normalizeMachineProperties({ family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:FF'] }).macAddresses)
      .toEqual(['aabbccddeeff']);
  });
  it('normalises every identifier field, same as a connector\'s own input', () => {
    expect(normalizeMachineProperties({
      family: 'machine',
      hostname: ' WIN-Laptop01.corp.local ',
      ipAddresses: ['127.0.0.1', '10.0.0.5'],
      hardwareUuid: '  HW-1  ',
      platform: 'Windows11',
    })).toMatchObject({
      hostname: 'win-laptop01.corp.local',
      ipAddresses: ['10.0.0.5'],
      hardwareUuid: 'HW-1',
      platform: 'windows',
    });
  });
  it('defaults an absent optional field to null, never to undefined', () => {
    const result = normalizeMachineProperties({ family: 'machine' });
    expect(result.cloudProvider).toBeNull();
    expect(result.arch).toBeNull();
    expect(result.isEol).toBeNull();
    expect(result.macAddresses).toEqual([]);
    expect(result.ipAddresses).toEqual([]);
  });
});

describe('normalizeAiTargetProperties', () => {
  it('derives normalizedEndpointUrl from the raw endpointUrl, never accepting one directly', () => {
    const result = normalizeAiTargetProperties({ family: 'ai_target', endpointUrl: 'HTTPS://API.Example.COM:443/v1/chat' });
    expect(result.endpointUrl).toBe('HTTPS://API.Example.COM:443/v1/chat');
    expect(result.normalizedEndpointUrl).toBe('https://api.example.com/v1/chat');
  });
  it('defaults an absent optional field to null', () => {
    const result = normalizeAiTargetProperties({ family: 'ai_target' });
    expect(result.provider).toBeNull();
    expect(result.endpointUrl).toBeNull();
    expect(result.normalizedEndpointUrl).toBeNull();
    expect(result.model).toBeNull();
    expect(result.modality).toBeNull();
    expect(result.systemPrompt).toBeNull();
  });
});

describe('normalizeIdentityProperties', () => {
  it('derives the directory from the SID a connector read', () => {
    expect(normalizeIdentityProperties({ family: 'identity', cloudSid: 'S-1-12-1-1-2-3-4' }).identityProvider).toBe('entra');
    expect(normalizeIdentityProperties({ family: 'identity', onPremSid: 'S-1-5-21-1-2-3-1001' }).identityProvider).toBe('active_directory');
    expect(normalizeIdentityProperties({ family: 'identity' }).identityProvider).toBeNull();
  });
  it('takes the directory a person states over the one no SID names', () => {
    expect(normalizeIdentityProperties({ family: 'identity', identityProvider: 'active_directory' }).identityProvider).toBe('active_directory');
  });
  it('normalises a typed UPN and role list as a connector\'s', () => {
    const result = normalizeIdentityProperties({ family: 'identity', userPrincipalName: ' JDoe@Corp.Example ', assignedRoles: [' Global Administrator ', ''] });
    expect(result.userPrincipalName).toBe(normalizeUpn(' JDoe@Corp.Example '));
    expect(result.assignedRoles).toEqual(normalizeRoleNames([' Global Administrator ', '']));
    expect(result.privilegedPimRoles).toEqual([]);
  });
});

describe('isIpLiteral', () => {
  it('recognises a dotted quad, which would otherwise read as a qualified hostname', () => {
    expect(isIpLiteral('10.0.0.5')).toBe(true);
    expect(isIpLiteral('192.168.1.254')).toBe(true);
  });
  it('recognises an IPv6 address, including one carrying an embedded IPv4', () => {
    expect(isIpLiteral('2001:db8::1')).toBe(true);
    expect(isIpLiteral('::ffff:10.0.0.5')).toBe(true);
  });
  it('leaves a real hostname alone, however many labels or digits it carries', () => {
    expect(isIpLiteral('srv01.corp.local')).toBe(false);
    expect(isIpLiteral('10-0-0-5.corp.local')).toBe(false);
    expect(isIpLiteral('10.0.0.5.corp.local')).toBe(false);
  });
});

describe('normalizeSid', () => {
  it('upper-cases a SID so two sources spelling one differently still match', () => {
    expect(normalizeSid('s-1-5-21-1004336348-1177238915-682003330-512')).toBe('S-1-5-21-1004336348-1177238915-682003330-512');
  });
  it('accepts the well-known short forms', () => {
    expect(normalizeSid('S-1-5-18')).toBe('S-1-5-18');
    expect(normalizeSid('S-1-1-0')).toBe('S-1-1-0');
  });
  it('drops anything not shaped like a SID, which would otherwise fuse every identity carrying it', () => {
    expect(normalizeSid('CORP\\jdoe')).toBeNull();
    expect(normalizeSid('jdoe@example.com')).toBeNull();
    expect(normalizeSid('S-1-5-21-abc')).toBeNull();
    expect(normalizeSid('not-a-sid')).toBeNull();
  });
  it('treats the empty string Advanced Hunting serializes for an absent field as absent', () => {
    expect(normalizeSid('')).toBeNull();
    expect(normalizeSid('   ')).toBeNull();
    expect(normalizeSid(null)).toBeNull();
    expect(normalizeSid(undefined)).toBeNull();
  });
});

describe('normalizeUpn', () => {
  it('lower-cases, since case carries no meaning in an email-shaped identifier', () => {
    expect(normalizeUpn('  J.Doe@Example.COM ')).toBe('j.doe@example.com');
  });
  it('drops a value carrying no domain part', () => {
    expect(normalizeUpn('jdoe')).toBeNull();
    expect(normalizeUpn('')).toBeNull();
    expect(normalizeUpn(null)).toBeNull();
  });
});

describe('normalizeRoleNames', () => {
  it('keeps the vendor casing, which is what a reader sees', () => {
    expect(normalizeRoleNames(['Global Administrator'])).toEqual(['Global Administrator']);
  });
  it('de-duplicates case-insensitively: a role held directly and through PIM arrives twice', () => {
    expect(normalizeRoleNames(['Global Administrator', 'global administrator'])).toEqual(['Global Administrator']);
  });
  it('drops blanks and preserves the order of what is left', () => {
    expect(normalizeRoleNames(['  ', 'User Administrator', '', 'Security Reader'])).toEqual(['User Administrator', 'Security Reader']);
  });
  it('reads an absent list as empty', () => {
    expect(normalizeRoleNames(null)).toEqual([]);
    expect(normalizeRoleNames(undefined)).toEqual([]);
  });
});
