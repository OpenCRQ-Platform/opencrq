import type { ConnectorAssetInput, EventOrigin, JobHandler } from '@app/module';
import { allServiceDefinitions, createServices, NonRetryableError } from '@app/module';
import { fromError, newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { TokenResult } from './graph-auth';
import type { DeviceId, GraphSyncPayload, GraphSyncState } from './graph-types';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { sleep } from '../../utils';
import { createLogger } from '../../utils/logger';
import { acquireToken, isTokenExpired } from './graph-auth';
import {
  buildIdentityQuery,
  droppedIdentityKeys,
  IDENTITY_COUNT_QUERY,
  identityRowSchema,
  LOGON_ACCOUNTS_QUERY,
  LOGON_TOKEN_FLAGS_QUERY,
  logonAccountRowSchema,
  mergeLogonRows,
  nextIdentityCursor,
  STORE_IDENTITY_CHUNK,
  supersededLogonKeys,
  toDirectoryIdentityInputs,
  tokenFlagRowSchema,
  toLogonOnlyIdentityInputs,
} from './graph-identity-sync';
import { countTokenFlagMatches } from './identity-criticality-rules';
import { describePrimaryUserPass, readEntraDevices, readIntuneDevices, resolvePrimaryUsers, retiredPrimaryUsers } from './graph-primary-users';
import { deviceCriticality, parseDeviceRoles, unratedDeviceRoles } from './device-criticality-rules';
import { groupFindingSoftware, mapDefenderOs, mapDeviceCategory, mapDeviceSubcategory, mapExposure } from './graph-mapping-utils';
import {
  chunkRowsByDevice,
  growPageSize,
  HUNTING_ROW_CAP,
  isResultTooLargeResponse,
  isTruncated,
  lastDeviceId,
  MAX_PAGE_DEVICES,
  ResultTooLargeError,
  shrinkPageSize,
} from './graph-paging-utils';
import { deviceIdSchema, optionalText } from './graph-types';

const { logTrace, logTraceFromError } = createLogger({ feature: 'microsoft-graph-sync' });
/** Devices per transaction: a whole page of dense devices is a hundred thousand findings, minutes in one. */
const STORE_DEVICE_CHUNK = 50;
/** Identity rows per hunting page. Far under the row cap: an identity row is a handful of columns, and the reference tenant holds two thousand of them in all. */
const IDENTITY_PAGE_SIZE = 2000;
const DELAY_BETWEEN_PAGES_MS = 200;
const FETCH_TIMEOUT_MS = 60_000;

// Advanced Hunting serializes a null number as an empty object, not as JSON null. Anything else is
// refused, so a type change on the API side fails the row rather than storing a silent null.
const nullableNumber = z.union([z.number(), z.null(), z.strictObject({})]).optional()
  .transform((v) => (typeof v === 'number' ? v : null));
const nullableFlag = z.union([z.boolean(), z.number(), z.null(), z.strictObject({})]).optional()
  .transform((v) => {
    if (typeof v === 'boolean') {
      return v;
    }
    return typeof v === 'number' ? v !== 0 : null;
  });

// Text whatever it arrives as (`OSBuild` is a long, `OsBuildRevision` a string): a display-only
// column must never get a device row refused.
const buildNumberText = z.unknown().optional().transform((v) => (typeof v === 'number' ? String(v) : optionalText.parse(v)));

// Identity attributes are all optional: the query fetches what Defender's own DeviceInfo already
// materialises, at no extra cost, but a row missing one simply carries no value for that tier.
const deviceRowSchema = z.looseObject({
  DeviceId: deviceIdSchema,
  DeviceName: optionalText,
  DeviceCategory: z.string().optional(),
  DeviceType: z.string().optional(),
  DeviceSubtype: optionalText,
  Vendor: optionalText,
  Model: optionalText,
  IsInternetFacing: z.unknown().transform((v) => (typeof v === 'string' ? v : '')),
  AssetValue: z.string().optional(),
  DeviceRoles: z.unknown().optional().transform(parseDeviceRoles),
  FirstSeen: z.string(),
  LastSeen: z.string(),
  HardwareUuid: z.string().nullable().optional(),
  AadDeviceId: z.string().nullable().optional(),
  AzureVmId: z.string().nullable().optional(),
  AzureResourceId: z.string().nullable().optional(),
  AwsResourceName: z.string().nullable().optional(),
  GcpFullResourceName: z.string().nullable().optional(),
  MergedToDeviceId: z.string().nullable().optional(),
  OSPlatform: z.string().nullable().optional(),
  OSDistribution: optionalText,
  OSVersion: optionalText,
  OSVersionInfo: optionalText,
  OSBuild: buildNumberText,
  OsBuildRevision: buildNumberText,
  MacAddresses: z.array(z.string()).nullable().optional(),
  IpAddresses: z.array(z.string()).nullable().optional(),
});
type DeviceRow = z.infer<typeof deviceRowSchema>;

const findingRowSchema = z.looseObject({
  DeviceId: deviceIdSchema,
  CveId: z.string(),
  CvssScore: nullableNumber,
  IsExploitAvailable: nullableFlag,
  VulnerabilitySeverityLevel: z.string().nullable().optional(),
  SoftwareVendor: optionalText,
  SoftwareName: optionalText,
  SoftwareVersion: optionalText,
});
type FindingRow = z.infer<typeof findingRowSchema>;

/**
 * The devices a sync walks: every one in Defender's retention window, with or without a
 * vulnerability. Defender keeps matching newly published CVEs against an offline device's last
 * known software inventory, so a device's check-in date does not bound what Defender now reports
 * about it and must never narrow this set: gating on it skips the devices Defender is still
 * reassessing.
 */
const ALL_DEVICE_IDS = [
  'DeviceInfo',
  '| summarize by DeviceId',
].join('\n');

/**
 * Isolates the page of DeviceIds first (lightweight, only projects DeviceId), so each table scan
 * can be scoped to `in (deviceIds)` rather than materialize a full-table join.
 */
const deviceIdsPreamble = (cursor: DeviceId | null, pageSize: number): Array<string> => {
  const deviceIdFilter = [
    'allDevices',
    ...(cursor ? [`| where strcmp(DeviceId, "${cursor}") > 0`] : []),
    '| order by DeviceId asc',
    `| take ${pageSize}`,
  ];
  return [
    `let allDevices = (${ALL_DEVICE_IDS});`,
    `let deviceIds = (${deviceIdFilter.join('\n')});`,
  ];
};

const buildDeviceQuery = (cursor: DeviceId | null, pageSize: number): string => [
  ...deviceIdsPreamble(cursor, pageSize),
  // MAC/IP addresses are one row per network adapter, sampled continuously: a 30-day make_set
  // accumulates DHCP churn and disappeared adapters, so it is bounded to each device's most recent
  // snapshot instead — an identity, not a 30-day history.
  'let netLatest = (',
  '  DeviceNetworkInfo',
  '  | where DeviceId in (deviceIds)',
  '  | where Timestamp > ago(30d)',
  '  | summarize LastNetworkAt=max(Timestamp) by DeviceId',
  ');',
  'let netSnapshot = (',
  '  DeviceNetworkInfo',
  '  | where DeviceId in (deviceIds)',
  '  | where Timestamp > ago(30d)',
  '  | lookup kind=inner netLatest on DeviceId',
  '  | where Timestamp == LastNetworkAt',
  ');',
  'let networkMacs = (netSnapshot | summarize MacAddresses=make_set(MacAddress) by DeviceId);',
  // IPAddresses is a JSON array of {IPAddress, SubnetPrefix, AddressType}: it has to be expanded
  // to yield addresses rather than one serialized array per adapter. Expanding drops adapters
  // with no address, which is why the MAC set is aggregated on its own branch.
  'let networkIps = (',
  '  netSnapshot',
  '  | mv-expand IpEntry = IPAddresses',
  '  | summarize IpAddresses=make_set(tostring(IpEntry.IPAddress)) by DeviceId',
  ');',
  'let networkInfo = (',
  '  networkMacs',
  '  | join kind=leftouter networkIps on DeviceId',
  '  | project DeviceId, MacAddresses, IpAddresses',
  ');',
  // DeviceInfo interleaves sparse rows, and the latest one can lack the Entra device id a fuller
  // row a moment before carried: the device would lose it, and its primary user, on that sync.
  'let entraDeviceIds = (',
  '  DeviceInfo',
  '  | where DeviceId in (deviceIds)',
  '  | where isnotempty(AadDeviceId)',
  '  | summarize arg_max(Timestamp, AadDeviceId) by DeviceId',
  '  | project DeviceId, LatestAadDeviceId=AadDeviceId',
  ');',
  // The same sparse rows carry the roles: a role the latest row omits is not a role the device lost.
  'let deviceRoles = (',
  '  DeviceInfo',
  '  | where DeviceId in (deviceIds)',
  "  | where tostring(DeviceRoles) !in ('', '{}')",
  '  | summarize arg_max(Timestamp, DeviceRoles) by DeviceId',
  '  | project DeviceId, LatestDeviceRoles=tostring(DeviceRoles)',
  ');',
  'DeviceInfo',
  '| where DeviceId in (deviceIds)',
  '| summarize arg_max(Timestamp, *), FirstSeen=min(Timestamp), LastSeen=max(Timestamp) by DeviceId',
  '| join kind=leftouter networkInfo on DeviceId',
  '| join kind=leftouter entraDeviceIds on DeviceId',
  '| join kind=leftouter deviceRoles on DeviceId',
  '| extend AadDeviceId=iff(isnotempty(LatestAadDeviceId), LatestAadDeviceId, AadDeviceId), DeviceRoles=LatestDeviceRoles',
  '| project DeviceId, DeviceName, DeviceCategory, DeviceType, IsInternetFacing, AssetValue, DeviceRoles, FirstSeen, LastSeen,'
    + ' HardwareUuid, AadDeviceId, AzureVmId, AzureResourceId, AwsResourceName, GcpFullResourceName,'
    + ' MergedToDeviceId, OSPlatform, OSDistribution, OSVersion, OSVersionInfo, OSBuild, OsBuildRevision,'
    + ' MacAddresses, IpAddresses, DeviceSubtype, Vendor, Model',
].join('\n');

/**
 * Scoped to the device ids the device query actually returned, not to a page recomputed from the
 * cursor: a device onboarded between the two calls would otherwise shift the window and leave a
 * device enumerated with none of its findings, which reads as a clean bill of health.
 * `deviceIdSchema` is hex-only, which is what makes the interpolation safe.
 */
const buildFindingQuery = (deviceIds: ReadonlyArray<DeviceId>): string => [
  `let deviceIds = (print DeviceId = dynamic([${deviceIds.map((id) => `"${id}"`).join(',')}]) | mv-expand DeviceId to typeof(string));`,
  'DeviceTvmSoftwareVulnerabilities',
  '| where DeviceId in (deviceIds)',
  // The severity is a property of the CVE, identical on every software row that carries it, so
  // this collapses duplicates rather than picking a winner: no aggregate, nothing to order.
  '| distinct DeviceId, CveId, VulnerabilitySeverityLevel, SoftwareVendor, SoftwareName, SoftwareVersion',
  '| join kind=leftouter (DeviceTvmSoftwareVulnerabilitiesKB | project CveId, CvssScore, IsExploitAvailable) on CveId',
  '| project DeviceId, CveId, VulnerabilitySeverityLevel, SoftwareVendor, SoftwareName, SoftwareVersion, CvssScore, IsExploitAvailable',
].join('\n');

const parseDeviceIds = (ids: ReadonlyArray<string>): Array<DeviceId> => ids.flatMap((id) => {
  const parsed = deviceIdSchema.safeParse(id);
  return parsed.success ? [parsed.data] : [];
});

/** Exact, over the same device set the pages walk: a page is then owed a known number of devices. */
const COUNT_QUERY = [
  ALL_DEVICE_IDS,
  '| count',
].join('\n');

const huntingResultSchema = z.object({
  schema: z.array(z.object({ name: z.string(), type: z.string() })),
  results: z.array(z.record(z.string(), z.unknown())),
});

const executeQuery = async (token: string, query: string, signal: AbortSignal) => {
  const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
  let res: Response;
  try {
    res = await fetch('https://graph.microsoft.com/v1.0/security/runHuntingQuery', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: fetchSignal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw fromError(err, `Graph API fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (res.status === 429) {
    throw newError('Rate limited (429)');
  }
  const body = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new NonRetryableError(`Graph API auth error (${res.status}): ${body.slice(0, 300)}`);
  }
  // Distinct from (and reached before) the 100k-row cap: a 124MB response limit that a page can
  // hit with far fewer rows. Signalled as a dedicated error so the caller can shrink and retry
  // exactly as it would a truncated page, rather than this becoming a non-retryable 4xx below.
  if (isResultTooLargeResponse(res.status, body)) {
    throw new ResultTooLargeError(`Graph API result too large (${res.status}): ${body.slice(0, 300)}`);
  }
  if (res.status >= 400 && res.status < 500) {
    throw new NonRetryableError(`Graph API request error (${res.status}): ${body.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw newError(`Graph API error: ${res.status}: ${body.slice(0, 300)}`);
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw fromError(err, `Graph API returned non-JSON response (status ${res.status}): ${body.slice(0, 300)}`);
  }
  const parsed = huntingResultSchema.safeParse(json);
  if (!parsed.success) {
    throw newError(`Graph API returned invalid response (status ${res.status}): ${body.slice(0, 300)}`);
  }
  return parsed.data;
};

/**
 * Every write is an upsert keyed on the source ids, so a chunk redone after a crash lands on the same rows.
 *
 * The retirement pass commits apart, after the findings: it locks every finding of the chunk's
 * devices, which the transaction holding the upserted ones would take out of the order other
 * connectors' syncs lock them in.
 */
const materializeChunk = async (
  deviceRows: Array<DeviceRow>,
  findingRowsByDeviceId: ReadonlyMap<string, Array<FindingRow>>,
  connectorId: string,
  origin: Extract<EventOrigin, { type: 'connector' }>,
  incompleteDeviceIds: ReadonlySet<string>,
): Promise<{ dismissed: number }> => {
  const stored = await dbEngine.db.transaction(async (tx) => {
    const txServices = createServices([...allServiceDefinitions], tx)
      .withOrigin(origin);
    // Taken before this page's findings are ingested, so that everything it does report compares
    // as fresher than the mark it leaves behind.
    const enumeratedAt = new Date();

    const findingRows = groupFindingSoftware(deviceRows.flatMap((d) => findingRowsByDeviceId.get(d.DeviceId) ?? []));

    // The CVE rows must exist before the findings point at them.
    // Deduplicate by CveId: scores are per-CVE, not per device.
    const cveMap = new Map<string, { cveId: string, cvss: number | null, isExploitAvailable: boolean | null }>();
    for (const row of findingRows) {
      if (!cveMap.has(row.CveId)) {
        cveMap.set(row.CveId, {
          cveId: row.CveId,
          // Defender reports a CvssScore of 0 for a CVE it has not scored.
          cvss: row.CvssScore === 0 ? null : row.CvssScore ?? null,
          isExploitAvailable: row.IsExploitAvailable ?? null,
        });
      }
    }
    await txServices.cve.upsertDefenderReports([...cveMap.values()]);

    // One supporting_asset per device row: the device query already returns at most one row per
    // DeviceId (arg_max by DeviceId), so no dedup is needed here.
    const assetRows: Array<ConnectorAssetInput> = deviceRows.map((row) => {
      const categoryId = mapDeviceCategory(row.DeviceCategory ?? '', row.DeviceType ?? '');
      const reading = deviceCriticality(row.DeviceRoles, row.AssetValue ?? '');
      return {
        name: row.DeviceName ?? null,
        exposure: mapExposure(row.IsInternetFacing ?? ''),
        categoryId,
        subcategoryId: mapDeviceSubcategory(row.DeviceType ?? '', categoryId, row.DeviceSubtype),
        connectorId,
        source: 'microsoft_graph',
        sourceAssetId: row.DeviceId,
        criticality: reading.criticality,
        criticalityRule: reading.rule,
        firstSeenAt: new Date(row.FirstSeen),
        lastSeenAt: new Date(row.LastSeen),
        mergedIntoSourceAssetId: row.MergedToDeviceId ?? null,
        properties: {
          family: 'machine',
          hostname: row.DeviceName ?? null,
          ipAddresses: row.IpAddresses ?? null,
          macAddresses: row.MacAddresses ?? null,
          seenIp: null,
          hardwareUuid: row.HardwareUuid ?? null,
          directoryDeviceId: row.AadDeviceId ?? null,
          cloudVmId: row.AzureVmId ?? null,
          // `||`, not `??`: Advanced Hunting serializes an absent attribute as `""`, and `??` would
          // let an empty AzureResourceId win the cascade over a real AwsResourceName.
          cloudResourceId: row.AzureResourceId || row.AwsResourceName || row.GcpFullResourceName || null,
          platform: row.OSPlatform ?? null,
          vendor: row.Vendor,
          model: row.Model,
          ...mapDefenderOs(row),
          arch: null,
          isEol: null,
          agentExternalReference: null,
          agentExecutorType: null,
        },
      };
    });
    const assetIdMap = await txServices.supportingAssets.bulkUpsertAssets(assetRows);

    // Resolve CVE UUIDs for evidence FK
    const cveIdMap = await txServices.cve.getCveIdMap([...cveMap.keys()]);

    // Per device, not per CVE: Defender's last contact with the machine, not this finding's own
    // observation time.
    const lastSeenByDeviceId = new Map(deviceRows.map((row) => [row.DeviceId, new Date(row.LastSeen)]));

    // Upsert one asset_evidence per DeviceId×CveId pair (bulkUpsertEvidence dedupes rows
    // that target the same DB row, e.g. two merged devices reporting the same CVE).
    const evidenceRows = findingRows
      .filter((row) => cveIdMap.has(row.CveId) && assetIdMap.has(row.DeviceId))
      .map((row) => ({
        id: uuidv7(),
        supportingAssetId: assetIdMap.get(row.DeviceId)!,
        cveId: cveIdMap.get(row.CveId)!,
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        connectorId,
        // Keyed on the canonical asset, not the raw device id: a merged device must resolve onto
        // the same provenance row as the survivor it merged into, never a second one beside it.
        sourceFindingId: `${assetIdMap.get(row.DeviceId)!}:${row.CveId}`,
        // Defender's own device id, the only one its pages answer to; of two merged devices the
        // row kept by the upsert's dedupe decides, and either one resolves.
        externalReference: row.DeviceId,
        reportedSeverity: row.VulnerabilitySeverityLevel ?? null,
        software: row.software,
        reason: 'Reported by Microsoft Defender',
        evaluatedAt: lastSeenByDeviceId.get(row.DeviceId)!,
      }));
    await txServices.supportingAssets.bulkUpsertEvidence(evidenceRows);

    // The page carries each device's vulnerabilities whole, so a CVE Defender fixed is the one missing.
    // A device carrying a row validation rejected is left out: its missing CVEs are a drop, not a fix.
    // So is a device merged into another: it resolves onto the survivor's asset, whose CVEs it lists
    // only in part, and the survivor's own row reconciles that asset wherever it is processed.
    // Read off the chunk's rows, not the map's keys: the map also holds the survivor's id for a
    // merged row. Two rows can resolve onto one asset, hence the set.
    const reconciledAssetIds = [...new Set(deviceRows.flatMap((row) => {
      const assetId = assetIdMap.get(row.DeviceId);
      const merged = Boolean(row.MergedToDeviceId) && row.MergedToDeviceId !== row.DeviceId;
      return assetId === undefined || merged || incompleteDeviceIds.has(row.DeviceId) ? [] : [assetId];
    }))];
    return { reconciledAssetIds, enumeratedAt };
  });

  return dbEngine.db.transaction(async (tx) => {
    const txServices = createServices([...allServiceDefinitions], tx)
      .withOrigin(origin);
    await txServices.supportingAssets.markAssetsEnumerated({
      connectorId,
      supportingAssetIds: stored.reconciledAssetIds,
      scope: '',
      enumeratedAt: stored.enumeratedAt,
    });
    const dismissed = await txServices.supportingAssets.recomputeEvidenceStateForAssets({
      supportingAssetIds: stored.reconciledAssetIds,
      reason: 'No longer reported by Microsoft Defender',
    });
    return { dismissed };
  });
};

/**
 * One transaction per chunk of identities, on the same upsert-keyed reasoning as the device pass:
 * a chunk redone after a crash lands on the same rows.
 *
 * `markAssetsEnumerated` is deliberately absent: it drives the evidence reconciliation, and an
 * identity carries no evidence. Nothing retires an identity the directory stops returning, exactly as
 * nothing retires a device; its `lastSeenAt` stops moving instead. Only two kinds of observation are
 * deleted: the SID-keyed one a directory record replaced (`retireSupersededSources`) and that of a
 * disabled account carrying no identifying data (`retireConnectorSources`).
 */
const materializeIdentityChunk = async (
  assetRows: Array<ConnectorAssetInput>,
  origin: Extract<EventOrigin, { type: 'connector' }>,
): Promise<number> =>
  dbEngine.db.transaction(async (tx) => {
    const txServices = createServices([...allServiceDefinitions], tx).withOrigin(origin);
    const assetIdMap = await txServices.supportingAssets.bulkUpsertAssets(assetRows);
    return assetIdMap.size;
  });

export const graphSyncHandler: JobHandler<GraphSyncPayload, GraphSyncState> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }

  const graphConfig = config().connectors?.microsoft_graph?.[ctx.tenantId];
  if (!graphConfig) {
    throw new NonRetryableError('microsoft_graph config is missing for this tenant');
  }

  const origin = { type: 'connector' as const, serviceAccountId: ctx.payload.serviceAccountId, tenantId: ctx.tenantId, job: { jobKind: ctx.kind, interactive: ctx.interactive } };
  const services = createServices([...allServiceDefinitions], dbEngine.db)
    .withOrigin(origin);

  const syncStartedAt = ctx.state?.syncStartedAt
    ? new Date(ctx.state.syncStartedAt)
    : new Date();

  const connectorId = await services.integrationSettings.getConnectorId('microsoft_graph');
  if (!connectorId) {
    throw new NonRetryableError('integration_settings row for microsoft_graph not found, was the integration configured?');
  }
  logTrace(`Connector resolved: ${connectorId}`);

  // Resume cursor from state snapshot (job retry): re-validate since state is deserialized from JSON.
  let cursor: DeviceId | null = ctx.state?.cursor
    ? deviceIdSchema.parse(ctx.state.cursor)
    : null;
  let pageIndex = ctx.state?.pageIndex ?? 0;
  let devicesProcessed = ctx.state?.devicesProcessed ?? 0;
  let findingsDismissed = ctx.state?.findingsDismissed ?? 0;
  let pageSize = ctx.state?.pageSize ?? MAX_PAGE_DEVICES;

  await ctx.updateProgress({ message: 'Acquiring an access token from Microsoft Entra' });
  let token: TokenResult = await acquireToken(
    graphConfig.azure_tenant_id, graphConfig.client_id, graphConfig.client_secret,
  );
  logTrace(`OAuth token acquired, expires ${new Date(token.expiresAt).toISOString()}`);

  await ctx.updateProgress({ message: 'Counting the assets to sync' });
  const countResult = await executeQuery(token.accessToken, COUNT_QUERY, ctx.signal);
  const counted = countResult.results[0]?.Count;
  const devicesToSync = typeof counted === 'number' ? counted : null;
  const identityCountResult = await executeQuery(token.accessToken, IDENTITY_COUNT_QUERY, ctx.signal);
  const countedIdentities = identityCountResult.results[0]?.Count;
  const identitiesToSync = typeof countedIdentities === 'number' ? countedIdentities : null;
  // Both counts up front, though the identities are read last: a denominator that grew mid-run
  // would move the bar backwards on a screen someone is watching.
  const assetsToSync = devicesToSync === null || identitiesToSync === null
    ? null
    : devicesToSync + identitiesToSync;
  // Every directory record read, stored or skipped: the identity count above includes the skipped ones.
  let identitiesProcessed = 0;
  let identitiesStored = 0;
  await ctx.updateProgress({ processedTotal: devicesProcessed, expectedTotal: assetsToSync });

  logTrace(assetsToSync === null
    ? 'Starting sync: asset count unavailable'
    : `Starting sync: ${devicesToSync} devices and ${identitiesToSync} identities to sync, ${devicesProcessed} devices already processed`);

  // Devices the previous, shorter ask returned when the page still came up short of what it was owed.
  let shortRetryDevices: number | null = null;

  while (!ctx.signal.aborted) {
    if (isTokenExpired(token)) {
      logTrace('Refreshing OAuth token (long-running sync)');
      token = await acquireToken(
        graphConfig.azure_tenant_id, graphConfig.client_id, graphConfig.client_secret,
      );
    }

    const pageNumber = pageIndex + 1;
    const after = cursor === null ? '' : ` (devices after ${cursor.slice(0, 8)}…)`;
    await ctx.updateProgress({ message: `Fetching page ${pageNumber} from Microsoft Graph${after}`, processedTotal: devicesProcessed + identitiesProcessed });
    logTrace(`Page ${pageNumber} requested${after}, ${pageSize} devices`);

    let rawDeviceRows: Array<Record<string, unknown>>;
    let rawFindingRows: Array<Record<string, unknown>>;
    let receivedDeviceIds: Array<string>;
    try {
      rawDeviceRows = (await executeQuery(token.accessToken, buildDeviceQuery(cursor, pageSize), ctx.signal)).results;

      if (rawDeviceRows.length === 0) {
        logTrace(`Page ${pageNumber} received: empty, the sync is complete`);
        break;
      }

      // Pagination is by device count (take pageSize devices before join), so the devices received,
      // valid rows or not, are what was processed and how a last page is told apart.
      receivedDeviceIds = [...new Set(rawDeviceRows.map((row) => String(row.DeviceId)))];
      rawFindingRows = (await executeQuery(token.accessToken, buildFindingQuery(parseDeviceIds(receivedDeviceIds)), ctx.signal)).results;
    } catch (err) {
      if (!(err instanceof ResultTooLargeError)) {
        throw err;
      }
      if (pageSize === 1) {
        throw new NonRetryableError(`Page ${pageNumber}: a single device's result exceeds the Advanced Hunting API's response size limit`);
      }
      const smaller = shrinkPageSize(pageSize);
      logTrace(`Page ${pageNumber} refused: response size limit exceeded; asking again for ${smaller} devices instead of ${pageSize}`);
      pageSize = smaller;
      await sleep(DELAY_BETWEEN_PAGES_MS, ctx.signal);
      continue;
    }

    // Pagination is by device count (take pageSize devices before join), so the devices received,
    // valid rows or not, are what was processed and how a last page is told apart.
    const receivedDevices = receivedDeviceIds.length;
    // Two signs of a truncated answer: the finding-row cap, and fewer devices than the page is
    // owed, which catches a cap the row count alone would not (a single device cannot come up
    // short). A shorter ask that returns the same devices clears the second sign: the count has
    // drifted, not the page.
    const owedDevices = devicesToSync === null ? null : Math.min(pageSize, devicesToSync - devicesProcessed);
    const shortOfDevices = owedDevices !== null && receivedDevices < owedDevices && pageSize > 1
      && receivedDevices !== shortRetryDevices;
    if (isTruncated(rawFindingRows.length) || shortOfDevices) {
      if (pageSize === 1) {
        throw new NonRetryableError(`Page ${pageNumber}: a single device exceeds the ${HUNTING_ROW_CAP}-row cap of the Advanced Hunting API`);
      }
      const smaller = shrinkPageSize(pageSize);
      logTrace(`Page ${pageNumber} received truncated: ${rawFindingRows.length} finding rows, ${receivedDevices} of ${owedDevices ?? pageSize} devices; asking again for ${smaller} devices instead of ${pageSize}`);
      pageSize = smaller;
      shortRetryDevices = isTruncated(rawFindingRows.length) ? null : receivedDevices;
      await sleep(DELAY_BETWEEN_PAGES_MS, ctx.signal);
      continue;
    }
    shortRetryDevices = null;

    const parsedDeviceRows = rawDeviceRows.map((r) => deviceRowSchema.safeParse(r));
    const validDeviceRows = parsedDeviceRows.filter((r) => r.success).map((r) => r.data);
    const parsedFindingRows = rawFindingRows.map((r) => findingRowSchema.safeParse(r));
    const validFindingRows = parsedFindingRows.filter((r) => r.success).map((r) => r.data);

    const firstRejection = parsedDeviceRows.find((r) => !r.success)?.error.issues[0]
      ?? parsedFindingRows.find((r) => !r.success)?.error.issues[0];
    // A device is incomplete when its own row, or at least one of its finding rows, failed
    // validation: its missing CVEs are a drop, not a fix, so it is excluded from reconciliation below.
    const incompleteDeviceIds = new Set([
      ...parsedDeviceRows.flatMap((parsed, index) => (parsed.success ? [] : [String(rawDeviceRows[index]?.DeviceId)])),
      ...parsedFindingRows.flatMap((parsed, index) => (parsed.success ? [] : [String(rawFindingRows[index]?.DeviceId)])),
    ]);

    const droppedDeviceCount = rawDeviceRows.length - validDeviceRows.length;
    const droppedFindingCount = rawFindingRows.length - validFindingRows.length;
    const rejection = firstRejection ? ` (first: ${firstRejection.path.join('.')} ${firstRejection.message})` : '';
    logTrace(`Page ${pageNumber} received: ${receivedDevices} devices, ${rawFindingRows.length} finding rows, `
      + `${droppedDeviceCount} device rows and ${droppedFindingCount} finding rows dropped by validation${rejection}`);

    if (validDeviceRows.length === 0) {
      throw new NonRetryableError(`Page ${pageNumber}: all ${rawDeviceRows.length} device rows failed validation, possible API schema change`);
    }
    const unratedRoles = unratedDeviceRoles(validDeviceRows.flatMap((row) => row.DeviceRoles));
    if (unratedRoles.length > 0) {
      logTrace(`Page ${pageNumber}: device roles no rule rates: ${unratedRoles.join(', ')}`);
    }

    const findingRowsByDeviceId = new Map<string, Array<FindingRow>>();
    for (const row of validFindingRows) {
      const bucket = findingRowsByDeviceId.get(row.DeviceId);
      if (bucket) {
        bucket.push(row);
      } else {
        findingRowsByDeviceId.set(row.DeviceId, [row]);
      }
    }

    const findingCount = groupFindingSoftware(validFindingRows).length;
    let storedDevices = 0;
    let dismissedInPage = 0;
    for (const chunk of chunkRowsByDevice(validDeviceRows, (row) => row.DeviceId, STORE_DEVICE_CHUNK)) {
      if (ctx.signal.aborted) {
        return;
      }
      // One write per chunk: each `jobs` write rings the change doorbell in every open browser.
      await ctx.updateProgress({
        message: `Storing page ${pageNumber}: ${storedDevices} of ${receivedDevices} devices, ${findingCount} findings, ${dismissedInPage} dismissed`,
        processedTotal: devicesProcessed + storedDevices + identitiesProcessed,
      });
      const { dismissed } = await materializeChunk(chunk.rows, findingRowsByDeviceId, connectorId, origin, incompleteDeviceIds);
      storedDevices += chunk.deviceCount;
      dismissedInPage += dismissed;
    }

    cursor = lastDeviceId(parseDeviceIds(receivedDeviceIds));
    pageIndex += 1;
    devicesProcessed += receivedDevices;
    findingsDismissed += dismissedInPage;
    logTrace(`Page ${pageNumber} stored: ${receivedDevices} devices, ${findingCount} findings, ${dismissedInPage} findings dismissed as no longer reported (${devicesProcessed} / ${devicesToSync ?? '?'} devices)`);

    const lastPage = receivedDevices < pageSize;
    pageSize = growPageSize(pageSize, rawFindingRows.length);
    await ctx.saveStateSnapshot({ pageIndex, cursor, devicesProcessed, findingsDismissed, pageSize, syncStartedAt: syncStartedAt.toISOString() });

    if (lastPage) {
      break;
    }

    await sleep(DELAY_BETWEEN_PAGES_MS, ctx.signal);
  }

  // The identities, after the devices and on their own keys. They are a separate table with a
  // separate cardinality — thousands of accounts against hundreds of machines — so they page on
  // their own cursor rather than riding the device pages.
  if (!ctx.signal.aborted) {
    if (isTokenExpired(token)) {
      token = await acquireToken(graphConfig.azure_tenant_id, graphConfig.client_id, graphConfig.client_secret);
    }

    await ctx.updateProgress({ message: 'Fetching the accounts seen in logon events' });
    const rawLogonRows: Array<Record<string, unknown>> = (await executeQuery(token.accessToken, LOGON_ACCOUNTS_QUERY, ctx.signal)).results;
    const logonAccounts = rawLogonRows
      .map((row) => logonAccountRowSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    const rawTokenFlagRows: Array<Record<string, unknown>> = (await executeQuery(token.accessToken, LOGON_TOKEN_FLAGS_QUERY, ctx.signal)).results;
    const tokenFlagRows = rawTokenFlagRows
      .map((row) => tokenFlagRowSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    const logonsBySid = mergeLogonRows(logonAccounts, tokenFlagRows);
    const logonRows = [...logonsBySid.values()];

    const tokenFlagCounts = countTokenFlagMatches(logonRows.flatMap((row) => row.TokenFlags));
    // A run that sees token flags and rates none of them is the vendor having renamed them, which
    // nothing else would surface.
    logTrace(tokenFlagCounts.seen === 0
      ? `Logon events: ${logonRows.length} accounts, no token context flag present`
      : `Logon events: ${logonRows.length} accounts, ${tokenFlagCounts.rated} of ${tokenFlagCounts.seen} token flags rated by the catalogue`);

    let identityCursor: string | null = null;
    let skippedAccounts = 0;
    let removedAssets = 0;
    const knownSids = new Set<string>();

    while (!ctx.signal.aborted) {
      const rawIdentityRows: Array<Record<string, unknown>> = (await executeQuery(
        token.accessToken, buildIdentityQuery(identityCursor, IDENTITY_PAGE_SIZE), ctx.signal,
      )).results;
      if (rawIdentityRows.length === 0) {
        break;
      }
      const identityRows = rawIdentityRows
        .map((row) => identityRowSchema.safeParse(row))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
      const droppedIdentities = rawIdentityRows.length - identityRows.length;
      if (identityRows.length === 0) {
        throw new NonRetryableError(`All ${rawIdentityRows.length} identity rows failed validation, possible API schema change`);
      }
      for (const row of identityRows) {
        for (const sid of [row.CloudSid, row.OnPremSid]) {
          if (sid !== null) {
            knownSids.add(sid.toUpperCase());
          }
        }
      }

      const assetRows = toDirectoryIdentityInputs(identityRows, logonsBySid, connectorId);
      for (let i = 0; i < assetRows.length; i += STORE_IDENTITY_CHUNK) {
        if (ctx.signal.aborted) {
          return;
        }
        await ctx.updateProgress({
          message: `Storing identities: ${identitiesProcessed} of ${identitiesToSync ?? '?'}`,
          processedTotal: devicesProcessed + identitiesProcessed,
        });
        identitiesStored += await materializeIdentityChunk(assetRows.slice(i, i + STORE_IDENTITY_CHUNK), origin);
      }
      identitiesProcessed += rawIdentityRows.length;
      // After the replacement is on file, never before: the SID-keyed observation is what the
      // matcher reads to find the asset the directory record belongs to.
      await services.supportingAssets.retireSupersededSources({
        connectorId,
        sourceAssetIds: supersededLogonKeys(identityRows),
      });
      const droppedKeys = droppedIdentityKeys(identityRows);
      if (droppedKeys.length > 0) {
        const retired = await services.supportingAssets.retireConnectorSources({ connectorId, sourceAssetIds: droppedKeys });
        skippedAccounts += droppedKeys.length;
        removedAssets += retired.assets;
      }

      logTrace(`Identities: ${identityRows.length} directory records stored, ${droppedIdentities} dropped by validation`);
      identityCursor = nextIdentityCursor(rawIdentityRows);
      if (rawIdentityRows.length < IDENTITY_PAGE_SIZE || identityCursor === null) {
        break;
      }
      await sleep(DELAY_BETWEEN_PAGES_MS, ctx.signal);
    }

    // Last, so `knownSids` holds every SID the directory covered: an account the directory returned
    // must never also be created from its logon SID.
    if (!ctx.signal.aborted) {
      const logonOnlyRows = toLogonOnlyIdentityInputs(logonRows, knownSids, connectorId);
      for (let i = 0; i < logonOnlyRows.length; i += STORE_IDENTITY_CHUNK) {
        if (ctx.signal.aborted) {
          return;
        }
        await materializeIdentityChunk(logonOnlyRows.slice(i, i + STORE_IDENTITY_CHUNK), origin);
      }
      logTrace(`Identities: ${identitiesStored} from the directory, ${logonOnlyRows.length} known only from a logon SID`);
      logTrace(`${skippedAccounts} disabled accounts with no identifying data skipped, ${removedAssets} assets removed`);
    }
  }

  // After both the devices and the identities: a primary user joins one to the other.
  let primaryUserPass = '';
  if (!ctx.signal.aborted) {
    const observedAt = new Date();
    if (isTokenExpired(token)) {
      token = await acquireToken(graphConfig.azure_tenant_id, graphConfig.client_id, graphConfig.client_secret);
    }
    await ctx.updateProgress({ message: 'Reading the primary users of the devices from Microsoft Entra ID and Intune' });
    const [entra, intune] = await Promise.all([
      readEntraDevices(token.accessToken, ctx.signal),
      readIntuneDevices(token.accessToken, ctx.signal),
    ]);
    for (const [name, read] of [['Microsoft Entra ID', entra], ['Intune', intune]] as const) {
      if (read.status === 'unavailable' && read.error !== undefined) {
        logTraceFromError(read.error, `Primary users: ${name} unavailable (${read.reason})`);
      }
    }
    const [endpoints, held] = await Promise.all([
      services.supportingAssets.getConnectorRelationEndpoints(connectorId),
      services.supportingAssets.listConnectorRelations({ connectorId, kind: 'primary_user_of' }),
    ]);
    const primaryUsers = resolvePrimaryUsers({
      ...endpoints,
      entraDevices: entra.status === 'answered' ? entra.items : null,
      intuneDevices: intune.status === 'answered' ? intune.items : null,
      held,
    });
    const { written, removed } = await services.supportingAssets.reconcileConnectorRelations({
      connectorId,
      kind: 'primary_user_of',
      observedAt,
      relations: primaryUsers.map((user) => ({ fromAssetId: user.identityAssetId, toAssetId: user.deviceAssetId, source: user.source })),
      retiredIds: retiredPrimaryUsers({
        held,
        observed: primaryUsers,
        answeredSources: [
          ...(entra.status === 'answered' ? ['entra_registered_owner' as const] : []),
          ...(intune.status === 'answered' ? ['intune_primary_user' as const] : []),
        ],
      }),
    });
    primaryUserPass = describePrimaryUserPass(written, entra, intune);
    logTrace(`Primary users: ${primaryUserPass}, ${removed} no longer reported removed`);
  }

  if (!ctx.signal.aborted) {
    await ctx.updateProgress({
      message: `Recording the sync completion (${findingsDismissed} findings dismissed as no longer reported, ${primaryUserPass})`,
      processedTotal: devicesProcessed + identitiesProcessed,
    });
    // The run stamp the connector page shows. No query is scoped by it: a sync walks every device
    // whatever it says.
    await services.integrationSettings.markSynced('microsoft_graph', syncStartedAt);
    logTrace(`Sync complete: ${devicesProcessed} devices over ${pageIndex} pages, ${identitiesStored} identities, ${findingsDismissed} findings dismissed as no longer reported`);
  }
};
