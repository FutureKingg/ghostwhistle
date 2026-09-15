import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ghostwhistle/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@ghostwhistle/contract': fileURLToPath(new URL('../contract/src/index.ts', import.meta.url)),
    },
  },
});
