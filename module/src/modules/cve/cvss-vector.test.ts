import { describe, expect, it } from 'vitest';
import { entryImpact, explainCvssContributions, parseCvssContributions, readCvssAccess, readCvssMetrics } from './cvss-vector';

const vector = (levels: { c: string, i: string, a: string }) =>
  `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:${levels.c}/I:${levels.i}/A:${levels.a}`;

describe('entryImpact', () => {
  it('is 1 when confidentiality or integrity is High', () => {
    expect(entryImpact(vector({ c: 'H', i: 'N', a: 'N' }))).toBe(1);
    expect(entryImpact(vector({ c: 'N', i: 'H', a: 'N' }))).toBe(1);
    expect(entryImpact(vector({ c: 'H', i: 'H', a: 'H' }))).toBe(1);
  });

  it('reads the worse of the two metrics against the High weight', () => {
    expect(entryImpact(vector({ c: 'L', i: 'N', a: 'N' }))).toBeCloseTo(0.22 / 0.56);
    expect(entryImpact(vector({ c: 'L', i: 'L', a: 'N' }))).toBeCloseTo(0.22 / 0.56);
    expect(entryImpact(vector({ c: 'L', i: 'H', a: 'N' }))).toBe(1);
  });

  it('ignores availability', () => {
    expect(entryImpact(vector({ c: 'N', i: 'N', a: 'H' }))).toBe(0);
  });

  it('reads a CVSS 4.0 vector from the vulnerable system metrics', () => {
    expect(entryImpact('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N')).toBe(1);
    expect(entryImpact('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:H/SI:H/SA:H')).toBeCloseTo(0.22 / 0.56);
  });

  it('is null exactly where the finding score refuses the vector', () => {
    const refused = [
      null,
      '',
      'AV:N/AC:L/Au:N/C:C/I:C',
      'CVSS:2.0/AV:N/AC:L/Au:N/C:C/I:C/A:C',
      'CVSS:3.1/AV:N',
      'garbage',
      'CVSS:3.1/AV:N//AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.1/AV:N:x/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/AV:N',
    ];
    for (const candidate of refused) {
      expect(parseCvssContributions(candidate)).toBeNull();
      expect(entryImpact(candidate)).toBeNull();
    }
  });
});

describe('a CVSS 2.0 vector', () => {
  const v31 = (metrics: string) => parseCvssContributions(`CVSS:3.1/${metrics}`);

  it('reads its impact as the 3.1 vector its partial and complete losses map to', () => {
    const v2 = parseCvssContributions('AV:N/AC:L/Au:N/C:N/I:N/A:P');
    expect(v2?.version).toBe('2.0');
    expect(v2?.impact).toBeCloseTo(v31('AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L')!.impact, 10);
    expect(parseCvssContributions('AV:N/AC:L/Au:N/C:C/I:C/A:C')?.impact).toBeCloseTo(1, 10);
  });

  it('reads authentication as the privileges 3.1 requires, under the same attack vector', () => {
    expect(parseCvssContributions('AV:N/AC:L/Au:S/C:P/I:P/A:P')?.access)
      .toBeCloseTo(v31('AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:L')!.access, 10);
    expect(parseCvssContributions('AV:A/AC:L/Au:M/C:P/I:P/A:P')?.access)
      .toBeCloseTo(v31('AV:A/AC:L/PR:H/UI:N/S:U/C:L/I:L/A:L')!.access, 10);
  });

  it('reads a medium complexity as low, leaving the threat undampened, and a high one as high', () => {
    expect(parseCvssContributions('AV:N/AC:M/Au:N/C:P/I:P/A:P')?.complexity).toBe(1);
    expect(parseCvssContributions('AV:N/AC:H/Au:N/C:P/I:P/A:P')?.complexity)
      .toBeCloseTo(v31('AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L')!.complexity, 10);
  });

  it('needs a user only when NVD flags it, and only on 2.0', () => {
    const nobody = parseCvssContributions('AV:N/AC:L/Au:N/C:P/I:P/A:P');
    const user = parseCvssContributions('AV:N/AC:L/Au:N/C:P/I:P/A:P', true);
    expect(nobody?.access).toBeCloseTo(1, 10);
    expect(user?.access).toBeCloseTo(v31('AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:L')!.access, 10);
    expect(parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', true)?.access).toBeCloseTo(1, 10);
  });

  it('explains its terms in its own letters, weighted as the score weighs them', () => {
    const terms = explainCvssContributions('AV:N/AC:L/Au:S/C:N/I:N/A:P', true);
    expect(terms?.access.privilegesRequired).toEqual({ value: 'S', weight: 0.62 });
    expect(terms?.access.userInteraction).toEqual({ value: 'R', weight: 0.62 });
    expect(terms?.impact.availability).toEqual({ value: 'P', weight: 0.22 });
    expect(terms!.access.product / terms!.access.maxProduct)
      .toBeCloseTo(parseCvssContributions('AV:N/AC:L/Au:S/C:N/I:N/A:P', true)!.access, 10);
  });

  it('lists its metrics as published, and its access in 3.1 letters for the topology rule', () => {
    expect(readCvssMetrics('AV:N/AC:L/Au:S/C:N/I:N/A:P')).toEqual([
      { metric: 'AV', value: 'N' },
      { metric: 'AC', value: 'L' },
      { metric: 'Au', value: 'S' },
      { metric: 'C', value: 'N' },
      { metric: 'I', value: 'N' },
      { metric: 'A', value: 'P' },
    ]);
    expect(readCvssAccess('AV:N/AC:L/Au:S/C:N/I:N/A:P', true))
      .toEqual({ attackVector: 'N', privilegesRequired: 'L', userInteraction: 'R' });
  });

  it('refuses a malformed or truncated one, as every other version', () => {
    for (const malformed of [
      'AV:N/AC:L/Au:N/C:P/I:P',
      'AV:P/AC:L/Au:N/C:P/I:P/A:P',
      'AV:N/AC:L/Au:X/C:P/I:P/A:P',
      'AV:N/AC:L/Au:N/C:H/I:P/A:P',
      'AV:N//AC:L/Au:N/C:P/I:P/A:P',
      'AV:N:garbage/AC:L/Au:N/C:P/I:P/A:P',
      'AV:N/AC:L/Au:N/C:P/I:P/A:P/AV:L',
      'AV:N/AC:L/Au:N/C:P/I:P/A:P/',
    ]) {
      expect(parseCvssContributions(malformed)).toBeNull();
      expect(explainCvssContributions(malformed)).toBeNull();
      expect(readCvssMetrics(malformed)).toEqual([]);
      expect(readCvssAccess(malformed)).toBeNull();
    }
  });
});
