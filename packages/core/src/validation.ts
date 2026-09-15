import { invalidInput } from './errors.js';
import type { ReportAttachment } from './types.js';

export const evidenceLimits = {
  maxFiles: 5,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
} as const;

export const allowedEvidenceMediaTypes = new Set([
  'application/json',
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

export function normalizeReportAttachments(
  attachments: readonly ReportAttachment[] = [],
): ReportAttachment[] {
  if (attachments.length > evidenceLimits.maxFiles) {
    throw invalidInput(`A report may include at most ${evidenceLimits.maxFiles} evidence files.`);
  }

  let totalBytes = 0;
  const normalized = attachments.map((attachment) => {
    const name = attachment.name.normalize('NFC').split(/[\\/]/).pop()?.trim();
    if (!name || name.length > 180 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw invalidInput('Evidence file names must be between 1 and 180 safe characters.');
    }
    const mediaType = attachment.mediaType.trim().toLowerCase();
    if (!allowedEvidenceMediaTypes.has(mediaType)) {
      throw invalidInput(`Unsupported evidence file type: ${mediaType || 'unknown'}.`);
    }
    if (
      !Number.isSafeInteger(attachment.size) ||
      attachment.size <= 0 ||
      attachment.size > evidenceLimits.maxFileBytes
    ) {
      throw invalidInput(
        `Each evidence file must be between 1 byte and ${evidenceLimits.maxFileBytes} bytes.`,
      );
    }
    const sha256 = attachment.sha256.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw invalidInput('Evidence SHA-256 must be a 32-byte hexadecimal value.');
    }
    totalBytes += attachment.size;
    return { name, mediaType, size: attachment.size, sha256 };
  });

  if (totalBytes > evidenceLimits.maxTotalBytes) {
    throw invalidInput(`Evidence files may total at most ${evidenceLimits.maxTotalBytes} bytes.`);
  }
  return normalized;
}

export function normalizeDomain(value: string): string {
  const candidate = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.$/, '');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(candidate)) {
    throw invalidInput('A valid organization domain is required.');
  }
  return candidate;
}

export function normalizeEmail(value: string): { email: string; domain: string } {
  const email = value.trim().toLowerCase();
  const match = email.match(/^([^\s@]+)@([a-z0-9.-]+\.[a-z]{2,63})$/i);
  if (!match) throw invalidInput('A valid work email is required.');
  return { email, domain: normalizeDomain(match[2]) };
}

export function isOfficialDestination(email: string, domain: string, mailbox: 'audit' | 'security'): boolean {
  return email.trim().toLowerCase() === `${mailbox}@${domain}`;
}

export function canonicalReport(report: {
  departmentOrAsset: string;
  title: string;
  summary: string;
  details: string;
  attachments?: ReportAttachment[];
}): string {
  const values = [report.departmentOrAsset, report.title, report.summary, report.details].map((value) =>
    value.trim(),
  );
  if (values.some((value) => !value)) throw invalidInput('All report fields are required.');
  const attachments = normalizeReportAttachments(report.attachments);
  return JSON.stringify({
    departmentOrAsset: values[0],
    title: values[1],
    summary: values[2],
    details: values[3],
    ...(attachments.length ? { attachments } : {}),
  });
}
