import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { assertSponsoredContractCall, startIssuerServer, type SponsorOptions } from './issuer-server.js';

const running: Server[] = [];

afterEach(async () => {
  await Promise.all(
    running.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('issuer API', () => {
  it('delivers an OTP and issues only the matching credential commitment', async () => {
    const deliveries: Array<{ to: string; code: string }> = [];
    const issued: string[] = [];
    const server = await startIssuerServer({
      port: 0,
      allowedOrigin: 'http://127.0.0.1:4173',
      delivery: {
        async send(input) {
          deliveries.push({ to: input.to, code: input.code });
        },
      },
      registry: {
        async issueCredential(commitment) {
          issued.push(commitment);
        },
        async revokeCredential() {},
      },
      exposeDevelopmentOtp: true,
    });
    running.push(server);
    const port = (server.address() as AddressInfo).port;
    const credentialCommitment = 'ab'.repeat(32);

    const request = await post(port, '/api/internal/request', {
      email: 'reporter@acme.co.kr',
      credentialCommitment,
    });
    expect(request.response.status).toBe(201);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.to).toBe('reporter@acme.co.kr');
    expect((request.body as { developmentCode?: string }).developmentCode).toBe(deliveries[0]?.code);

    const challengeId = (request.body as { id: string }).id;
    const verify = await post(port, '/api/internal/verify', {
      challengeId,
      code: deliveries[0]?.code,
    });
    expect(verify.response.status).toBe(200);
    expect(issued).toEqual([credentialCommitment]);
    expect(verify.body).toEqual({ domain: 'acme.co.kr', credentialCommitment });
  }, 15_000);

  it('rejects requests from an unapproved browser origin', async () => {
    const server = await startIssuerServer({
      port: 0,
      allowedOrigin: 'http://127.0.0.1:4173',
      delivery: { async send() {} },
      registry: { async issueCredential() {}, async revokeCredential() {} },
    });
    running.push(server);
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { origin: 'https://attacker.example' },
    });
    expect(response.status).toBe(403);
  });

  it('requires valid proof-of-work before spending sponsor DUST', async () => {
    const server = await startIssuerServer({
      port: 0,
      allowedOrigin: 'http://127.0.0.1:4173',
      delivery: { async send() {} },
      registry: { async issueCredential() {}, async revokeCredential() {} },
      sponsor: {
        wallet: {} as SponsorOptions['wallet'],
        secrets: {} as SponsorOptions['secrets'],
        unshieldedKeystore: { signData: () => 'signature' },
        indexerHttpUrl: 'http://127.0.0.1:9999/graphql',
        contractAddress: 'contract-1',
      },
    });
    running.push(server);
    const port = (server.address() as AddressInfo).port;
    const response = await post(port, '/api/relay/submit', {
      tx: '00',
      reportCommitment: 'ab'.repeat(32),
      powNonce: -1,
    });
    expect(response.response.status).toBe(400);
  });

  it('restricts sponsored transactions to one report call on the configured contract', () => {
    const transaction = (address: string, entryPoint: string, extra = false) => ({
      intents: new Map([
        [
          1,
          {
            actions: [{ address, entryPoint }, ...(extra ? [{ address, entryPoint }] : [])],
          },
        ],
      ]),
    });

    expect(() =>
      assertSponsoredContractCall(transaction('contract-1', 'submitWhitehat') as never, 'contract-1'),
    ).not.toThrow();
    expect(() =>
      assertSponsoredContractCall(transaction('other-contract', 'submitWhitehat') as never, 'contract-1'),
    ).toThrow('unapproved contract');
    expect(() =>
      assertSponsoredContractCall(transaction('contract-1', 'issueCredential') as never, 'contract-1'),
    ).toThrow('submission circuits only');
    expect(() =>
      assertSponsoredContractCall(transaction('contract-1', 'submitWhitehat', true) as never, 'contract-1'),
    ).toThrow('exactly one');
  });

  it('resolves and approves an official whitehat destination', async () => {
    const approved: string[] = [];
    const server = await startIssuerServer({
      port: 0,
      allowedOrigin: 'http://127.0.0.1:4173',
      delivery: { async send() {} },
      registry: { async issueCredential() {}, async revokeCredential() {} },
      whitehat: {
        resolver: {
          async resolve(domain) {
            return {
              url: `https://${domain}/.well-known/security.txt`,
              contacts: [{ email: `security@${domain}`, source: 'test' }],
              expires: '2099-01-01T00:00:00Z',
            };
          },
        },
        registry: {
          async approveSecurityDestination(email) {
            approved.push(email);
          },
        },
      },
    });
    running.push(server);
    const port = (server.address() as AddressInfo).port;
    const result = await post(port, '/api/whitehat/qualify', { domain: 'acme.co.kr' });
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      mode: 'whitehat',
      domain: 'acme.co.kr',
      destinationEmail: 'security@acme.co.kr',
    });
    expect(approved).toEqual(['security@acme.co.kr']);
  });

  it('validates and forwards a verified report relay payload', async () => {
    const delivered: Array<{ ticket: string; to: string }> = [];
    const server = await startIssuerServer({
      port: 0,
      allowedOrigin: 'http://127.0.0.1:4173',
      delivery: { async send() {} },
      registry: { async issueCredential() {}, async revokeCredential() {} },
      reportRelay: {
        delivery: 'verified-local',
        relay: {
          async deliver(message) {
            delivered.push({ ticket: message.ticket, to: message.to });
          },
        },
      },
    });
    running.push(server);
    const port = (server.address() as AddressInfo).port;
    const hex = 'ab'.repeat(32);
    const result = await post(port, '/api/report/deliver', {
      ticket: hex,
      to: 'audit@acme.co.kr',
      subject: 'Verified report',
      body: {
        departmentOrAsset: 'Finance',
        title: 'Verified report',
        summary: 'Summary',
        details: 'Details',
      },
      verification: {
        mode: 'internal',
        reportCommitment: hex,
        destinationCommitment: hex,
        reportSalt: hex,
        nullifier: hex,
      },
    });
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ delivery: 'verified-local', duplicate: false });
    expect(delivered).toEqual([{ ticket: hex, to: 'audit@acme.co.kr' }]);
  });

  it('delivers each accepted ticket only once when the browser retries', async () => {
    let deliveries = 0;
    const server = await startIssuerServer({
      port: 0,
      allowedOrigin: 'http://127.0.0.1:4173',
      delivery: { async send() {} },
      registry: { async issueCredential() {}, async revokeCredential() {} },
      reportRelay: {
        delivery: 'verified-local',
        relay: {
          async deliver() {
            deliveries += 1;
          },
        },
      },
    });
    running.push(server);
    const port = (server.address() as AddressInfo).port;
    const hex = 'cd'.repeat(32);
    const payload = {
      ticket: hex,
      to: 'audit@acme.co.kr',
      subject: 'Verified report',
      body: {
        departmentOrAsset: 'Finance',
        title: 'Verified report',
        summary: 'Summary',
        details: 'Details',
      },
      verification: {
        mode: 'internal',
        reportCommitment: hex,
        destinationCommitment: hex,
        reportSalt: hex,
        nullifier: hex,
      },
    };

    const first = await post(port, '/api/report/deliver', payload);
    const retry = await post(port, '/api/report/deliver', payload);

    expect(first.response.status).toBe(200);
    expect(first.body).toMatchObject({ duplicate: false });
    expect(retry.response.status).toBe(200);
    expect(retry.body).toMatchObject({ duplicate: true });
    expect(deliveries).toBe(1);
  });

  it('accepts intact evidence and rejects attachment tampering before relay', async () => {
    const delivered: Array<{ name: string; size: number }> = [];
    const server = await startIssuerServer({
      port: 0,
      allowedOrigin: 'http://127.0.0.1:4173',
      delivery: { async send() {} },
      registry: { async issueCredential() {}, async revokeCredential() {} },
      reportRelay: {
        delivery: 'verified-local',
        relay: {
          async deliver(message) {
            delivered.push({ name: message.attachments[0]!.name, size: message.attachments[0]!.size });
          },
        },
      },
    });
    running.push(server);
    const port = (server.address() as AddressInfo).port;
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const hex = 'ab'.repeat(32);
    const payload = {
      ticket: hex,
      to: 'audit@acme.co.kr',
      subject: 'Verified report',
      body: {
        departmentOrAsset: 'Finance',
        title: 'Verified report',
        summary: 'Summary',
        details: 'Details',
      },
      verification: {
        mode: 'internal',
        reportCommitment: hex,
        destinationCommitment: hex,
        reportSalt: hex,
        nullifier: hex,
      },
      attachments: [
        {
          name: 'evidence.png',
          mediaType: 'image/png',
          size: bytes.byteLength,
          sha256: digest,
          contentBase64: bytes.toString('base64'),
        },
      ],
    };

    const accepted = await post(port, '/api/report/deliver', payload);
    expect(accepted.response.status).toBe(200);
    expect(delivered).toEqual([{ name: 'evidence.png', size: bytes.byteLength }]);

    const rejected = await post(port, '/api/report/deliver', {
      ...payload,
      attachments: [
        {
          ...payload.attachments[0],
          contentBase64: Buffer.alloc(bytes.byteLength, 4).toString('base64'),
        },
      ],
    });
    expect(rejected.response.status).toBe(400);
    expect(String((rejected.body as { error: string }).error)).toContain('digest verification failed');
    expect(delivered).toHaveLength(1);

    const disguised = Buffer.from('<script>alert(1)</script>');
    const disguisedResponse = await post(port, '/api/report/deliver', {
      ...payload,
      ticket: 'cd'.repeat(32),
      attachments: [
        {
          ...payload.attachments[0],
          size: disguised.byteLength,
          sha256: createHash('sha256').update(disguised).digest('hex'),
          contentBase64: disguised.toString('base64'),
        },
      ],
    });
    expect(disguisedResponse.response.status).toBe(400);
    expect(String((disguisedResponse.body as { error: string }).error)).toContain(
      'does not match its declared media type',
    );
  });
});

async function post(port: number, path: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:4173',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as unknown };
}
