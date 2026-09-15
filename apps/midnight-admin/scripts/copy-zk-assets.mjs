import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const contractAssets = fileURLToPath(
  new URL('../../../packages/contract/src/managed/ghostwhistle/', import.meta.url),
);
const output = fileURLToPath(new URL('../dist/', import.meta.url));

for (const directory of ['keys', 'zkir']) {
  await rm(`${output}${directory}`, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(`${contractAssets}${directory}`, `${output}${directory}`, { recursive: true });
}
