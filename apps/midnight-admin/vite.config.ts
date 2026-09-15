import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: {
      assert: fileURLToPath(new URL('./src/assert-browser.ts', import.meta.url)),
      'isomorphic-ws': fileURLToPath(new URL('./src/websocket-browser.ts', import.meta.url)),
    },
  },
  publicDir: fileURLToPath(new URL('../../packages/contract/src/managed/ghostwhistle', import.meta.url)),
  server: { host: '127.0.0.1' },
});
