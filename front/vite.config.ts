import tailwindcss from '@tailwindcss/vite';
import { lingui } from '@lingui/vite-plugin';
import babel from '@rolldown/plugin-babel';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { backendConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const proxyTarget =
  process.env.PROXY_TARGET ||
  `http://localhost:${String(backendConfig.http_server.port)}`;

// Auto-detect if @filigran packages are linked locally via portal: protocol.
// When linked, the resolved real path points outside node_modules.
const isFiligranLinked = (): boolean => {
  try {
    // Check both local and hoisted node_modules (Yarn workspaces hoists to root)
    const candidates = [
      resolve(__dirname, 'node_modules/@filigran/ui'),
      resolve(__dirname, '../node_modules/@filigran/ui'),
    ];
    const pkgDir = candidates.find((c) => existsSync(c));
    if (!pkgDir) {
      return false;
    }
    return !realpathSync(pkgDir).includes('node_modules');
  } catch {
    return false;
  }
};

const getLinkedFiligranRoot = (): string | null => {
  try {
    const candidates = [
      resolve(__dirname, 'node_modules/@filigran/ui'),
      resolve(__dirname, '../node_modules/@filigran/ui'),
    ];
    const pkgDir = candidates.find((c) => existsSync(c));
    if (!pkgDir) {
      return null;
    }
    const realPath = realpathSync(pkgDir);
    if (realPath.includes('node_modules')) {
      return null;
    }
    // portal: points to packages/filigran-ui — go up 2 levels for the repo root
    return resolve(realPath, '../..');
  } catch {
    return null;
  }
};

const linked = isFiligranLinked();
const filigranRoot = linked ? getLinkedFiligranRoot() : null;

if (linked) {
  // eslint-disable-next-line no-console
  console.log('🔗 @filigran packages are linked locally from:', filigranRoot);
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    devtools(),
    lingui(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    babel({
      plugins: [
        '@lingui/babel-plugin-lingui-macro', // Must be before react-compiler, see https://lingui.dev/installation#choosing-a-transpiler
        ['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }],
      ],
    }),
    viteReact(),
  ],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      // When @filigran packages are linked, dedupe all their peer deps
      // to prevent duplicate instances resolved from the linked package's tree.
      ...(linked
        ? ['zod', 'react-hook-form', '@hookform/resolvers', '@filigran/icon']
        : []),
    ],
  },
  optimizeDeps: {
    // Exclude linked packages from pre-bundling so Vite picks up changes
    exclude: linked ? ['@filigran/ui', '@filigran/icon'] : undefined,
  },
  build: {
    // lightningcss doesn't recognise Tailwind v4's @theme / @utility at-rules.
    // esbuild passes unknown at-rules through without warnings.
    cssMinify: 'esbuild',
  },
  server: {
    host: true,
    port: backendConfig.dev_server.port,
    strictPort: true,
    fs: {
      // Allow serving files from the linked filigran-ui directory
      allow: filigranRoot ? [filigranRoot, '..'] : undefined,
    },
    watch: linked
      ? {
        ignored: ['!**/node_modules/@filigran/**'],
      }
      : undefined,
    proxy: {
      '/api': proxyTarget,
      '/trpc': proxyTarget,
    },
  },
});
