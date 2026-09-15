import { describe, expect, it } from 'vitest';
import { commitment } from './commitments';
import { InMemoryOtpStore, OtpService, type OtpDeliveryPort } from './otp';

class CapturingDelivery implements OtpDeliveryPort {
  last?: { to: string; code: string; expiresInMinutes: number };
  async send(input: { to: string; code: string; expiresInMinutes: number }) {
    this.last = input;
  }
}

describe('OtpService', () => {
  it('stores a hashed challenge and returns a verified commitment', async () => {
    const delivery = new CapturingDelivery();
    const service = new OtpService(new InMemoryOtpStore(), delivery, {
      createCode: () => '042911',
      createId: () => 'challenge-1',
      now: () => 1_000,
    });
    const credential = await commitment('credential-test');
    const challenge = await service.request('Hana@Acme.co.kr', credential);

    expect(challenge).toEqual({ id: 'challenge-1', domain: 'acme.co.kr', expiresAt: 301_000 });
    expect(delivery.last).toEqual({ to: 'hana@acme.co.kr', code: '042911', expiresInMinutes: 5 });
    await expect(service.verify(challenge.id, '042911')).resolves.toEqual({
      domain: 'acme.co.kr',
      credentialCommitment: credential,
    });
    await expect(service.verify(challenge.id, '042911')).rejects.toThrow('not found');
  });

  it('expires challenges and limits guesses', async () => {
    let now = 1_000;
    const delivery = new CapturingDelivery();
    const service = new OtpService(new InMemoryOtpStore(), delivery, {
      createCode: () => '111111',
      createId: () => 'challenge-2',
      now: () => now,
      ttlMs: 100,
      maxAttempts: 2,
    });
    const credential = await commitment('credential-test');
    await service.request('hana@acme.co.kr', credential);
    await expect(service.verify('challenge-2', '000000')).rejects.toThrow('incorrect');
    await expect(service.verify('challenge-2', '000000')).rejects.toThrow('incorrect');
    await expect(service.verify('challenge-2', '000000')).rejects.toThrow('Too many');

    const expiryService = new OtpService(new InMemoryOtpStore(), delivery, {
      createCode: () => '111111',
      createId: () => 'challenge-3',
      now: () => now,
      ttlMs: 100,
    });
    await expiryService.request('hana@acme.co.kr', credential);
    now = 1_101;
    await expect(expiryService.verify('challenge-3', '111111')).rejects.toThrow('expired');
  });

  it('removes the challenge when OTP delivery fails', async () => {
    const store = new InMemoryOtpStore();
    const service = new OtpService(
      store,
      { send: async () => Promise.reject(new Error('mail unavailable')) },
      { createCode: () => '111111', createId: () => 'challenge-4' },
    );
    const credential = await commitment('credential-test');
    await expect(service.request('hana@acme.co.kr', credential)).rejects.toThrow('mail unavailable');
    await expect(service.verify('challenge-4', '111111')).rejects.toThrow('not found');
  });

  it('atomically consumes a valid challenge only once', async () => {
    const delivery = new CapturingDelivery();
    const service = new OtpService(new InMemoryOtpStore(), delivery, {
      createCode: () => '111111',
      createId: () => 'challenge-5',
    });
    const credential = await commitment('credential-test');
    await service.request('hana@acme.co.kr', credential);
    const results = await Promise.allSettled([
      service.verify('challenge-5', '111111'),
      service.verify('challenge-5', '111111'),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  });
});
