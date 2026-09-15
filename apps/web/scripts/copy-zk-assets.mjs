import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const contractAssets = fileURLToPath(
  new URL('../../../packages/contract/src/managed/ghostwhistle/', import.meta.url),
);
const output = fileURLToPath(new URL('../dist/midnight/ghostwhistle/', import.meta.url));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  cp(`${contractAssets}keys`, `${output}keys`, { recursive: true }),
  cp(`${contractAssets}zkir`, `${output}zkir`, { recursive: true }),
]);

console.log(`Copied GhostWhistle ZK assets into ${output.replace(webRoot, '')}`);
