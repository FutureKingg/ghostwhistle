import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Receipt, RelayAttachment, ReportDraft } from '@ghostwhistle/core';
import { deliverVerifiedReport, listPublicDestinations } from './issuer-api';

const receipt: Receipt = {
  mode: 'internal',
  destinationEmail: 'audit@acme.co.kr',
  destinationDomain: 'acme.co.kr',
  reportCommitment: 'ab'.repeat(32),
  destinationCommitment: 'cd'.repeat(32),
  reportSalt: Uint8Array.from({ length: 32 }, (_, index) => index),
  powNonce: 7,
  ticket: 'ef'.repeat(32),
  nullifier: '12'.repeat(32),
  transactionId: '34'.repeat(32),
  createdAt: '2026-09-15T00:00:00.000Z',
};

const draft: ReportDraft = {
  departmentOrAsset: 'Finance',
  title: 'Evidence of duplicate payments',
  summary: 'Invoices were paid twice.',
  details: 'The attached export contains the affected transaction identifiers.',
  attachments: [{ name: 'proof.csv', mediaType: 'text/csv', size: 3, sha256: '56'.repeat(32) }],
};

const attachments: RelayAttachment[] = [{ ...draft.attachments![0]!, contentBase64: 'MSwy' }];

describe('issuer API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the accepted ticket proof and evidence bytes to the relay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ delivery: 'email', duplicate: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(deliverVerifiedReport(receipt, draft, attachments)).resolves.toEqual({
      delivery: 'email',
      duplicate: false,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/api/report/deliver');
    const body = JSON.parse(String(init.body));
    expect(body.ticket).toBe(receipt.ticket);
    expect(body.verification.reportSalt).toBe(
      Array.from(receipt.reportSalt, (value) => value.toString(16).padStart(2, '0')).join(''),
    );
    expect(body.attachments).toEqual(attachments);
  });

  it('surfaces safe server errors and hides network details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Ticket verification failed.' }), { status: 400 }),
        ),
    );
    await expect(deliverVerifiedReport(receipt, draft)).rejects.toThrow('Ticket verification failed.');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket detail')));
    await expect(deliverVerifiedReport(receipt, draft)).rejects.toThrow(
      '로컬 issuer API에 연결할 수 없습니다',
    );
  });

  it('loads the operator-curated public destination directory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            destinations: [
              {
                id: 'demo-journalist',
                category: 'journalist',
                organization: 'Demo Desk',
                label: 'Tips',
                email: 'tips@news.example',
                description: 'Verified test destination.',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(listPublicDestinations()).resolves.toMatchObject([
      { id: 'demo-journalist', email: 'tips@news.example' },
    ]);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/api/public/destinations');
    expect(init.method).toBe('GET');
  });
});
