import { describe, expect, it } from 'vitest';
import { groupVulnerableSoftware, softwareDisplayName } from './vulnerable-software-utils';

describe('softwareDisplayName', () => {
  it.each([
    ['chrome_for_mac', 'Chrome for mac'],
    ['365_copilot_for_mac', '365 copilot for mac'],
    ['.net_framework', '.net framework'],
    ['openssl', 'Openssl'],
  ])('reads %s as %s', (raw, expected) => {
    expect(softwareDisplayName(raw)).toBe(expected);
  });
});

describe('groupVulnerableSoftware', () => {
  it('shows the vendor when it differs from the product', () => {
    expect(groupVulnerableSoftware([{ vendor: 'google', name: 'chrome_for_mac', version: '155.0.8059.85' }])).toEqual([
      { vendor: 'Google', name: 'Chrome for mac', versions: ['155.0.8059.85'] },
    ]);
  });

  it('leaves out a vendor that is the product itself, or that the source does not name', () => {
    expect(groupVulnerableSoftware([
      { vendor: 'openssl', name: 'openssl', version: '3.0.15.0' },
      { vendor: null, name: 'curl', version: '8.0.1' },
    ])).toEqual([
      { vendor: null, name: 'Curl', versions: ['8.0.1'] },
      { vendor: null, name: 'Openssl', versions: ['3.0.15.0'] },
    ]);
  });

  it('puts every version of one product on its line, in release order', () => {
    const [openssl] = groupVulnerableSoftware(['4.0.2.0', '3.10.1.0', '3.0.15.0', '3.4.1.0', '3.0.15.0']
      .map((version) => ({ vendor: 'openssl', name: 'openssl', version })));

    expect(openssl.versions).toEqual(['3.0.15.0', '3.4.1.0', '3.10.1.0', '4.0.2.0']);
  });

  it('keeps one line per product', () => {
    expect(groupVulnerableSoftware([
      { vendor: 'google', name: 'chrome', version: '1.0' },
      { vendor: 'microsoft', name: 'edge', version: '2.0' },
      { vendor: 'google', name: 'chrome', version: '1.1' },
    ]).map((product) => [product.name, product.versions])).toEqual([
      ['Chrome', ['1.0', '1.1']],
      ['Edge', ['2.0']],
    ]);
  });

  it('keeps one line for spellings that read the same once cleaned up', () => {
    expect(groupVulnerableSoftware([
      { vendor: 'openssl', name: 'openssl', version: '3.0.15.0' },
      { vendor: null, name: 'openssl', version: '3.4.1.0' },
      { vendor: 'google', name: 'chrome_for_mac', version: '1.0' },
      { vendor: 'google', name: 'Chrome_for_mac', version: '1.1' },
    ])).toEqual([
      { vendor: 'Google', name: 'Chrome for mac', versions: ['1.0', '1.1'] },
      { vendor: null, name: 'Openssl', versions: ['3.0.15.0', '3.4.1.0'] },
    ]);
  });

  it('is empty when no source names any software', () => {
    expect(groupVulnerableSoftware([])).toEqual([]);
  });
});
