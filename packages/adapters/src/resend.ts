import type { OtpDeliveryPort, RelayMessage, RelayPort, TicketVerifierPort } from '@ghostwhistle/core';
import { buildVerifiedReportHtml } from './email-template.js';
import { postJson } from './http.js';

type ResendConfig = {
  apiKey: string;
  reportFrom: string;
  otpFrom: string;
  replyTo?: string;
  ticketVerifier: TicketVerifierPort;
  fetcher?: typeof fetch;
};

type ResendOtpConfig = {
  apiKey: string;
  otpFrom: string;
  fetcher?: typeof fetch;
};

export class ResendOtpDelivery implements OtpDeliveryPort {
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: ResendOtpConfig) {
    if (!config.apiKey) throw new Error('RESEND_API_KEY is required.');
    if (!config.otpFrom) throw new Error('RESEND_OTP_FROM is required.');
    this.fetcher = config.fetcher ?? fetch;
  }

  async send(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    await postJson(
      'https://api.resend.com/emails',
      {
        from: this.config.otpFrom,
        to: [input.to],
        subject: 'Your GhostWhistle verification code',
        text: `Your verification code is ${input.code}. It expires in ${input.expiresInMinutes} minutes. Never share this code.`,
      },
      { authorization: `Bearer ${this.config.apiKey}` },
      this.fetcher,
    );
  }
}

export class ResendGateway implements RelayPort, OtpDeliveryPort {
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: ResendConfig) {
    if (!config.apiKey) throw new Error('RESEND_API_KEY is required.');
    this.fetcher = config.fetcher ?? fetch;
  }

  async deliver(message: RelayMessage): Promise<void> {
    if (!(await this.config.ticketVerifier.verify(message))) {
      throw new Error('Report ticket, destination, or commitment verification failed.');
    }
    await this.postEmail(
      {
        from: this.config.reportFrom,
        to: [message.to],
        subject: `[ZK-Verified] ${message.subject}`,
        html: buildVerifiedReportHtml(message),
        ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
        headers: { 'X-GhostWhistle-Ticket': message.ticket },
        ...(message.attachments.length
          ? {
              attachments: message.attachments.map((attachment) => ({
                filename: attachment.name,
                content: attachment.contentBase64,
              })),
            }
          : {}),
      },
      `ghostwhistle-report/${message.ticket}`,
    );
  }

  async send(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    await this.postEmail({
      from: this.config.otpFrom,
      to: [input.to],
      subject: 'Your GhostWhistle verification code',
      text: `Your verification code is ${input.code}. It expires in ${input.expiresInMinutes} minutes. Never share this code.`,
    });
  }

  private async postEmail(payload: Record<string, unknown>, idempotencyKey?: string): Promise<void> {
    await postJson(
      'https://api.resend.com/emails',
      payload,
      {
        authorization: `Bearer ${this.config.apiKey}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      this.fetcher,
    );
  }
}
