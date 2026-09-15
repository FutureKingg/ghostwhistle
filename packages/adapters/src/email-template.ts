import type { RelayMessage } from '@ghostwhistle/core';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export function buildVerifiedReportHtml(message: RelayMessage): string {
  const body = message.body;
  const attachments = message.attachments.length
    ? `<p><strong>Evidence files</strong><br>${message.attachments
        .map(
          (attachment) =>
            `${escapeHtml(attachment.name)} (${escapeHtml(attachment.mediaType)}, ${attachment.size.toLocaleString('en-US')} bytes)`,
        )
        .join('<br>')}</p>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;background:#f1f5f3;padding:24px;font-family:Arial,sans-serif;color:#17211d">
  <main style="max-width:640px;margin:auto;background:#fff;border:1px solid #d9e2dd;border-radius:12px;overflow:hidden">
    <header style="background:#0b1714;color:#fff;padding:24px">
      <span style="display:inline-block;background:#b9ff66;color:#0b1714;padding:5px 8px;border-radius:4px;font-size:11px;font-weight:bold">✓ ZK-VERIFIED REPORT</span>
      <h1 style="font-size:20px;margin:14px 0 6px">${escapeHtml(message.subject)}</h1>
      <p style="margin:0;color:#9bada4;font-size:12px">Ticket ${escapeHtml(message.ticket)}</p>
    </header>
    <section style="padding:18px 24px;background:#edf5ef;border-bottom:1px solid #d9e2dd;font-size:13px">
      Eligibility and destination rules were verified by the GhostWhistle Compact contract. Sender identity was not relayed.
    </section>
    <section style="padding:24px;font-size:14px;line-height:1.65">
      <p><strong>Department / asset</strong><br>${escapeHtml(body.departmentOrAsset)}</p>
      <p><strong>Summary</strong><br>${escapeHtml(body.summary)}</p>
      <p><strong>Details</strong><br>${escapeHtml(body.details).replaceAll('\n', '<br>')}</p>
      ${attachments}
    </section>
    <footer style="padding:16px 24px;background:#f3f6f4;color:#65736c;font:11px monospace">
      report=${escapeHtml(message.verification.reportCommitment)}<br>
      destination=${escapeHtml(message.verification.destinationCommitment)}
    </footer>
  </main>
</body></html>`;
}
