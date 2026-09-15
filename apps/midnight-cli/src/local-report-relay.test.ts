import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalVerifiedReportRelay } from './local-report-relay.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('local verified report relay', () => {
  it('stores the private report and intact evidence outside the public web build', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostwhistle-inbox-'));
    temporaryDirectories.push(directory);
    const ticket = 'ab'.repeat(32);
    const relay = new LocalVerifiedReportRelay({ verify: async () => true }, directory);

    await relay.deliver({
      ticket,
      to: 'audit@acme.co.kr',
      subject: 'Verified report',
      body: {
        departmentOrAsset: 'Finance',
        title: 'Verified report',
        summary: 'Summary',
        details: 'Details',
        attachments: [{ name: 'proof.png', mediaType: 'image/png', size: 3, sha256: 'ab'.repeat(32) }],
      },
      verification: {
        mode: 'internal',
        reportCommitment: 'cd'.repeat(32),
        destinationCommitment: 'ef'.repeat(32),
        reportSalt: new Uint8Array(32),
        nullifier: '12'.repeat(32),
      },
      attachments: [
        {
          name: 'proof.png',
          mediaType: 'image/png',
          size: 3,
          sha256: 'ab'.repeat(32),
          contentBase64: Buffer.from([1, 2, 3]).toString('base64'),
        },
      ],
    });

    const report = JSON.parse(await readFile(join(directory, ticket, 'report.json'), 'utf8'));
    expect(report.body.details).toBe('Details');
    expect(report.attachments[0].originalName).toBe('proof.png');
    await expect(readFile(join(directory, ticket, 'evidence', '01-proof.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
  });
});
