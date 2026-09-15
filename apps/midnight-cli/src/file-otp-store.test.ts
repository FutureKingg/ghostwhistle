import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OtpChallenge } from '@ghostwhistle/core';
import { FileOtpStore } from './file-otp-store.js';

const challenge: OtpChallenge = {
  id: '12345678-1234-4123-8123-123456789abc',
  email: 'hana@acme.co.kr',
  domain: 'acme.co.kr',
  credentialCommitment: 'ab'.repeat(32),
  codeHash: 'cd'.repeat(32),
  expiresAt: 2_000,
  attempts: 0,
};

describe('file OTP store', () => {
  it('persists a challenge across store instances without storing a plaintext code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostwhistle-otp-'));
    await new FileOtpStore(directory).put(challenge);

    await expect(
      new FileOtpStore(directory).attempt({
        id: challenge.id,
        candidateHash: challenge.codeHash,
        now: 1_000,
        maxAttempts: 5,
      }),
    ).resolves.toEqual({ status: 'verified', challenge: { ...challenge, attempts: 1 } });
    await expect(
      new FileOtpStore(directory).attempt({
        id: challenge.id,
        candidateHash: challenge.codeHash,
        now: 1_000,
        maxAttempts: 5,
      }),
    ).resolves.toEqual({ status: 'not-found' });
  });

  it('persists failed attempts and deletes expired challenges', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostwhistle-otp-'));
    const store = new FileOtpStore(directory);
    await store.put(challenge);
    await expect(
      store.attempt({ id: challenge.id, candidateHash: 'ef'.repeat(32), now: 1_000, maxAttempts: 1 }),
    ).resolves.toEqual({ status: 'incorrect' });
    await expect(
      store.attempt({ id: challenge.id, candidateHash: 'ef'.repeat(32), now: 1_000, maxAttempts: 1 }),
    ).resolves.toEqual({ status: 'too-many-attempts' });

    await store.put({ ...challenge, id: 'aaaaaaaa-1234-4123-8123-123456789abc' });
    await expect(
      store.attempt({
        id: 'aaaaaaaa-1234-4123-8123-123456789abc',
        candidateHash: challenge.codeHash,
        now: 2_000,
        maxAttempts: 5,
      }),
    ).resolves.toEqual({ status: 'expired' });
  });
});
