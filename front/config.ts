import nconf from 'nconf';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendConfigDir = resolve(__dirname, '../back/config');
const resolveConfigFile = (file: string) => resolve(backendConfigDir, `${file}.json`);

const provider = new nconf.Provider();

// Mirror the backend's nconf loading order (development.local overrides development)
provider.file('development.local', resolveConfigFile('development.local'));
provider.file('development', resolveConfigFile('development'));

const backendConfigSchema = z.object({
  http_server: z
    .object({
      port: z.coerce.number().default(3002),
    }),
  dev_server: z
    .object({
      port: z.coerce.number().default(3000),
    })
    .default({ port: 3000 }),
});

export const backendConfig = backendConfigSchema.parse(provider.get());
