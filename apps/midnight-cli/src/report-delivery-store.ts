import { access, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReportDeliveryClaim = 'claimed' | 'already-delivered' | 'in-progress';

export interface ReportDeliveryStore {
  claim(ticket: string): Promise<ReportDeliveryClaim>;
  complete(ticket: string): Promise<void>;
  release(ticket: string): Promise<void>;
}

export class InMemoryReportDeliveryStore implements ReportDeliveryStore {
  private readonly delivered = new Set<string>();
  private readonly inProgress = new Set<string>();

  async claim(ticket: string): Promise<ReportDeliveryClaim> {
    assertTicket(ticket);
    if (this.delivered.has(ticket)) return 'already-delivered';
    if (this.inProgress.has(ticket)) return 'in-progress';
    this.inProgress.add(ticket);
    return 'claimed';
  }

  async complete(ticket: string): Promise<void> {
    assertTicket(ticket);
    this.inProgress.delete(ticket);
    this.delivered.add(ticket);
  }

  async release(ticket: string): Promise<void> {
    assertTicket(ticket);
    this.inProgress.delete(ticket);
  }
}

const defaultDirectory = fileURLToPath(new URL('../.local/delivery-receipts/', import.meta.url));

/**
 * Durable single-instance delivery claims. Multi-instance deployments should
 * replace this with an atomic shared store such as Redis or a database.
 */
export class FileReportDeliveryStore implements ReportDeliveryStore {
  constructor(
    private readonly directory = defaultDirectory,
    private readonly staleLockMs = 30 * 60 * 1000,
    private readonly now = () => Date.now(),
  ) {}

  async claim(ticket: string): Promise<ReportDeliveryClaim> {
    assertTicket(ticket);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const { done, lock } = this.paths(ticket);
    if (await exists(done)) return 'already-delivered';

    if (await this.createLock(lock)) return 'claimed';
    if (await exists(done)) return 'already-delivered';
    if (!(await this.isStale(lock))) return 'in-progress';

    await rm(lock, { force: true });
    if (await exists(done)) return 'already-delivered';
    return (await this.createLock(lock)) ? 'claimed' : 'in-progress';
  }

  async complete(ticket: string): Promise<void> {
    assertTicket(ticket);
    const { done, lock } = this.paths(ticket);
    try {
      await rename(lock, done);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && (await exists(done))) return;
      throw error;
    }
  }

  async release(ticket: string): Promise<void> {
    assertTicket(ticket);
    await rm(this.paths(ticket).lock, { force: true });
  }

  private paths(ticket: string) {
    return {
      lock: join(this.directory, `${ticket}.lock`),
      done: join(this.directory, `${ticket}.done`),
    };
  }

  private async createLock(path: string): Promise<boolean> {
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(new Date(this.now()).toISOString(), 'utf8');
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  private async isStale(path: string): Promise<boolean> {
    try {
      const metadata = await stat(path);
      return metadata.mtimeMs <= this.now() - this.staleLockMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
  }
}

function assertTicket(ticket: string): void {
  if (!/^[0-9a-f]{64}$/i.test(ticket)) throw new Error('Delivery ticket must be exactly 32 bytes.');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
