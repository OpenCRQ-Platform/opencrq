export interface ExternalFindingLinks {
  scenario?: string,
  simulation?: string,
  inject?: string,
  finding?: string,
}

export interface LinkableFinding {
  connectorSource: string | null,
  sourceScenarioId?: string | null,
  sourceSimulationId: string | null,
  sourceInjectId: string | null,
  /** Our own provenance key, never an id a connector's pages answer to; Defender reads the CVE after its last ':'. */
  sourceFindingId: string | null,
  /** The connector's own id: OpenAEV's finding id, Defender's device id. Absent until the source is resynchronised. */
  externalReference?: string | null,
  openaevUrl?: string | null,
}

const MICROSOFT_DEFENDER_BASE_URL = 'https://security.microsoft.com';

/**
 * A source row survives its connector's deletion with `connectorId` nulled (the FK is
 * `onDelete: 'set null'`), so counting sources alone would offer to hand a finding back to
 * automation no connector can actually refresh. Only a source with a live connector counts.
 */
export const hasLiveConnectorSource = (sources: ReadonlyArray<{ connectorId: string | null }>): boolean =>
  sources.some((s) => s.connectorId !== null);

/** Resync hands hand-set fields back to automation: it needs both a field to hand back and a live connector to take it. */
export const canResyncWithConnectors = (manualFieldCount: number, sources: ReadonlyArray<{ connectorId: string | null }>): boolean =>
  manualFieldCount > 0 && hasLiveConnectorSource(sources);

const buildOpenAevLinks = (finding: LinkableFinding): ExternalFindingLinks => {
  const baseUrl = finding.openaevUrl?.trim();
  if (!baseUrl) {
    return {};
  }

  const buildUrl = (path: string): string | null => {
    try {
      return new URL(path, baseUrl).toString();
    } catch {
      return null;
    }
  };

  const links: ExternalFindingLinks = {};

  if (finding.sourceScenarioId) {
    const scenarioLink = buildUrl(`/admin/scenarios/${finding.sourceScenarioId}`);
    if (scenarioLink) {
      links.scenario = scenarioLink;
    }
  }

  if (finding.sourceSimulationId) {
    const simulationLink = buildUrl(`/admin/simulations/${finding.sourceSimulationId}`);
    if (simulationLink) {
      links.simulation = simulationLink;
    }
  }

  if (finding.sourceInjectId && finding.sourceSimulationId) {
    const injectLink = buildUrl(`/admin/simulations/${finding.sourceSimulationId}/injects/${finding.sourceInjectId}`);
    if (injectLink) {
      links.inject = injectLink;
    }
  }

  // Our own provenance key is stable across replays and means nothing to OpenAEV; only the id it
  // issued itself resolves, and expectation rows never get one since they have no finding page.
  if (finding.externalReference) {
    const findingLink = buildUrl(`/admin/findings/${finding.externalReference}`);
    if (findingLink) {
      links.finding = findingLink;
    }
  }

  return links;
};

const buildMicrosoftGraphLinks = (finding: LinkableFinding): ExternalFindingLinks => {
  const deviceId = finding.externalReference;
  const key = finding.sourceFindingId ?? '';
  // The key is "{supportingAssetId}:{cveId}", so only what follows the last ':' is Defender's.
  const separatorIndex = key.lastIndexOf(':');
  const cveId = separatorIndex === -1 ? '' : key.slice(separatorIndex + 1);
  if (!deviceId || !cveId) {
    return {};
  }

  // Best-effort deep link to Microsoft Defender vulnerability view.
  const url = new URL('/vulnerabilities', MICROSOFT_DEFENDER_BASE_URL);
  url.searchParams.set('cveId', cveId);
  url.searchParams.set('deviceId', deviceId);

  return { finding: url.toString() };
};

/**
 * Deep links into the product that reported a finding, from what its source row carries.
 *
 * - `openaev` reads the scenario, simulation and inject ids and `externalReference` (the finding id).
 * - `microsoft_graph` reads `externalReference` as the Defender device id and the CVE after the last
 *   ':' of `sourceFindingId`; it builds nothing when either is missing, since a source not yet
 *   resynchronised has no device id and a link built from the canonical key would be a wrong one.
 * - any other connector builds nothing.
 */
export const buildLinks = (finding: LinkableFinding): ExternalFindingLinks => {
  if (finding.connectorSource === 'openaev') {
    return buildOpenAevLinks(finding);
  }

  if (finding.connectorSource === 'microsoft_graph') {
    return buildMicrosoftGraphLinks(finding);
  }

  return {};
};

// OpenCTI only resolves ids it could have generated: `<type>--<uuid>`. Fabricated ids such as the
// platform seed's `intrusion-set--seed-salt-typhoon` are rejected here rather than at each caller.
const RESOLVABLE_STIX_ID = /^[a-z][a-z0-9-]*--[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Deep link to a STIX object on the tenant's OpenCTI platform, through the universal id route.
 *
 * Returns null when the platform is not configured or the id is not one OpenCTI can resolve, which
 * is what the callers render on: no link rather than a dead one.
 */
export const buildOpenCtiObjectLink = (baseUrl: string | null | undefined, stixId: string | null): string | null => {
  const trimmed = baseUrl?.trim();
  if (!trimmed || !stixId || !RESOLVABLE_STIX_ID.test(stixId)) {
    return null;
  }
  try {
    const platform = new URL(trimmed);
    // Appended to the platform's own path, never resolved from the root: an OpenCTI served under a
    // base path (`app:base_path`) would otherwise lose that prefix and the link would 404.
    platform.pathname = `${platform.pathname.replace(/\/$/, '')}/dashboard/id/${stixId}`;
    return platform.toString();
  } catch {
    return null;
  }
};
