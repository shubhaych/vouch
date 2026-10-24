import { defineConfig } from 'vitest/config';
import { spacetimedbModuleTestPlugin } from 'spacetimedb/server/test-utils/vitest';

// The plugin stubs the host syscalls so reducers run in-process against the
// portable datastore that ships with the spacetimedb package.
export default defineConfig({
  plugins: [spacetimedbModuleTestPlugin()],
  test: { include: ['src/**/*.test.ts'], testTimeout: 120_000 },
});
