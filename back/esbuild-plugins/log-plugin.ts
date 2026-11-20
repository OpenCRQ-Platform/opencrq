import type { Plugin } from 'esbuild';

export const LogPlugin: Plugin = {
  name: 'log',
  setup(build) {
    build.onStart(() => {
      console.log('Build in progress...');
    });

    build.onEnd((result) => {
      if (result.errors.length === 0) {
        console.log('Build success');
      } else {
        console.log('Build failed');
      }
    });
  },
};
