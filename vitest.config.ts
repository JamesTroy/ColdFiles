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
  // Provide a minimal inline tsconfig so vite/esbuild's transform
  // doesn't auto-discover mobile/tsconfig.json (which extends
  // expo/tsconfig.base and would require mobile/node_modules to
  // resolve — not installed in CI's root-only `npm ci` step).
  // The pure-helper tests under mobile/lib/__tests__ use only
  // relative imports, so no path aliases need to be carried in.
  // PR #33's vitest include extension shipped before this CI gap
  // got noticed; this fix unblocks every PR that touches the
  // covered surface.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'es2022',
        useDefineForClassFields: true,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': '/supabase/functions/_shared',
    },
    extensions: ['.ts', '.js'],
  },
});
