import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'supabase/functions/**/__tests__/**/*.test.ts',
      // Pure-helper modules under mobile/lib (no React, no native code)
      // can run under the same node-only vitest config the supabase
      // tests use. Component-level mobile tests would need a separate
      // test setup with React Native shims; kept out of scope here.
      'mobile/lib/**/__tests__/**/*.test.ts',
    ],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shared': '/supabase/functions/_shared',
    },
    extensions: ['.ts', '.js'],
  },
});
