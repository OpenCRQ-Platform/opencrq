import type { Plugin } from 'esbuild';

export const EsmPlugin: Plugin = {
  name: 'esm-plugin',
  setup(build) {
    const options = build.initialOptions;

    options.format = 'esm';
    options.outExtension = {
      ...(options.outExtension ?? {}),
      '.js': '.mjs',
    };
    options.platform = 'node';

    // Shim injection
    options.banner = options.banner || {};
    const esmShim = `
const { require, __filename, __dirname } = await (async () => {
  const { createRequire } = await import('node:module');
  const { fileURLToPath, URL } = await import('node:url');
  return {
    require: createRequire(import.meta.url),
    __filename: fileURLToPath(import.meta.url),
    __dirname: fileURLToPath(new URL('.', import.meta.url)),
  };
})();
`;

    options.banner.js = (options.banner.js || '') + esmShim;
  },
};
