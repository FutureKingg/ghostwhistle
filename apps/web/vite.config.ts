import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

const zkAssetRoot = fileURLToPath(
  new URL('../../packages/contract/src/managed/ghostwhistle', import.meta.url),
);

function serveGhostWhistleZkAssets(): Plugin {
  const prefix = '/midnight/ghostwhistle/';
  return {
    name: 'serve-ghostwhistle-zk-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith(prefix)) return next();

        const relativePath = decodeURIComponent(pathname.slice(prefix.length));
        const assetPath = resolve(zkAssetRoot, relativePath);
        if (assetPath !== zkAssetRoot && !assetPath.startsWith(`${zkAssetRoot}${sep}`)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        if (!existsSync(assetPath) || !statSync(assetPath).isFile()) return next();

        response.setHeader(
          'Content-Type',
          extname(assetPath) === '.json' ? 'application/json' : 'application/octet-stream',
        );
        createReadStream(assetPath).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), wasm(), serveGhostWhistleZkAssets()],
  resolve: {
    alias: {
      assert: fileURLToPath(new URL('./src/lib/assert-browser.ts', import.meta.url)),
      'isomorphic-ws': fileURLToPath(new URL('./src/lib/websocket-browser.ts', import.meta.url)),
    },
  },
  server: { port: 4173 },
  preview: { port: 4173 },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
  },
});
