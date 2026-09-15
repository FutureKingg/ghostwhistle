import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSlidingWindowRateLimiter } from './file-rate-limiter.js';

describe('file sliding-window rate limiter', () => {
  it('survives restarts without storing email or IP keys in plaintext', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostwhistle-rate-'));
    let now = 1_000;
    await new FileSlidingWindowRateLimiter('otp', 2, 1_000, directory, () => now).consume(
      'email:hana@acme.co.kr',
    );
    const restarted = new FileSlidingWindowRateLimiter('otp', 2, 1_000, directory, () => now);
    await expect(restarted.consume('email:hana@acme.co.kr')).resolves.toMatchObject({ remaining: 0 });
    await expect(restarted.consume('email:hana@acme.co.kr')).rejects.toThrow(/Rate limit exceeded/);

    const stored = await readFile(join(directory, 'otp.json'), 'utf8');
    expect(stored).not.toContain('hana@acme.co.kr');
    now = 2_001;
    await expect(restarted.consume('email:hana@acme.co.kr')).resolves.toMatchObject({ remaining: 1 });
  });
});
