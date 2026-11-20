import type { SeedDefaultThreatsLoad } from '@app/module';
import { NonRetryableError, OUTCOME_COUNTER_VERSION, parseDefaultThreatsDataset } from '@app/module';
import { newError } from '@app/utils';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { imageVersion } from '../../utils/platform-version';
import { defaultThreatsFileUrl } from '../app-router/connectors/connector-configuration';

const { logTrace } = createLogger({ feature: 'default-threats' });

export const FETCH_TIMEOUT_MS = 60_000;

/**
 * Only a built image carries APP_VERSION, and a checkout upgraded in place changes the outcome model
 * without it: the model version keeps such an upgrade from reading as an unchanged load.
 */
export const loadStamp = (): string => `${imageVersion() ?? 'unversioned'}+counter-${OUTCOME_COUNTER_VERSION}`;

export const datasetUrl = (): string => {
  const url = defaultThreatsFileUrl(config().connectors);
  if (url === null) {
    throw new NonRetryableError('No Default Threats dataset URL is configured for this platform');
  }
  return url;
};

export const parseDatasetBody = (body: string) => {
  try {
    return parseDefaultThreatsDataset(JSON.parse(body));
  } catch (error) {
    throw new NonRetryableError('The Default Threats dataset is not a STIX bundle this release can read', { cause: error });
  }
};

/**
 * The platform seed's load of the priced tenant, before it prices the anchors: the file read whole and
 * recorded under the sync's own stamp, so the first boot's sync finds it loaded and asks only for a
 * change. A tenant switched off loads nothing. Kept apart from the sync handler, which reads the
 * database engine: the database engine runs the seed and passes this load to it.
 */
export const seedDefaultThreatsLoad: SeedDefaultThreatsLoad = async (services, tenantId) => {
  if (!(await services.defaultThreats.getSettings(tenantId)).enabled) {
    return;
  }
  const res = await fetch(datasetUrl(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw newError(`Default Threats dataset error: ${res.status} ${res.statusText}`);
  }
  const dataset = parseDatasetBody(await res.text());
  const loaded = await services.defaultThreats.loadDataset(dataset, {
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    appVersion: loadStamp(),
  });
  logTrace('Default Threats dataset loaded by the platform seed', { ...loaded, ignoredTechniqueClaims: dataset.ignoredTechniqueClaims });
};
