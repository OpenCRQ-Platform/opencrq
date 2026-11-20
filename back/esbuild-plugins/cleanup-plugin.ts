import type { Plugin } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

export const MAPS_DIR = 'maps';

export const CleanupPlugin: Plugin = {
  name: 'cleanup',
  setup(build) {
    build.onStart(() => {
      const { outdir } = build.initialOptions;
      if (outdir) {
        fs.mkdirSync(outdir, { recursive: true });
        // Left in place for the assets plugin, which copies a map file only when it changed.
        for (const entry of fs.readdirSync(outdir)) {
          if (entry !== MAPS_DIR) {
            fs.rmSync(path.join(outdir, entry), { recursive: true, force: true });
          }
        }
      }
    });
  },
};
