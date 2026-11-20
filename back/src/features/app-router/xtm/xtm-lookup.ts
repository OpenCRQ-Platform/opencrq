import type { CounterpartKind } from './xtm-counterpart-utils';
import { normaliseCounterpartKeys } from './xtm-counterpart-utils';

/**
 * The reverse lookup OpenCTI and OpenAEV call on OpenCRQ: which of the keys they hold name an
 * object of this tenant, answered in the shape OpenAEV's own lookup answers
 * (`object_key`, `object_id`, `object_type`, `object_name`, `object_url`, `object_facts`), so the
 * three products read one contract. The caller authenticates with an OpenCRQ service-account
 * token, whose tenant is bound server-side.
 */

export interface XtmLookupObject {
  object_key: string,
  object_id: string,
  object_type: string,
  object_name: string | null,
  object_url: string,
  object_facts: Array<{ key: string, value: string }>,
}

/** What the lookup reads from this tenant, one bounded batch per kind. */
export interface XtmLookupReader {
  threatsByStixIds: (stixIds: Array<string>) => Promise<Array<{ id: string, stixId: string, name: string, entityType: string }>>,
  cvesByCveIds: (cveIds: Array<string>) => Promise<Array<{ id: string, cveId: string }>>,
  assetsByHostnames: (hostnames: Array<string>) => Promise<Array<{ id: string, name: string | null, hostname: string | null }>>,
  /** The quantified exposure of the objects found, keyed by their OpenCRQ id (a CVE by its row id). */
  exposure: (kind: XtmLookupKind, objectIds: Array<string>) => Promise<ReadonlyMap<string, XtmLookupExposure>>,
}

export interface XtmLookupExposure {
  scenarioCount: number,
  aleMean: number | null,
  aleReductionMean: number | null,
}

/**
 * The facts the other products label: `risk_scenarios` the object drives, their summed mean
 * `annual_loss` and, for a CVE, its `fix_value`. Amounts are whole units of the tenant's currency;
 * an unpriced figure is left out, never written as zero.
 */
export const exposureFacts = (exposure: XtmLookupExposure | undefined): Array<{ key: string, value: string }> => {
  if (exposure === undefined || exposure.scenarioCount === 0) {
    return [];
  }
  return [
    { key: 'risk_scenarios', value: String(exposure.scenarioCount) },
    ...(exposure.aleMean === null ? [] : [{ key: 'annual_loss', value: String(Math.round(exposure.aleMean)) }]),
    ...(exposure.aleReductionMean === null ? [] : [{ key: 'fix_value', value: String(Math.round(exposure.aleReductionMean)) }]),
  ];
}

/** The kinds OpenCRQ answers for. An ATT&CK technique has no page of its own here, so it is not one. */
export const XTM_LOOKUP_KINDS = ['THREAT', 'VULNERABILITY', 'ASSET'] as const satisfies ReadonlyArray<CounterpartKind>;
export type XtmLookupKind = typeof XTM_LOOKUP_KINDS[number];

const enc = encodeURIComponent;

export const lookupXtmObjects = async (
  params: { kind: XtmLookupKind, keys: ReadonlyArray<string>, baseUrl: string, tenantId: string },
  reader: XtmLookupReader,
): Promise<Array<XtmLookupObject>> => {
  const keys = normaliseCounterpartKeys(params.kind, params.keys);
  if (keys.length === 0) {
    return [];
  }
  const tenantBase = `${params.baseUrl.replace(/\/+$/, '')}/${enc(params.tenantId)}`;
  switch (params.kind) {
    case 'THREAT': {
      const threats = await reader.threatsByStixIds(keys);
      const exposure = threats.length === 0 ? new Map<string, XtmLookupExposure>() : await reader.exposure('THREAT', threats.map((threat) => threat.id));
      return threats.map((threat) => ({
        object_key: threat.stixId.toLowerCase(),
        object_id: threat.id,
        object_type: threat.entityType,
        object_name: threat.name,
        object_url: `${tenantBase}/threat-center/threats/${enc(threat.id)}`,
        object_facts: exposureFacts(exposure.get(threat.id)),
      }));
    }
    case 'VULNERABILITY': {
      const cves = await reader.cvesByCveIds(keys);
      const exposure = cves.length === 0 ? new Map<string, XtmLookupExposure>() : await reader.exposure('VULNERABILITY', cves.map((cve) => cve.id));
      return cves.map((cve) => ({
        object_key: cve.cveId.toUpperCase(),
        object_id: cve.cveId,
        object_type: 'vulnerability',
        object_name: cve.cveId,
        object_url: `${tenantBase}/findings/cve/${enc(cve.cveId)}`,
        object_facts: exposureFacts(exposure.get(cve.id)),
      }));
    }
    case 'ASSET': {
      const seen = new Set<string>();
      const out: Array<XtmLookupObject> = [];
      const assets = await reader.assetsByHostnames(keys);
      const exposure = assets.length === 0 ? new Map<string, XtmLookupExposure>() : await reader.exposure('ASSET', [...new Set(assets.map((asset) => asset.id))]);
      for (const asset of assets) {
        // One asset may be reported by several sources under one hostname: answered once.
        if (!asset.hostname || seen.has(`${asset.hostname}|${asset.id}`)) {
          continue;
        }
        seen.add(`${asset.hostname}|${asset.id}`);
        out.push({
          object_key: asset.hostname.toLowerCase(),
          object_id: asset.id,
          object_type: 'asset',
          object_name: asset.name ?? asset.hostname,
          object_url: `${tenantBase}/assets/${enc(asset.id)}`,
          object_facts: exposureFacts(exposure.get(asset.id)),
        });
      }
      return out;
    }
    default:
      return [];
  }
};
