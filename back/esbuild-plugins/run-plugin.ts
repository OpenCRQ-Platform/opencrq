import type { Plugin } from 'esbuild';
import {  spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';

export const RunPlugin: Plugin = {
  name: 'run',
  setup(build) {
    const { outdir } = build.initialOptions;
    if (outdir) {
      let serverProcess: ChildProcess | null = null;

      const startServer = () => {
        if (serverProcess) {
          serverProcess.removeAllListeners('close');
          serverProcess.kill();
        }

        serverProcess = spawn('node', ['--enable-source-maps', path.join(outdir, 'index-pm.mjs')], {
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: 'development' },
        });

        serverProcess.on('close', (code) => {
          process.exit(code ?? 0);
        });
      };

      build.onEnd((result) => {
        if (result.errors.length === 0) {
          console.log('Starting server...');
          startServer();
        }
      });
    }
  },
};
