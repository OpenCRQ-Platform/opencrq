import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Equivalent to calling `vi.clearAllMocks()` before every test — clears
    // mock.calls/instances/results but keeps implementations set via
    // `vi.fn().mockReturnValue(...)` etc.
    clearMocks: true,
  },
});
