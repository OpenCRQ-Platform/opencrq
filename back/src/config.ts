import { newError } from '@app/utils';
import nconf from 'nconf';
import * as path from 'node:path';
import { merge } from 'ts-deepmerge';
import type { z } from 'zod';
import { configSchema } from './config-schema';

const currentPath = process.env.INIT_CWD || process.cwd();
const resolveEnvFile = (file: string) => path.join(currentPath, 'config', `${file}.json`);

nconf
  // 1. Load environment variables
  .env({
    separator: '__',
    lowerCase: true,
    parseValues: true,
  })
  // 2. Load command-line arguments
  .argv();

// 3. else from the environment configuration file. Environment is determined with similar priority ordering (env var then command line arg)
const environment = nconf.get('env') || process.env.NODE_ENV || 'production';
if (environment !== 'production') {
  nconf.file(`${environment}.local`, resolveEnvFile(`${environment}.local`));
  nconf.file(environment, resolveEnvFile(environment));
}

// 4. at least resort from the default configuration file
nconf.file('default', resolveEnvFile('default'));

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- raw nconf output is untyped by construction
const rawRootConfig = nconf.get() as Record<string, unknown>;

export const pmConfig = {
  inDev: environment === 'development',
  ...configSchema.parse(rawRootConfig),
};

export const getProcessName = () => process.env.PROCESS_NAME || 'pm';

declare global {
  /** Defined by `buildModeOptions` at build time and undeclared anywhere unbundled, tests included: read it through `typeof`. */
  const __DEVELOPMENT_BUILD__: boolean;
}

// ts-deepmerge's `merge` signature constrains inputs to `{ [key: string]: any }`
// and erases the precise types coming out of `configSchema.parse`. Rather than
// cast the merged result, we re-parse it through a `configSchema` minus the
// `process_manager` key — Zod produces a precisely-inferred type AND validates
// the merged shape (including coercions). `inDev` lives outside the schema so
// it's re-injected after parse.
const appConfigSchema = configSchema.omit({ process_manager: true });
type AppConfig = z.infer<typeof appConfigSchema> & { inDev: boolean };

const getConfig = (): AppConfig => {
  const processName = process.env.PROCESS_NAME;

  if (!processName) {
    throw newError('Config can only be called inside a process');
  }

  const { process_manager: _processes, inDev, ...globalConfig } = pmConfig;

  const processProfileConfig = pmConfig.process_manager[pmConfig.process_manager.profile];
  const processConfig = processProfileConfig[processName];

  if (!processConfig) {
    throw newError('Missing process config entry', { processName });
  }

  const merged = merge(globalConfig, processConfig);
  const parsed = appConfigSchema.parse(merged);

  return { inDev, ...parsed };
};

let cachedConfig: ReturnType<typeof getConfig>;

export const config = () => {
  if (!cachedConfig) {
    cachedConfig = getConfig();
  }
  return cachedConfig;
};
