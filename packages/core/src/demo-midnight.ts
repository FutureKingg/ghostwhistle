import {
  credentialCommitment,
  destinationCommitment,
  domainCommitment,
  internalDestinationCommitment,
  nullifier,
  reportCommitment,
  ticketCommitment,
} from './commitments.js';
import { duplicateSubmission, policyViolation } from './errors.js';
import type { MidnightPort, TicketVerifierPort } from './ports.js';
import type { RelayMessage } from './types.js';
import { canonicalReport, isOfficialDestination } from './validation.js';

/** In-memory adapter for deterministic local demos and tests. It mirrors the Compact invariants. */
export class DemoMidnightAdapter implements MidnightPort, TicketVerifierPort {
  private readonly credentials = new Set<string>();
  private readonly revokedCredentials = new Set<string>();
  private readonly approvedDestinations = new Set<string>();
  private readonly nullifiers = new Set<string>();
  private readonly tickets = new Set<string>();

  async createCredentialCommitment(domain: string, secret: Uint8Array): Promise<string> {
    return credentialCommitment(domain, secret);
  }

  async issueCredential(credential: string): Promise<void> {
    this.credentials.add(credential);
  }

  async revokeCredential(credential: string): Promise<void> {
    if (!this.credentials.has(credential)) throw policyViolation('Credential does not exist.');
    this.revokedCredentials.add(credential);
  }

  async approveSecurityDestination(email: string): Promise<void> {
    this.approvedDestinations.add(await destinationCommitment(email));
  }

  async submitInternal(input: {
    domain: string;
    destinationEmail: string;
    reportCommitment: string;
    secret: Uint8Array;
    salt: Uint8Array;
  }): Promise<{ ticket: string; nullifier: string }> {
    const credential = await credentialCommitment(input.domain, input.secret);
    if (!this.credentials.has(credential))
      throw policyViolation('No issued credential opens to this secret.');
    if (this.revokedCredentials.has(credential)) throw policyViolation('Credential has been revoked.');
    if (!isOfficialDestination(input.destinationEmail, input.domain, 'audit'))
      throw policyViolation('Internal destination is not the locked audit mailbox.');
    return this.accept(
      'internal',
      input.destinationEmail,
      input.reportCommitment,
      input.secret,
      input.salt,
      input.domain,
    );
  }

  async submitWhitehat(input: {
    destinationEmail: string;
    reportCommitment: string;
    salt: Uint8Array;
  }): Promise<{ ticket: string; nullifier: string }> {
    if (!this.approvedDestinations.has(await destinationCommitment(input.destinationEmail)))
      throw policyViolation('Destination is not approved.');
    return this.accept(
      'whitehat',
      input.destinationEmail,
      input.reportCommitment,
      new Uint8Array(32),
      input.salt,
    );
  }

  async verify(message: RelayMessage): Promise<boolean> {
    if (!this.tickets.has(message.ticket)) return false;
    const destinationDomain = message.to.split('@')[1];
    if (
      message.verification.mode === 'internal' &&
      (!destinationDomain || !isOfficialDestination(message.to, destinationDomain, 'audit'))
    )
      return false;
    const expectedDestination = await destinationCommitment(message.to);
    const ticketDestination =
      message.verification.mode === 'internal'
        ? await internalDestinationCommitment(await domainCommitment(destinationDomain!), expectedDestination)
        : expectedDestination;
    const expectedReport = await reportCommitment(
      canonicalReport(message.body),
      message.verification.reportSalt,
    );
    const expectedTicket = await ticketCommitment(
      message.verification.mode,
      ticketDestination,
      message.verification.reportCommitment,
      message.verification.nullifier,
    );
    return (
      message.subject === message.body.title &&
      expectedDestination === message.verification.destinationCommitment &&
      expectedReport === message.verification.reportCommitment &&
      expectedTicket === message.ticket
    );
  }

  private async accept(
    mode: 'internal' | 'whitehat',
    destinationEmail: string,
    report: string,
    secret: Uint8Array,
    salt: Uint8Array,
    internalDomain?: string,
  ): Promise<{ ticket: string; nullifier: string }> {
    const marker = await nullifier(secret, report, salt);
    if (this.nullifiers.has(marker)) throw duplicateSubmission();
    const destinationHash = await destinationCommitment(destinationEmail);
    const ticketDestination = internalDomain
      ? await internalDestinationCommitment(await domainCommitment(internalDomain), destinationHash)
      : destinationHash;
    const ticket = await ticketCommitment(mode, ticketDestination, report, marker);
    this.nullifiers.add(marker);
    this.tickets.add(ticket);
    return { ticket, nullifier: marker };
  }

  snapshot() {
    return {
      credentials: this.credentials.size,
      revokedCredentials: this.revokedCredentials.size,
      approvedDestinations: this.approvedDestinations.size,
      tickets: this.tickets.size,
    };
  }
}
