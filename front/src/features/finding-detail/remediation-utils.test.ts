import { describe, expect, it } from 'vitest';
import type { AffectedVersion } from './remediation-utils';
import {
  collectReferences,
  kevCatalogUrl,
  kevNoteUrls,
  readRemediation,
  referenceLabel,
  splitRequiredAction,
} from './remediation-utils';

const version = (overrides: Partial<AffectedVersion>): AffectedVersion => ({
  vendor: null,
  product: null,
  affectedFrom: null,
  affectedUpTo: '1.3.2',
  affectedUpToIncluded: false,
  ...overrides,
});

const reference = (url: string, tags: Array<string> | null = null) => ({ url, source: null, tags });

describe('referenceLabel', () => {
  it('keeps the path, which is what tells two pages of one host apart', () => {
    expect(referenceLabel('https://github.com/webmproject/libwebp/releases/tag/v1.3.2'))
      .toBe('github.com/webmproject/libwebp/releases/tag/v1.3.2');
  });

  it('drops a www prefix', () => {
    expect(referenceLabel('https://www.cisa.gov/known-exploited-vulnerabilities-catalog'))
      .toBe('cisa.gov/known-exploited-vulnerabilities-catalog');
  });

  it('drops the query, which carries ids no reader reads', () => {
    expect(referenceLabel('https://chromereleases.googleblog.com/2023/09/update.html?m=1'))
      .toBe('chromereleases.googleblog.com/2023/09/update.html');
  });

  it('is the bare host when the url has no path', () => {
    expect(referenceLabel('https://fortiguard.com/')).toBe('fortiguard.com');
  });

  it('falls back to the raw string when the url cannot be read', () => {
    expect(referenceLabel('not a url')).toBe('not a url');
  });
});

describe('kevNoteUrls', () => {
  it('reads urls out of prose, whatever separates them', () => {
    expect(kevNoteUrls('This CVE has a CISA AA located here: https://www.cisa.gov/aa23-158a. Please see the AA. Additional information is available at: https://community.progress.com/s/article/MOVEit.;  https://nvd.nist.gov/vuln/detail/CVE-2023-34362'))
      .toEqual(['https://www.cisa.gov/aa23-158a', 'https://community.progress.com/s/article/MOVEit']);
  });

  it('drops the nvd record every note closes on', () => {
    expect(kevNoteUrls('https://nvd.nist.gov/vuln/detail/CVE-2021-44228')).toEqual([]);
  });

  it('answers empty on a missing field', () => {
    expect(kevNoteUrls(null)).toEqual([]);
  });
});

describe('splitRequiredAction', () => {
  it('keeps the sentence and marks the url inside it', () => {
    expect(splitRequiredAction('Apply mitigations per vendor instructions [https://www.netscaler.com/blog/news] OR discontinue use.'))
      .toEqual([
        { kind: 'text', value: 'Apply mitigations per vendor instructions [' },
        { kind: 'link', value: 'https://www.netscaler.com/blog/news' },
        { kind: 'text', value: '] OR discontinue use.' },
      ]);
  });

  it('leaves a boilerplate action as one text segment', () => {
    expect(splitRequiredAction('Apply updates per vendor instructions.'))
      .toEqual([{ kind: 'text', value: 'Apply updates per vendor instructions.' }]);
  });
});

describe('collectReferences', () => {
  it('adds a kev note url the nvd never published', () => {
    const collected = collectReferences(
      [reference('https://support.citrix.com/article/CTX579459')],
      'https://www.netscaler.com/blog/news/cve-2023-4966 ; https://nvd.nist.gov/vuln/detail/CVE-2023-4966',
    );
    expect(collected.map((r) => r.url)).toEqual([
      'https://support.citrix.com/article/CTX579459',
      'https://www.netscaler.com/blog/news/cve-2023-4966',
    ]);
    expect(collected[1].fromCisa).toBe(true);
  });

  it('drops a note url pointing at a page the nvd already published under a query', () => {
    const collected = collectReferences(
      [reference('https://chromereleases.googleblog.com/2023/09/update.html')],
      'https://chromereleases.googleblog.com/2023/09/update.html?m=1',
    );
    expect(collected).toHaveLength(1);
    expect(collected[0].fromCisa).toBe(false);
  });
});

describe('readRemediation', () => {
  it('names the version to move to when the ranges name exactly one', () => {
    const { components } = readRemediation({
      affectedVersions: [version({ vendor: 'Google', product: 'Chrome', affectedUpTo: '116.0.5845.187' })],
      references: [],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('Chrome');
    expect(components[0].targetVersion).toBe('116.0.5845.187');
  });

  it('groups every release line of one component into one card', () => {
    const { components } = readRemediation({
      affectedVersions: [
        version({ vendor: 'Fortinet', product: 'FortiOS', affectedUpTo: '7.4.2', affectedUpToIncluded: true }),
        version({ vendor: 'Fortinet', product: 'FortiOS', affectedUpTo: '7.2.6', affectedUpToIncluded: true }),
        version({ vendor: 'Fortinet', product: 'FortiProxy', affectedUpTo: '7.4.2', affectedUpToIncluded: true }),
      ],
      references: [],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components.map((c) => c.name)).toEqual(['FortiOS', 'FortiProxy']);
  });

  it('names no version when the vendor declares the last one reached rather than the first fixed', () => {
    const { components } = readRemediation({
      affectedVersions: [version({ product: 'FortiOS', affectedUpTo: '7.4.2', affectedUpToIncluded: true })],
      references: [],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components[0].targetVersion).toBeNull();
  });

  it('names no version when several release lines each state a first fixed one', () => {
    const { components } = readRemediation({
      affectedVersions: [
        version({ product: 'FortiOS', affectedUpTo: '7.4.3' }),
        version({ product: 'FortiOS', affectedUpTo: '7.2.7' }),
      ],
      references: [],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components[0].targetVersion).toBeNull();
  });

  it('gives each component the vendor sentences naming it', () => {
    const { components } = readRemediation({
      affectedVersions: [
        version({ product: 'FortiOS', affectedUpTo: '7.4.2', affectedUpToIncluded: true }),
        version({ product: 'FortiProxy', affectedUpTo: '7.4.2', affectedUpToIncluded: true }),
      ],
      references: [],
      kevNotes: null,
      vendorSolution: 'Please upgrade to FortiProxy version 7.4.3 or above\nPlease upgrade to FortiOS version 7.6.0 or above',
    });
    expect(components[0].vendorLines).toEqual(['Please upgrade to FortiOS version 7.6.0 or above']);
    expect(components[1].vendorLines).toEqual(['Please upgrade to FortiProxy version 7.4.3 or above']);
  });

  it('gives a sole component every vendor sentence, since none names a product', () => {
    const { components } = readRemediation({
      affectedVersions: [version({ product: 'MOVEit Transfer', affectedUpTo: '2023.0.1', affectedUpToIncluded: true })],
      references: [],
      kevNotes: null,
      vendorSolution: 'Upgrade to the patched release.',
    });
    expect(components[0].vendorLines).toEqual(['Upgrade to the patched release.']);
  });

  it('files a fix reference on the component its url names', () => {
    const { components, leads, rest } = readRemediation({
      affectedVersions: [
        version({ vendor: 'Google', product: 'Chrome', affectedUpTo: '116.0.5845.187' }),
        version({ vendor: 'Google', product: 'libwebp', affectedUpTo: '1.3.2' }),
      ],
      references: [
        reference('https://chromereleases.googleblog.com/2023/09/update.html', ['Vendor Advisory']),
        reference('https://github.com/webmproject/libwebp/commit/902bc919', ['Patch']),
        reference('https://msrc.microsoft.com/update-guide/vulnerability/CVE-2023-4863', ['Patch']),
        reference('https://openwall.com/lists/oss-security/2023/09/21/4', ['Mailing List']),
      ],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components[0].references.map((r) => r.url)).toEqual(['https://chromereleases.googleblog.com/2023/09/update.html']);
    expect(components[1].references.map((r) => r.url)).toEqual(['https://github.com/webmproject/libwebp/commit/902bc919']);
    expect(leads.map((r) => r.url)).toEqual(['https://msrc.microsoft.com/update-guide/vulnerability/CVE-2023-4863']);
    expect(rest.map((r) => r.url)).toEqual(['https://openwall.com/lists/oss-security/2023/09/21/4']);
  });

  it('never matches on the vendor name, which one vendor shares across its products', () => {
    const { components, leads } = readRemediation({
      affectedVersions: [
        version({ vendor: 'Google', product: 'Chrome', affectedUpTo: '116.0.5845.187' }),
        version({ vendor: 'Google', product: 'libwebp', affectedUpTo: '1.3.2' }),
      ],
      references: [reference('https://blog.google/threat-analysis-group/an-advisory', ['Vendor Advisory'])],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components.flatMap((c) => c.references)).toEqual([]);
    expect(leads).toHaveLength(1);
  });

  it('matches a product whose name a url cannot spell, word by word', () => {
    const { components } = readRemediation({
      affectedVersions: [version({ vendor: 'Citrix', product: 'NetScaler ADC', affectedUpTo: '14.1-8.50' })],
      references: [reference('https://www.netscaler.com/blog/news/cve-2023-4966-update', ['Vendor Advisory'])],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components[0].references).toHaveLength(1);
  });

  it('matches across the punctuation a cna and a url disagree on', () => {
    const { components } = readRemediation({
      affectedVersions: [version({ vendor: 'Apache', product: 'Log4j2', affectedUpTo: '2.15.0' })],
      references: [reference('https://logging.apache.org/log4j/2.x/security.html', ['Patch'])],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components[0].references).toHaveLength(1);
  });

  it('treats a kev note url as a fix reference and files it like any other', () => {
    const { components } = readRemediation({
      affectedVersions: [version({ vendor: 'Citrix', product: 'NetScaler ADC', affectedUpTo: '14.1-8.50' })],
      references: [],
      kevNotes: 'https://www.netscaler.com/blog/news/cve-2023-4966-critical-security-update',
      vendorSolution: null,
    });
    expect(components[0].references).toHaveLength(1);
    expect(components[0].references[0].fromCisa).toBe(true);
  });

  it('answers with no component when no range was published', () => {
    const { components, leads } = readRemediation({
      affectedVersions: [],
      references: [reference('https://www.zyxel.com/global/en/support/security-advisories/legacy-dsl-cpe', ['Vendor Advisory'])],
      kevNotes: null,
      vendorSolution: null,
    });
    expect(components).toEqual([]);
    expect(leads).toHaveLength(1);
  });
});

describe('kevCatalogUrl', () => {
  it('filters the catalogue on the cve id', () => {
    expect(kevCatalogUrl('CVE-2023-4863'))
      .toBe('https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2023-4863');
  });
});

describe('vendor prose no component claims', () => {
  it('reports every line when the feed stated no version range', () => {
    const remediation = readRemediation({
      affectedVersions: [],
      references: [],
      kevNotes: null,
      vendorSolution: 'Upgrade to 7.4.3 or later.\nUpgrade to 7.2.9 or later.',
    });

    // The prose is the only place these versions are named, so an absent range must not take it down.
    expect(remediation.components).toEqual([]);
    expect(remediation.unassignedVendorLines).toEqual([
      'Upgrade to 7.4.3 or later.',
      'Upgrade to 7.2.9 or later.',
    ]);
  });

  it('keeps a line naming none of the several components the CVE lists', () => {
    const remediation = readRemediation({
      affectedVersions: [
        { vendor: 'Acme', product: 'Gateway', affectedFrom: null, affectedUpTo: '2.1.0', affectedUpToIncluded: false },
        { vendor: 'Acme', product: 'Portal', affectedFrom: null, affectedUpTo: '3.0.0', affectedUpToIncluded: false },
      ],
      references: [],
      kevNotes: null,
      vendorSolution: 'Upgrade Gateway to 2.1.0.\nCustomers should apply the January bundle.',
    });

    expect(remediation.components.find((fix) => fix.product === 'Gateway')?.vendorLines)
      .toEqual(['Upgrade Gateway to 2.1.0.']);
    expect(remediation.unassignedVendorLines).toEqual(['Customers should apply the January bundle.']);
  });

  it('claims a line once, so a component that took it is not also reported as unassigned', () => {
    const remediation = readRemediation({
      affectedVersions: [
        { vendor: 'Acme', product: 'Gateway', affectedFrom: null, affectedUpTo: '2.1.0', affectedUpToIncluded: false },
      ],
      references: [],
      kevNotes: null,
      vendorSolution: 'Upgrade to 2.1.0.',
    });

    expect(remediation.components[0].vendorLines).toEqual(['Upgrade to 2.1.0.']);
    expect(remediation.unassignedVendorLines).toEqual([]);
  });
});
