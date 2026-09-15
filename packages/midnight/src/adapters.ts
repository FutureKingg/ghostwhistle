import type {
  CredentialCommitmentPort,
  CredentialRegistryPort,
  DestinationRegistryPort,
  SubmissionLedgerPort,
  TicketVerifierPort,
} from '@ghostwhistle/core';
import { GhostWhistleContractClient } from './client.js';

export class MidnightReporterAdapter
  implements CredentialCommitmentPort, SubmissionLedgerPort, TicketVerifierPort
{
  constructor(private readonly client: GhostWhistleContractClient) {}

  createCredentialCommitment(domain: string, secret: Uint8Array): Promise<string> {
    return this.client.deriveCredentialAsync(domain, secret);
  }

  submitInternal(input: Parameters<SubmissionLedgerPort['submitInternal']>[0]) {
    return this.client.submitInternal(input);
  }

  submitWhitehat(input: Parameters<SubmissionLedgerPort['submitWhitehat']>[0]) {
    return this.client.submitWhitehat(input);
  }

  verify(message: Parameters<TicketVerifierPort['verify']>[0]): Promise<boolean> {
    return this.client.verifyRelayMessage(message);
  }
}

export class MidnightCredentialIssuerAdapter implements CredentialRegistryPort {
  constructor(
    private readonly client: GhostWhistleContractClient,
    private readonly issuerSecret: Uint8Array,
  ) {}

  issueCredential(credentialCommitment: string): Promise<void> {
    return this.client.issueCredential(credentialCommitment, this.issuerSecret);
  }

  revokeCredential(credentialCommitment: string): Promise<void> {
    return this.client.revokeCredential(credentialCommitment, this.issuerSecret);
  }
}

export class MidnightDestinationOracleAdapter implements DestinationRegistryPort {
  constructor(
    private readonly client: GhostWhistleContractClient,
    private readonly oracleSecret: Uint8Array,
  ) {}

  approveSecurityDestination(email: string): Promise<void> {
    return this.client.approveSecurityDestination(email, this.oracleSecret);
  }
}
