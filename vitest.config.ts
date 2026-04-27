import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['supabase/functions/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shared': '/supabase/functions/_shared',
    },
    extensions: ['.ts', '.js'],
  },
});
