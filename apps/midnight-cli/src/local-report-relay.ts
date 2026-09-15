import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex, type RelayMessage, type RelayPort, type TicketVerifierPort } from '@ghostwhistle/core';

const defaultInbox = fileURLToPath(new URL('../.local/inbox/', import.meta.url));

export class LocalVerifiedReportRelay implements RelayPort {
  constructor(
    private readonly verifier: TicketVerifierPort,
    private readonly inboxDirectory = defaultInbox,
  ) {}

  async deliver(message: RelayMessage): Promise<void> {
    if (!(await this.verifier.verify(message))) {
      throw new Error('Report ticket, destination, or commitment verification failed.');
    }

    const reportDirectory = join(this.inboxDirectory, message.ticket);
    const reportPath = join(reportDirectory, 'report.json');
    if (await exists(reportPath)) return;

    const evidenceDirectory = join(reportDirectory, 'evidence');
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    const storedAttachments = [];
    for (const [index, attachment] of message.attachments.entries()) {
      const storedName = `${String(index + 1).padStart(2, '0')}-${safeFileName(attachment.name)}`;
      await writeFile(join(evidenceDirectory, storedName), Buffer.from(attachment.contentBase64, 'base64'), {
        mode: 0o600,
      });
      storedAttachments.push({
        storedName,
        originalName: attachment.name,
        mediaType: attachment.mediaType,
        size: attachment.size,
        sha256: attachment.sha256,
      });
    }

    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          ticket: message.ticket,
          to: message.to,
          subject: message.subject,
          body: message.body,
          verification: {
            ...message.verification,
            reportSalt: bytesToHex(message.verification.reportSalt),
          },
          attachments: storedAttachments,
          receivedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    console.log(`\n  Verified report saved locally: ${reportDirectory}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeFileName(value: string): string {
  return basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
}
