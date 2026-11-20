// Run by scripts/ci/sbom-collect.sh from /app in the image's builder stage, where esbuild and vite
// resolve:
//   back <file>   writes to <file> the directory of every package the backend's bundles inline
//                 (through tsx, which esbuild-config.ts needs);
//   front <file>  the same for the front end's Vite build, the packages its stylesheets import
//                 included, without writing front/dist;
//   ids           prints the name@version of each package directory read from stdin.
// A source map is no such record: esbuild chains the maps a package ships, which name files outside
// it (drizzle-orm's as node_modules/src/*) or files another package vendored.
import fs from 'node:fs';
import path from 'node:path';

const [mode, output] = process.argv.slice(2);
const repository = process.cwd();
const modules = new Set();
if (mode === 'back') {
  process.chdir('back');
  const esbuild = await import('esbuild');
  const { bundlingOptions, buildModeOptions } = await import(path.resolve('esbuild-config.ts'));
  const { metafile } = await esbuild.build({
    ...bundlingOptions, ...buildModeOptions(false), absWorkingDir: process.cwd(), outdir: '/tmp/sbom-back', write: false, metafile: true, logLevel: 'warning',
  });
  for (const input of Object.keys(metafile.inputs)) {
    modules.add(path.resolve(input));
  }
} else if (mode === 'front') {
  process.chdir('front');
  const { build } = await import('vite');
  await build({
    configFile: 'vite.config.ts', logLevel: 'warn', build: { write: false },
    plugins: [{
      name: 'sbom-modules',
      // A stylesheet's @import is resolved inside a transform (Tailwind's, Vite's CSS plugin), so
      // what it pulls in is no module id: those transforms report each file they read to
      // addWatchFile, the record Vite's own rebuilds rely on.
      configResolved(config) {
        for (const plugin of config.plugins) {
          const hook = plugin.transform;
          if (hook === undefined) {
            continue;
          }
          const handler = typeof hook === 'function' ? hook : hook.handler;
          const recorded = function (...args) {
            const context = new Proxy(this, {
              get(target, key) {
                if (key === 'addWatchFile') {
                  return (file) => {
                    modules.add(file);
                    return target.addWatchFile(file);
                  };
                }
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
            return handler.apply(context, args);
          };
          if (typeof hook === 'function') {
            plugin.transform = recorded;
          } else {
            hook.handler = recorded;
          }
        }
      },
      generateBundle(_, bundle) {
        for (const chunk of Object.values(bundle)) {
          for (const id of chunk.moduleIds ?? []) {
            modules.add(id);
          }
        }
      },
    }],
  });
} else if (mode === 'ids') {
  for (const dir of fs.readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
    const { name, version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    process.stdout.write(`${name}@${version}\n`);
  }
  process.exit(0);
} else {
  process.exit(2);
}
const packages = new Set();
for (const id of modules) {
  // A virtual module id starts with a NUL, a transformed one carries a query.
  const root = /^(\/.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(id.replace(/\?.*$/, ''))?.[1];
  if (root !== undefined) {
    packages.add(path.relative(repository, root));
  }
}
const missing = [...packages].filter((dir) => !fs.existsSync(path.join(repository, dir, 'package.json')));
if (packages.size === 0 || missing.length > 0) {
  process.stderr.write(`${mode}: ${packages.size} packages inlined, without a package.json: ${missing.join(' ')}\n`);
  process.exit(1);
}
fs.writeFileSync(output, `${[...packages].sort().join('\n')}\n`);
