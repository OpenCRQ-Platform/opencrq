import type { Plugin } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS_DIR } from './cleanup-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AssetsPlugin: Plugin = {
  name: 'assets',
  setup(build) {
    const { outdir } = build.initialOptions;
    if (outdir) {
      const copyAssets = () => {
        // 1. Migrations
        const migrationsSrc = path.resolve(__dirname, '../../module/src/db/migrations');
        const migrationsDest = path.join(outdir, 'migrations');

        if (fs.existsSync(migrationsSrc)) {
          fs.cpSync(migrationsSrc, migrationsDest, { recursive: true });
          console.log('Migrations copied');
        } else {
          console.warn('Migrations folder not found at:', migrationsSrc);
        }

        // 2. Outcome counter model, read at runtime from `dist/outcome-counter-model`
        const counterModelSrc = path.resolve(__dirname, '../../module/src/modules/threat-analyses/outcome-counter/outcome-counter-model');
        const counterModelDest = path.join(outdir, 'outcome-counter-model');

        if (fs.existsSync(counterModelSrc)) {
          fs.cpSync(counterModelSrc, counterModelDest, { recursive: true });
          console.log('Outcome counter model copied');
        } else {
          console.warn('Outcome counter model folder not found at:', counterModelSrc);
        }

        // 3. Config
        const configSrc = path.resolve(__dirname, '../config');
        const configDest = path.join(outdir, 'config');

        if (fs.existsSync(configSrc)) {
          fs.cpSync(configSrc, configDest, { recursive: true });
          console.log('Config copied');
        } else {
          console.warn('Config folder not found at:', configSrc);
        }

        // 3. Map files
        const mapsSrc = path.resolve(__dirname, '../static/maps');
        const mapsDest = path.join(outdir, MAPS_DIR);

        if (fs.existsSync(mapsSrc)) {
          // The tiles weigh 15 MB: a watch rebuild copies only a file whose size or date changed.
          // Only the served files go: every file of the folder becomes a route.
          const served = fs.readdirSync(mapsSrc).filter((name) => /\.(pmtiles|json)$/.test(name));
          fs.mkdirSync(mapsDest, { recursive: true });
          for (const name of fs.readdirSync(mapsDest).filter((existing) => !served.includes(existing))) {
            fs.rmSync(path.join(mapsDest, name), { recursive: true, force: true });
          }
          for (const name of served) {
            const source = path.join(mapsSrc, name);
            const target = path.join(mapsDest, name);
            const sourceStat = fs.statSync(source);
            const targetStat = fs.existsSync(target) ? fs.statSync(target) : null;
            if (!targetStat || targetStat.size !== sourceStat.size || targetStat.mtimeMs !== sourceStat.mtimeMs) {
              fs.cpSync(source, target, { preserveTimestamps: true });
              console.log(`Map file copied: ${name}`);
            }
          }
        } else {
          console.warn('Map files folder not found at:', mapsSrc);
        }
      };

      build.onEnd((result) => {
        if (result.errors.length === 0) {
          console.log('Copying assets...');
          copyAssets();
          console.log('Assets copied ...');
        }
      });
    }
  },
};
