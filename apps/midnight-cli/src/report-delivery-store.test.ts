import { mkdtemp, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileReportDeliveryStore } from './report-delivery-store.js';

describe('file report delivery store', () => {
  it('persists a completed ticket and releases a failed claim', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostwhistle-delivery-'));
    const store = new FileReportDeliveryStore(directory);
    const completed = 'ab'.repeat(32);
    const failed = 'cd'.repeat(32);

    await expect(store.claim(completed)).resolves.toBe('claimed');
    await expect(store.claim(completed)).resolves.toBe('in-progress');
    await store.complete(completed);
    await expect(store.claim(completed)).resolves.toBe('already-delivered');
    await expect(readFile(join(directory, `${completed}.done`), 'utf8')).resolves.toMatch(/T/);

    await expect(store.claim(failed)).resolves.toBe('claimed');
    await store.release(failed);
    await expect(store.claim(failed)).resolves.toBe('claimed');
  });

  it('recovers a stale crash lock without reopening a completed ticket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostwhistle-delivery-'));
    const ticket = 'ef'.repeat(32);
    let now = Date.parse('2026-09-15T00:00:00.000Z');
    const store = new FileReportDeliveryStore(directory, 60_000, () => now);

    await expect(store.claim(ticket)).resolves.toBe('claimed');
    await utimes(join(directory, `${ticket}.lock`), new Date(now), new Date(now));
    now += 60_001;
    await expect(store.claim(ticket)).resolves.toBe('claimed');
    await store.complete(ticket);
    now += 60_001;
    await expect(store.claim(ticket)).resolves.toBe('already-delivered');
  });
});
