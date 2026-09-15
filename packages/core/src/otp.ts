import { commitment } from './commitments.js';
import { invalidInput, policyViolation } from './errors.js';
import { normalizeEmail } from './validation.js';

export type OtpChallenge = {
  id: string;
  email: string;
  domain: string;
  credentialCommitment: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

export type PublicOtpChallenge = Pick<OtpChallenge, 'id' | 'domain' | 'expiresAt'> & {
  /** Present only in an explicitly enabled local undeployed demo. */
  developmentCode?: string;
};

export type OtpAttemptResult =
  | { status: 'verified'; challenge: OtpChallenge }
  | { status: 'not-found' | 'expired' | 'too-many-attempts' | 'incorrect' };

export interface OtpStore {
  put(challenge: OtpChallenge): Promise<void>;
  attempt(input: {
    id: string;
    candidateHash: string;
    now: number;
    maxAttempts: number;
  }): Promise<OtpAttemptResult>;
  delete(id: string): Promise<void>;
}

export interface OtpDeliveryPort {
  send(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>;
}

export class InMemoryOtpStore implements OtpStore {
  private readonly data = new Map<string, OtpChallenge>();
  async put(challenge: OtpChallenge) {
    this.data.set(challenge.id, structuredClone(challenge));
  }
  async attempt(input: {
    id: string;
    candidateHash: string;
    now: number;
    maxAttempts: number;
  }): Promise<OtpAttemptResult> {
    const challenge = this.data.get(input.id);
    if (!challenge) return { status: 'not-found' };
    if (challenge.expiresAt <= input.now) {
      this.data.delete(input.id);
      return { status: 'expired' };
    }
    challenge.attempts += 1;
    if (challenge.attempts > input.maxAttempts) {
      this.data.delete(input.id);
      return { status: 'too-many-attempts' };
    }
    if (challenge.codeHash !== input.candidateHash) return { status: 'incorrect' };
    this.data.delete(input.id);
    return { status: 'verified', challenge: structuredClone(challenge) };
  }
  async delete(id: string) {
    this.data.delete(id);
  }
}

export class OtpService {
  constructor(
    private readonly store: OtpStore,
    private readonly delivery: OtpDeliveryPort,
    private readonly options: {
      ttlMs?: number;
      maxAttempts?: number;
      now?: () => number;
      createId?: () => string;
      createCode?: () => string;
    } = {},
  ) {}

  async request(emailInput: string, credentialCommitment: string): Promise<PublicOtpChallenge> {
    if (!/^[0-9a-f]{64}$/i.test(credentialCommitment))
      throw invalidInput('Credential commitment must be 32 bytes.');
    const { email, domain } = normalizeEmail(emailInput);
    const ttlMs = this.options.ttlMs ?? 5 * 60 * 1000;
    const code =
      this.options.createCode?.() ??
      crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(6, '0').slice(-6);
    const id = this.options.createId?.() ?? crypto.randomUUID();
    const expiresAt = (this.options.now?.() ?? Date.now()) + ttlMs;
    const challenge: OtpChallenge = {
      id,
      email,
      domain,
      credentialCommitment,
      codeHash: await commitment('otp', id, code),
      expiresAt,
      attempts: 0,
    };
    await this.store.put(challenge);
    try {
      await this.delivery.send({ to: email, code, expiresInMinutes: Math.ceil(ttlMs / 60_000) });
    } catch (error) {
      await this.store.delete(id);
      throw error;
    }
    return { id, domain, expiresAt };
  }

  async verify(id: string, code: string): Promise<{ domain: string; credentialCommitment: string }> {
    const now = this.options.now?.() ?? Date.now();
    const maxAttempts = this.options.maxAttempts ?? 5;
    const result = await this.store.attempt({
      id,
      candidateHash: await commitment('otp', id, code),
      now,
      maxAttempts,
    });
    switch (result.status) {
      case 'not-found':
        throw invalidInput('OTP challenge was not found.');
      case 'expired':
        throw policyViolation('OTP challenge has expired.');
      case 'too-many-attempts':
        throw policyViolation('Too many OTP attempts.');
      case 'incorrect':
        throw invalidInput('OTP code is incorrect.');
      case 'verified':
        return {
          domain: result.challenge.domain,
          credentialCommitment: result.challenge.credentialCommitment,
        };
    }
  }
}
