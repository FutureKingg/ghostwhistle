import { describe, expect, it } from 'vitest';
import {
  DemoMidnightAdapter,
  InMemoryOtpStore,
  InMemoryRelay,
  OtpService,
  SlidingWindowRateLimiter,
  approveWhitehatDestination,
  chooseSecurityContact,
  createInternalEnrollment,
  createWhitehatQualification,
  finalizeInternalQualification,
  issueCredentialAfterOtp,
  parseSecurityTxt,
  prepareSubmission,
  requestInternalOtp,
  solvePow,
  submitPreparedReport,
  submitReportForDemo,
  verifyPow,
  type InternalQualification,
  type ReportDraft,
} from './index';

const draft: ReportDraft = {
  departmentOrAsset: 'Finance',
  title: 'Unauthorized transfer',
  summary: 'A transfer was sent to an unapproved account.',
  details: 'The approval record and destination account do not match.',
};

const attachment = {
  name: 'invoice.png',
  mediaType: 'image/png',
  size: 4,
  sha256: 'ab'.repeat(32),
};

async function qualifyInternalViaOtp(midnight: DemoMidnightAdapter): Promise<InternalQualification> {
  let deliveredCode = '';
  const otp = new OtpService(
    new InMemoryOtpStore(),
    {
      async send({ code }) {
        deliveredCode = code;
      },
    },
    { createId: () => 'challenge-1', createCode: () => '123456' },
  );
  const enrollment = await createInternalEnrollment('hana@acme.co.kr', midnight);
  const challenge = await requestInternalOtp(enrollment, otp);
  const issuance = await issueCredentialAfterOtp(challenge.id, deliveredCode, otp, midnight);
  return finalizeInternalQualification(enrollment, issuance);
}

describe('GhostWhistle functional core', () => {
  it('proves an internal credential without exposing the email to the ledger adapter', async () => {
    const midnight = new DemoMidnightAdapter();
    const relay = new InMemoryRelay();
    const qualification = await qualifyInternalViaOtp(midnight);
    const receipt = await submitReportForDemo(qualification, draft, midnight, relay);

    expect(receipt.ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(relay.delivered[0].to).toBe('audit@acme.co.kr');
    expect(await midnight.verify(relay.delivered[0])).toBe(true);
    expect(midnight.snapshot()).toEqual({
      credentials: 1,
      revokedCredentials: 0,
      approvedDestinations: 0,
      tickets: 1,
    });
  });

  it('rejects destination or report tampering before relay', async () => {
    const midnight = new DemoMidnightAdapter();
    const relay = new InMemoryRelay();
    const qualification = await qualifyInternalViaOtp(midnight);
    await submitReportForDemo(qualification, draft, midnight, relay);
    const original = relay.delivered[0];

    await expect(midnight.verify({ ...original, to: 'ceo@acme.co.kr' })).resolves.toBe(false);
    await expect(
      midnight.verify({ ...original, body: { ...original.body, details: 'tampered' } }),
    ).resolves.toBe(false);
    await expect(
      midnight.verify({
        ...original,
        verification: { ...original.verification, nullifier: '0'.repeat(64) },
      }),
    ).resolves.toBe(false);
  });

  it('binds evidence metadata and content digest into the report commitment', async () => {
    const midnight = new DemoMidnightAdapter();
    const relay = new InMemoryRelay();
    const qualification = await qualifyInternalViaOtp(midnight);
    await submitReportForDemo(qualification, { ...draft, attachments: [attachment] }, midnight, relay);
    const original = relay.delivered[0];

    await expect(midnight.verify(original)).resolves.toBe(true);
    await expect(
      midnight.verify({
        ...original,
        body: {
          ...original.body,
          attachments: [{ ...attachment, sha256: 'cd'.repeat(32) }],
        },
      }),
    ).resolves.toBe(false);
  });

  it('does not accept an arbitrary same-domain internal mailbox', async () => {
    const midnight = new DemoMidnightAdapter();
    const qualification = await qualifyInternalViaOtp(midnight);
    const prepared = await prepareSubmission(qualification, draft);
    await expect(
      midnight.submitInternal({
        domain: qualification.domain,
        destinationEmail: 'ceo@acme.co.kr',
        reportCommitment: prepared.reportCommitment,
        secret: qualification.credentialSecret,
        salt: prepared.reportSalt,
      }),
    ).rejects.toThrow('locked audit mailbox');
  });

  it('delegates credential hashing to the Midnight port', async () => {
    const midnight = new DemoMidnightAdapter();
    const original = midnight.createCredentialCommitment.bind(midnight);
    let called = false;
    midnight.createCredentialCommitment = async (domain, secret) => {
      called = domain === 'acme.co.kr' && secret.byteLength === 32;
      return original(domain, secret);
    };
    await createInternalEnrollment('hana@acme.co.kr', midnight);
    expect(called).toBe(true);
  });

  it('rejects replay of the exact same nullifier', async () => {
    const midnight = new DemoMidnightAdapter();
    const qualification = await qualifyInternalViaOtp(midnight);
    const prepared = await prepareSubmission(qualification, draft);
    const input = {
      domain: qualification.domain,
      destinationEmail: qualification.destinationEmail,
      reportCommitment: prepared.reportCommitment,
      secret: qualification.credentialSecret,
      salt: prepared.reportSalt,
    };

    await expect(midnight.submitInternal(input)).resolves.toMatchObject({
      ticket: expect.stringMatching(/^[0-9a-f]{64}$/),
      nullifier: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    await expect(midnight.submitInternal(input)).rejects.toThrow('already been accepted');
  });

  it('allows only same-domain security.txt contacts', async () => {
    const parsed = parseSecurityTxt(
      'Contact: mailto:security@acme.co.kr\nContact: https://other.test/report\nPolicy: https://acme.co.kr/security',
      'https://acme.co.kr/.well-known/security.txt',
    );
    expect(chooseSecurityContact(parsed, 'acme.co.kr')).toBe('security@acme.co.kr');
  });

  it('submits a white-hat report only after security.txt destination approval', async () => {
    const midnight = new DemoMidnightAdapter();
    const relay = new InMemoryRelay();
    const securityTxt = parseSecurityTxt(
      'Contact: mailto:vulnerability@acme.co.kr',
      'https://acme.co.kr/.well-known/security.txt',
    );
    const qualification = createWhitehatQualification('acme.co.kr', securityTxt);
    expect(midnight.snapshot().approvedDestinations).toBe(0);
    await approveWhitehatDestination(qualification, midnight);
    const receipt = await submitReportForDemo(qualification, draft, midnight, relay);

    expect(receipt.destinationEmail).toBe('vulnerability@acme.co.kr');
    expect(midnight.snapshot()).toEqual({
      credentials: 0,
      revokedCredentials: 0,
      approvedDestinations: 1,
      tickets: 1,
    });
    expect(relay.delivered[0].to).toBe('vulnerability@acme.co.kr');
  });

  it('does not accept a cross-domain security.txt email', async () => {
    const midnight = new DemoMidnightAdapter();
    const malicious = parseSecurityTxt(
      'Contact: mailto:attacker@elsewhere.test',
      'https://acme.co.kr/.well-known/security.txt',
    );
    expect(() => createWhitehatQualification('acme.co.kr', malicious)).toThrow(
      'must belong to the target domain',
    );
  });

  it('rejects a revoked organization credential', async () => {
    const midnight = new DemoMidnightAdapter();
    const qualification = await qualifyInternalViaOtp(midnight);
    const credential = await midnight.createCredentialCommitment(
      qualification.domain,
      qualification.credentialSecret,
    );
    await midnight.revokeCredential(credential);
    await expect(submitReportForDemo(qualification, draft, midnight, new InMemoryRelay())).rejects.toThrow(
      'revoked',
    );
  });

  it('rejects a tampered client preparation before creating a chain ticket', async () => {
    const midnight = new DemoMidnightAdapter();
    const relay = new InMemoryRelay();
    const qualification = await qualifyInternalViaOtp(midnight);
    const prepared = await prepareSubmission(qualification, draft);
    prepared.reportCommitment = '0'.repeat(64);

    await expect(submitPreparedReport(qualification, draft, prepared, midnight, relay)).rejects.toThrow(
      'does not match the report',
    );
    expect(midnight.snapshot().tickets).toBe(0);
    expect(relay.delivered).toHaveLength(0);
  });

  it('enforces a bounded in-memory rate window', () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(2, 100, () => now);
    expect(limiter.consume('acme.co.kr').remaining).toBe(1);
    expect(limiter.consume('acme.co.kr').remaining).toBe(0);
    expect(() => limiter.consume('acme.co.kr')).toThrow('Rate limit exceeded');
    now += 101;
    expect(limiter.consume('acme.co.kr').remaining).toBe(1);
  });

  it('solves browser proof-of-work in bounded batches', async () => {
    const policy = { leadingZeroBits: 8, maxIterations: 10_000 };
    const nonce = await solvePow('a'.repeat(64), policy, 32);
    expect(await verifyPow('a'.repeat(64), nonce, policy)).toBe(true);
  });
});
