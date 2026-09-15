import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyViolation } from '@ghostwhistle/core';

type RateLimitState = Record<string, number[]>;

const defaultDirectory = fileURLToPath(new URL('../.local/rate-limits/', import.meta.url));

/** Durable, privacy-minimized rate limits for one issuer process. */
export class FileSlidingWindowRateLimiter {
  private pending: Promise<void> = Promise.resolve();
  private readonly statePath: string;

  constructor(
    namespace: string,
    private readonly maxEvents: number,
    private readonly windowMs: number,
    private readonly directory = defaultDirectory,
    private readonly now = () => Date.now(),
  ) {
    if (!/^[a-z0-9-]{1,40}$/i.test(namespace)) throw new Error('Rate-limit namespace is invalid.');
    this.statePath = join(directory, `${namespace}.json`);
  }

  consume(key: string): Promise<{ remaining: number; resetAt: number }> {
    return this.serial(async () => {
      const current = this.now();
      const state = await this.readState();
      const keyHash = createHash('sha256').update(key).digest('hex');
      const recent = (state[keyHash] ?? []).filter(
        (timestamp) => Number.isSafeInteger(timestamp) && timestamp > current - this.windowMs,
      );
      if (recent.length >= this.maxEvents) {
        const resetAt = recent[0]! + this.windowMs;
        throw policyViolation(`Rate limit exceeded. Try again after ${new Date(resetAt).toISOString()}.`);
      }

      recent.push(current);
      const nextState = Object.fromEntries(
        Object.entries(state)
          .map(([hash, events]) => [
            hash,
            events.filter(
              (timestamp) => Number.isSafeInteger(timestamp) && timestamp > current - this.windowMs,
            ),
          ])
          .filter(([, events]) => (events as number[]).length > 0),
      ) as RateLimitState;
      nextState[keyHash] = recent;
      await this.writeState(nextState);
      return { remaining: this.maxEvents - recent.length, resetAt: recent[0]! + this.windowMs };
    });
  }

  private async readState(): Promise<RateLimitState> {
    try {
      const value = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown;
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as RateLimitState) : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  private async writeState(state: RateLimitState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.statePath);
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
