import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { OtpAttemptResult, OtpChallenge, OtpStore } from '@ghostwhistle/core';

const defaultDirectory = fileURLToPath(new URL('../.local/otp-challenges/', import.meta.url));

/**
 * Durable single-instance OTP state. The code itself is never stored; only
 * the challenge hash and short-lived issuer metadata are persisted. Use a
 * shared encrypted TTL store for a multi-instance deployment.
 */
export class FileOtpStore implements OtpStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly directory = defaultDirectory) {}

  put(challenge: OtpChallenge): Promise<void> {
    return this.serial(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = this.pathFor(challenge.id);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(challenge), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    });
  }

  attempt(input: {
    id: string;
    candidateHash: string;
    now: number;
    maxAttempts: number;
  }): Promise<OtpAttemptResult> {
    return this.serial(async () => {
      const path = this.pathFor(input.id);
      let challenge: OtpChallenge;
      try {
        challenge = JSON.parse(await readFile(path, 'utf8')) as OtpChallenge;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'not-found' };
        await rm(path, { force: true });
        return { status: 'not-found' };
      }

      if (challenge.expiresAt <= input.now) {
        await rm(path, { force: true });
        return { status: 'expired' };
      }
      challenge.attempts += 1;
      if (challenge.attempts > input.maxAttempts) {
        await rm(path, { force: true });
        return { status: 'too-many-attempts' };
      }
      if (challenge.codeHash !== input.candidateHash) {
        await writeFile(path, JSON.stringify(challenge), { encoding: 'utf8', mode: 0o600 });
        return { status: 'incorrect' };
      }
      await rm(path, { force: true });
      return { status: 'verified', challenge };
    });
  }

  delete(id: string): Promise<void> {
    return this.serial(() => rm(this.pathFor(id), { force: true }));
  }

  private pathFor(id: string): string {
    if (!/^[0-9a-f-]{16,100}$/i.test(id)) throw new Error('OTP challenge id is invalid.');
    return join(this.directory, `${id}.json`);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
