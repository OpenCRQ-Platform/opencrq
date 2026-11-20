import { defineConfig } from 'vitest/config';
import { DurationBalancedSequencer } from './src/setup/shard-sequencer';

const maxWorkers = process.env['VITEST_MAX_FORKS']
  ? Number(process.env['VITEST_MAX_FORKS'])
  : 4;

export default defineConfig({
  test: {
    globals: false,
    globalSetup: './src/setup/global-setup.ts',
    setupFiles: ['./src/setup/single-connection-guard.ts', './src/setup/mock.ts', './src/setup/teardown.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: true,
    pool: 'forks',
    maxWorkers,
    sequence: {
      sequencer: DurationBalancedSequencer,
    },
  },
});
