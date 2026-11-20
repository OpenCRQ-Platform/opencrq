import type { Plugin } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// JSON file import with Native ESM is still experimental
// eslint-disable-next-line import/no-commonjs
const pkg = require('../package.json');
// eslint-disable-next-line import/no-commonjs
const rootPkg = require('../../package.json');

export const PackagePlugin: (runtimeDependencies: Array<string>) => Plugin = (runtimeDependencies) => ({
  name: 'package',
  setup(build) {
    const { outdir } = build.initialOptions;
    if (outdir) {
      build.onEnd((result) => {
        if (result.errors.length === 0) {
          const prodPkg = {
            name: pkg.name,
            version: pkg.version,
            private: true,
            type: 'module',
            packageManager: rootPkg.packageManager,
            dependencies: Object.fromEntries(
              runtimeDependencies.flatMap((mod) => {
                try {
                  // Resolve from any workspace, not just back
                  const resolved = require.resolve(mod);
                  const pkgDir = resolved.substring(0, resolved.lastIndexOf(`node_modules${path.sep}`) + 'node_modules'.length + 1)
                    + mod.replace('/', path.sep);
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse from workspace package.json files
                  const modPkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')) as { version: string };
                  return [[mod, modPkg.version]];
                } catch {
                  return [];
                }
              }),
            ),
          };
          fs.writeFileSync(path.join(outdir, 'package.json'), JSON.stringify(prodPkg, null, 2));
          console.log(`Build complete! Only these dependencies will be installed in prod: ${Object.keys(prodPkg.dependencies).join(', ')}`);
        }
      });
    }
  },
});
