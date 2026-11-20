import { describe, expect, it } from 'vitest';
import type { CveObservationFields } from './resolution';
import type { CveSource } from './sources';
import { cvssVersionOf, resolveCveFields } from './resolution';

const NVD_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

const observation = (source: CveSource, fields: Partial<CveObservationFields> = {}): CveObservationFields => ({
  source,
  cvss: null,
  cvssVector: null,
  cvssV2UserInteractionRequired: null,
  cvssUpdatedAt: null,
  cwe: null,
  title: null,
  description: null,
  epss: null,
  epssUpdatedAt: null,
  kev: null,
  kevUpdatedAt: null,
  kevRequiredAction: null,
  kevDueDate: null,
  kevNotes: null,
  kevRansomwareUse: null,
  ...fields,
});

describe('resolveCveFields', () => {
  it('takes the vector and the score of the same source, never another source\'s score', () => {
    const nvdDate = new Date('2024-01-10T00:00:00Z');
    const resolved = resolveCveFields([
      observation('microsoft_defender', { cvss: 7 }),
      observation('nvd', { cvss: 9.8, cvssVector: NVD_VECTOR, cvssUpdatedAt: nvdDate }),
    ]);
    expect(resolved).toMatchObject({ cvss: 9.8, cvssVector: NVD_VECTOR, cvssUpdatedAt: nvdDate });
  });

  it('takes a score with no vector while no source states a vector', () => {
    const resolved = resolveCveFields([observation('microsoft_defender', { cvss: 7 }), observation('nvd', { cwe: ['CWE-79'] })]);
    expect(resolved).toMatchObject({ cvss: 7, cvssVector: null, cvssUpdatedAt: null });
  });

  it('prefers a lower-ranked source with a vector over a higher-ranked one with a score alone', () => {
    const resolved = resolveCveFields([
      observation('nvd', { cvss: 5 }),
      observation('microsoft_defender', { cvss: 6.5, cvssVector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H' }),
    ]);
    expect(resolved).toMatchObject({ cvss: 6.5, cvssVector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H' });
  });

  it('takes the CVSS 2.0 user interaction flag with the vector it stands beside', () => {
    const resolved = resolveCveFields([
      observation('microsoft_defender', { cvss: 7 }),
      observation('nvd', { cvss: 6.8, cvssVector: 'AV:N/AC:M/Au:N/C:P/I:P/A:P', cvssV2UserInteractionRequired: true }),
    ]);
    expect(resolved).toMatchObject({ cvss: 6.8, cvssVector: 'AV:N/AC:M/Au:N/C:P/I:P/A:P', cvssV2UserInteractionRequired: true });
  });

  it('resolves the same fields whatever order the observations arrived in', () => {
    const observations = [
      observation('nvd', { cvss: 9.8, cvssVector: NVD_VECTOR, cwe: ['CWE-22'], description: 'Path traversal' }),
      observation('microsoft_defender', { cvss: 7, kev: true }),
      observation('first', { epss: 0.4, epssUpdatedAt: new Date('2024-02-01') }),
      observation('cisa_kev', { kev: true, kevUpdatedAt: new Date('2024-03-01'), title: 'Known exploited' }),
    ];
    expect(resolveCveFields([...observations].reverse())).toEqual(resolveCveFields(observations));
  });

  it('unions the specific CWE ids and drops the NVD placeholders', () => {
    const resolved = resolveCveFields([observation('nvd', { cwe: ['CWE-787', 'NVD-CWE-noinfo', 'CWE-787', 'CWE-20'] })]);
    expect(resolved.cwe).toEqual(['CWE-787', 'CWE-20']);
  });

  it('keeps the most recent EPSS', () => {
    const resolved = resolveCveFields([
      observation('first', { epss: 0.2, epssUpdatedAt: new Date('2024-02-01') }),
      observation('microsoft_defender', { epss: 0.1, epssUpdatedAt: new Date('2024-01-01') }),
    ]);
    expect(resolved).toMatchObject({ epss: 0.2, epssUpdatedAt: new Date('2024-02-01') });
  });

  it('reads KEV from CISA\'s listing over a connector\'s exploit-available flag', () => {
    const listedAt = new Date('2024-03-01');
    expect(resolveCveFields([
      observation('microsoft_defender', { kev: false }),
      observation('cisa_kev', { kev: true, kevUpdatedAt: listedAt, kevNotes: 'https://example.test' }),
    ])).toMatchObject({ kev: true, kevUpdatedAt: listedAt, kevNotes: 'https://example.test' });
    expect(resolveCveFields([observation('microsoft_defender', { kev: true })])).toEqual({ kev: true });
  });

  it('states nothing a source did not report, so the stored value stands', () => {
    expect(resolveCveFields([])).toEqual({});
    expect(resolveCveFields([observation('first', { epss: 0.3, epssUpdatedAt: new Date('2024-02-01') })]))
      .toEqual({ epss: 0.3, epssUpdatedAt: new Date('2024-02-01') });
  });
});

describe('cvssVersionOf', () => {
  it('reads the version from the prefix, and 2.0 from a vector that has none', () => {
    expect(cvssVersionOf('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBe('4.0');
    expect(cvssVersionOf(NVD_VECTOR)).toBe('3.1');
    expect(cvssVersionOf('AV:N/AC:L/Au:N/C:C/I:C/A:C')).toBe('2.0');
  });
});
