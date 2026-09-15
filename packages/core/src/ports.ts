import type { SecurityTxt } from './security-txt.js';
import type { ChainReceipt, ModerationDecision, RelayMessage, Receipt } from './types.js';

export interface MidnightPort {
  createCredentialCommitment(domain: string, secret: Uint8Array): Promise<string>;
  issueCredential(credentialCommitment: string): Promise<void>;
  revokeCredential(credentialCommitment: string): Promise<void>;
  approveSecurityDestination(email: string): Promise<void>;
  submitInternal(input: {
    domain: string;
    destinationEmail: string;
    reportCommitment: string;
    secret: Uint8Array;
    salt: Uint8Array;
  }): Promise<ChainReceipt>;
  submitWhitehat(input: {
    destinationEmail: string;
    reportCommitment: string;
    salt: Uint8Array;
  }): Promise<ChainReceipt>;
}

export type CredentialCommitmentPort = Pick<MidnightPort, 'createCredentialCommitment'>;
export type CredentialRegistryPort = Pick<MidnightPort, 'issueCredential' | 'revokeCredential'>;
export type DestinationRegistryPort = Pick<MidnightPort, 'approveSecurityDestination'>;
export type SubmissionLedgerPort = Pick<MidnightPort, 'submitInternal' | 'submitWhitehat'>;

export interface RelayPort {
  deliver(message: RelayMessage): Promise<void>;
}

export interface TicketVerifierPort {
  verify(message: RelayMessage): Promise<boolean>;
}

export interface ModerationPort {
  classify(text: string): Promise<ModerationDecision>;
}

export interface SecurityTxtResolverPort {
  resolve(domain: string): Promise<SecurityTxt>;
}

export interface SubmissionStore {
  save(receipt: Receipt): Promise<void>;
}
