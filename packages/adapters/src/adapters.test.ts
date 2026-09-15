import { describe, expect, it, vi } from 'vitest';
import { buildVerifiedReportHtml } from './email-template';
import { GeminiModerationAdapter } from './gemini';
import { ResendGateway } from './resend';
import { SecureSecurityTxtResolver, assertPublicAddress } from './security-txt-resolver';

const message = {
  ticket: 'ticket-1',
  to: 'audit@acme.co.kr',
  subject: '<script>alert(1)</script>',
  body: { departmentOrAsset: 'Finance', title: 'Title', summary: '<b>bad</b>', details: 'line 1\nline 2' },
  verification: {
    mode: 'internal' as const,
    reportCommitment: 'report-hash',
    destinationCommitment: 'domain-hash',
    reportSalt: new Uint8Array(32),
    nullifier: 'nullifier',
  },
  attachments: [],
};

const allowTicket = { verify: async () => true };

describe('server adapters', () => {
  it('escapes report content in the HTML email', () => {
    const html = buildVerifiedReportHtml(message);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>bad</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps Resend credentials in an authorization header', async () => {
    const fetcher = vi.fn(
      async () => new Response('{"id":"mail-1"}', { status: 200 }),
    ) as unknown as typeof fetch;
    const resend = new ResendGateway({
      apiKey: 'server-secret',
      reportFrom: 'verified@example.com',
      otpFrom: 'otp@example.com',
      ticketVerifier: allowTicket,
      fetcher,
    });
    await resend.deliver(message);
    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer server-secret');
    expect(init.headers['idempotency-key']).toBe('ghostwhistle-report/ticket-1');
    expect(init.body).not.toContain('server-secret');
  });

  it('forwards verified evidence files as Resend attachments', async () => {
    const fetcher = vi.fn(
      async () => new Response('{"id":"mail-1"}', { status: 200 }),
    ) as unknown as typeof fetch;
    const resend = new ResendGateway({
      apiKey: 'server-secret',
      reportFrom: 'verified@example.com',
      otpFrom: 'otp@example.com',
      ticketVerifier: allowTicket,
      fetcher,
    });
    await resend.deliver({
      ...message,
      body: {
        ...message.body,
        attachments: [{ name: 'evidence.png', mediaType: 'image/png', size: 3, sha256: 'ab'.repeat(32) }],
      },
      attachments: [
        {
          name: 'evidence.png',
          mediaType: 'image/png',
          size: 3,
          sha256: 'ab'.repeat(32),
          contentBase64: 'AQID',
        },
      ],
    });
    const payload = JSON.parse((fetcher as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(payload.attachments).toEqual([{ filename: 'evidence.png', content: 'AQID' }]);
  });

  it('fails closed before Resend when ticket verification fails', async () => {
    const fetcher = vi.fn();
    const resend = new ResendGateway({
      apiKey: 'server-secret',
      reportFrom: 'verified@example.com',
      otpFrom: 'otp@example.com',
      ticketVerifier: { verify: async () => false },
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(resend.deliver(message)).rejects.toThrow('verification failed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates structured Gemini output', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"decision":"PASS","category":"report","reason":"reported harm"}' }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const adapter = new GeminiModerationAdapter({
      apiKey: 'server-secret',
      model: 'configured-model',
      fetcher,
    });
    await expect(adapter.classify('A report')).resolves.toEqual({
      decision: 'PASS',
      category: 'report',
      reason: 'reported harm',
    });
  });

  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', 'fc00::1'])(
    'rejects non-public security.txt targets',
    (address) => {
      expect(() => assertPublicAddress(address)).toThrow('non-public');
    },
  );

  it('pins a validated address while fetching a bounded security.txt', async () => {
    const transport = vi.fn(async () => ({
      status: 200,
      body: 'Contact: mailto:security@acme.co.kr\nExpires: 2099-01-01T00:00:00Z',
    }));
    const resolver = new SecureSecurityTxtResolver({
      transport,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    });
    await expect(resolver.resolve('acme.co.kr')).resolves.toMatchObject({
      contacts: [{ email: 'security@acme.co.kr' }],
    });
    expect(transport).toHaveBeenCalledWith({
      url: 'https://acme.co.kr/.well-known/security.txt',
      address: { address: '8.8.8.8', family: 4 },
      maxBytes: 128 * 1024,
    });
  });

  it('rejects a domain resolving to private infrastructure before fetch', async () => {
    const transport = vi.fn();
    const resolver = new SecureSecurityTxtResolver({
      transport,
      lookup: async () => [{ address: '10.0.0.5', family: 4 }],
    });
    await expect(resolver.resolve('acme.co.kr')).rejects.toThrow('non-public');
    expect(transport).not.toHaveBeenCalled();
  });
});
