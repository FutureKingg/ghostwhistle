import { cp, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist', import.meta.url), { recursive: true });
await cp(new URL('../src/managed', import.meta.url), new URL('../dist/managed', import.meta.url), {
  recursive: true,
  force: true,
});
await cp(
  new URL('../src/ghostwhistle.compact', import.meta.url),
  new URL('../dist/ghostwhistle.compact', import.meta.url),
  { force: true },
);
