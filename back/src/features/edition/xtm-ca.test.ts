import { createHash, X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { XTM_CA_PEM } from './xtm-ca';
import { verifyXtmLicense } from './xtm-license';
import { createTestXtmCa, issueTestXtmLicense, xtmLicenseExtensions } from './xtm-license-fixtures';

// The digests XTM One publishes for its XTM CA and pins its own `XTM_CA_PEM` to: a product embedding
// another anchor would verify nothing.
const CERTIFICATE_SHA256 = '43:6E:0B:82:14:0F:43:CA:0E:15:3F:1B:27:AC:E3:B3:88:F1:9F:24:BC:6C:36:6E:C1:24:91:87:45:BC:40:64';
const SUBJECT_PUBLIC_KEY_INFO_SHA256 = '9ef09cc6ab116344afd1a47ae5b777842b8c44fae78d223440d19bb7bc7d84ec';

describe('the XTM CA pinned in the build', () => {
  const anchor = new X509Certificate(XTM_CA_PEM);

  it('is the certificate XTM One publishes', () => {
    expect(anchor.fingerprint256).toBe(CERTIFICATE_SHA256);
  });

  it('carries the public key XTM One publishes', () => {
    const spki = anchor.publicKey.export({ type: 'spki', format: 'der' });
    expect(createHash('sha256').update(spki).digest('hex')).toBe(SUBJECT_PUBLIC_KEY_INFO_SHA256);
    expect(anchor.publicKey.asymmetricKeyDetails?.modulusLength).toBe(4096);
  });

  it('is the only anchor a license is verified against', () => {
    const now = Date.now();
    const signedElsewhere = issueTestXtmLicense(createTestXtmCa(), {
      notBefore: now - 60_000,
      notAfter: now + 24 * 60 * 60_000,
      extensions: xtmLicenseExtensions(),
    });

    expect(verifyXtmLicense(signedElsewhere, { platformId: 'instance-1', instanceCreatedAt: now, now })).toEqual({
      entitled: false,
      signed: false,
      reason: 'its signature does not verify against the XTM CA',
    });
  });
});
