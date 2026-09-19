import { destinationCommitment, randomSalt, randomSecret, reportCommitment } from './commitments.js';
import { LocalModerationAdapter } from './moderation.js';
import { solvePow, verifyPow } from './pow.js';
import { normalizePublicDestination, type PublicDestination } from './public-destinations.js';
import type { OtpService, PublicOtpChallenge } from './otp.js';
import type {
  CredentialCommitmentPort,
  CredentialRegistryPort,
  DestinationRegistryPort,
  ModerationPort,
  RelayPort,
  SubmissionLedgerPort,
} from './ports.js';
import { chooseSecurityContact, type SecurityTxt } from './security-txt.js';
import type {
  CredentialIssuance,
  InternalEnrollment,
  InternalQualification,
  PreparedSubmission,
  Qualification,
  Receipt,
  RelayMessage,
  ReportDraft,
  WhitehatQualification,
} from './types.js';
import { canonicalReport, normalizeDomain, normalizeEmail } from './validation.js';

type OtpRequestPort = Pick<OtpService, 'request'>;
type OtpVerificationPort = Pick<OtpService, 'verify'>;

/** Runs in the browser. The source email and secret stay in ephemeral client state. */
export async function createInternalEnrollment(
  emailInput: string,
  midnight: CredentialCommitmentPort,
): Promise<InternalEnrollment> {
  const { email, domain } = normalizeEmail(emailInput);
  const secret = randomSecret();
  const credentialCommitment = await midnight.createCredentialCommitment(domain, secret);
  return {
    mode: 'internal',
    email,
    domain,
    destinationEmail: `audit@${domain}`,
    credentialSecret: secret,
    credentialCommitment,
  };
}

/** Sends only the mailbox address and public credential commitment to the OTP boundary. */
export async function requestInternalOtp(
  enrollment: InternalEnrollment,
  otp: OtpRequestPort,
): Promise<PublicOtpChallenge> {
  return otp.request(enrollment.email, enrollment.credentialCommitment);
}

/** Runs in the trusted issuer boundary; it never receives the credential secret. */
export async function issueCredentialAfterOtp(
  challengeId: string,
  code: string,
  otp: OtpVerificationPort,
  registry: CredentialRegistryPort,
): Promise<CredentialIssuance> {
  const issuance = await otp.verify(challengeId, code);
  await registry.issueCredential(issuance.credentialCommitment);
  return issuance;
}

/** Returns only the data needed for a later proof and drops the source email. */
export function finalizeInternalQualification(
  enrollment: InternalEnrollment,
  issuance: CredentialIssuance,
): InternalQualification {
  if (
    enrollment.domain !== issuance.domain ||
    enrollment.credentialCommitment !== issuance.credentialCommitment
  )
    throw new Error('OTP issuance does not match the browser enrollment.');
  return {
    mode: 'internal',
    domain: enrollment.domain,
    destinationEmail: enrollment.destinationEmail,
    credentialSecret: enrollment.credentialSecret,
  };
}

/** Public resolution step. It performs no privileged registry mutation. */
export function createWhitehatQualification(
  domainInput: string,
  securityTxt: SecurityTxt,
): WhitehatQualification {
  const domain = normalizeDomain(domainInput);
  const destinationEmail = chooseSecurityContact(securityTxt, domain);
  return {
    mode: 'whitehat',
    channel: 'security-txt',
    domain,
    destinationEmail,
    securityTxtUrl: securityTxt.url,
  };
}

/** Builds a white-hat qualification for an operator-verified public-interest directory entry. */
export function createPublicDestinationQualification(
  destinationInput: PublicDestination,
): WhitehatQualification {
  const destination = normalizePublicDestination(destinationInput);
  const { domain } = normalizeEmail(destination.email);
  return {
    mode: 'whitehat',
    channel: 'public-directory',
    destinationId: destination.id,
    destinationCategory: destination.category,
    destinationLabel: destination.label,
    domain,
    destinationEmail: destination.email,
  };
}

/** Trusted oracle step. A production implementation re-resolves the policy before calling this. */
export async function approveWhitehatDestination(
  qualification: WhitehatQualification,
  registry: DestinationRegistryPort,
): Promise<void> {
  await registry.approveSecurityDestination(qualification.destinationEmail);
}

/** Convenience path for the deterministic CLI and tests only. */
export async function qualifyWhitehatForDemo(
  domainInput: string,
  securityTxt: SecurityTxt,
  registry: DestinationRegistryPort,
): Promise<WhitehatQualification> {
  const qualification = createWhitehatQualification(domainInput, securityTxt);
  await approveWhitehatDestination(qualification, registry);
  return qualification;
}

export async function prepareSubmission(
  qualification: Qualification,
  draft: ReportDraft,
): Promise<PreparedSubmission> {
  const reportSalt = randomSalt();
  const report = canonicalReport(draft);
  const reportHash = await reportCommitment(report, reportSalt);
  const destinationHash = await destinationCommitment(qualification.destinationEmail);
  const powNonce = await solvePow(reportHash);
  return {
    mode: qualification.mode,
    destinationEmail: qualification.destinationEmail,
    destinationDomain: qualification.domain,
    reportCommitment: reportHash,
    destinationCommitment: destinationHash,
    reportSalt,
    powNonce,
  };
}

export async function submitPreparedReport(
  qualification: Qualification,
  draft: ReportDraft,
  prepared: PreparedSubmission,
  midnight: SubmissionLedgerPort,
  relay: RelayPort,
  moderation: ModerationPort = new LocalModerationAdapter(),
): Promise<Receipt> {
  const report = canonicalReport(draft);
  if (prepared.mode !== qualification.mode) throw new Error('Prepared disclosure mode does not match.');
  if (
    prepared.destinationEmail !== qualification.destinationEmail ||
    prepared.destinationDomain !== qualification.domain
  )
    throw new Error('Prepared destination does not match the qualification.');
  if (prepared.reportSalt.byteLength !== 32) throw new Error('Report salt must be 32 bytes.');
  if ((await reportCommitment(report, prepared.reportSalt)) !== prepared.reportCommitment)
    throw new Error('Prepared report commitment does not match the report.');
  if ((await destinationCommitment(qualification.destinationEmail)) !== prepared.destinationCommitment)
    throw new Error('Prepared destination commitment does not match.');
  if (!(await verifyPow(prepared.reportCommitment, prepared.powNonce)))
    throw new Error('Client proof-of-work is invalid.');
  const decision = await moderation.classify(`${draft.title}\n${draft.summary}\n${draft.details}`);
  if (decision.decision === 'REJECT') throw new Error(decision.reason);
  const chainReceipt =
    qualification.mode === 'internal'
      ? await midnight.submitInternal({
          domain: qualification.domain,
          destinationEmail: qualification.destinationEmail,
          reportCommitment: prepared.reportCommitment,
          secret: qualification.credentialSecret,
          salt: prepared.reportSalt,
        })
      : await midnight.submitWhitehat({
          destinationEmail: qualification.destinationEmail,
          reportCommitment: prepared.reportCommitment,
          salt: prepared.reportSalt,
        });
  const receipt = { ...prepared, ...chainReceipt, createdAt: new Date().toISOString() } satisfies Receipt;
  const message: RelayMessage = {
    ticket: chainReceipt.ticket,
    to: qualification.destinationEmail,
    subject: draft.title,
    body: draft,
    verification: {
      mode: qualification.mode,
      reportCommitment: prepared.reportCommitment,
      destinationCommitment: prepared.destinationCommitment,
      reportSalt: prepared.reportSalt,
      nullifier: chainReceipt.nullifier,
    },
    attachments: [],
  };
  await relay.deliver(message);
  return receipt;
}

/** Convenience path for deterministic tests and the keyless CLI demo only. */
export async function submitReportForDemo(
  qualification: Qualification,
  draft: ReportDraft,
  midnight: SubmissionLedgerPort,
  relay: RelayPort,
  moderation: ModerationPort = new LocalModerationAdapter(),
): Promise<Receipt> {
  const prepared = await prepareSubmission(qualification, draft);
  return submitPreparedReport(qualification, draft, prepared, midnight, relay, moderation);
}

export class InMemoryRelay implements RelayPort {
  readonly delivered: RelayMessage[] = [];
  async deliver(message: RelayMessage): Promise<void> {
    this.delivered.push(structuredClone(message));
  }
}
