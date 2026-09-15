import {
  DemoMidnightAdapter,
  InMemoryOtpStore,
  InMemoryRelay,
  OtpService,
  createInternalEnrollment,
  finalizeInternalQualification,
  issueCredentialAfterOtp,
  parseSecurityTxt,
  qualifyWhitehatForDemo,
  requestInternalOtp,
  submitReportForDemo,
} from '@ghostwhistle/core';

const line = '─'.repeat(68);
const midnight = new DemoMidnightAdapter();
const relay = new InMemoryRelay();

console.log('\nGhostWhistle functional demo');
console.log(line);

let demoOtpCode = '';
const otp = new OtpService(
  new InMemoryOtpStore(),
  {
    async send({ code }) {
      demoOtpCode = code;
    },
  },
  { createId: () => 'demo-challenge', createCode: () => '123456' },
);
const enrollment = await createInternalEnrollment('hana@acme.co.kr', midnight);
const challenge = await requestInternalOtp(enrollment, otp);
const issuance = await issueCredentialAfterOtp(challenge.id, demoOtpCode, otp, midnight);
const internalQualification = finalizeInternalQualification(enrollment, issuance);
const internalReceipt = await submitReportForDemo(
  internalQualification,
  {
    departmentOrAsset: 'Finance operations',
    title: 'Unapproved split transfers',
    summary: 'Repeated transfers went to accounts absent from the approval record.',
    details: 'The voucher account and actual beneficiary account differ. Please open an independent audit.',
  },
  midnight,
  relay,
);

console.log('✓ Mailbox OTP verified; credential commitment issued without the client secret');
console.log(`✓ Destination locked: ${internalReceipt.destinationEmail}`);
console.log(`✓ Report committed:   ${internalReceipt.reportCommitment}`);
console.log(`✓ Ticket accepted:    ${internalReceipt.ticket}`);

const whitehatQualification = await qualifyWhitehatForDemo(
  'example.com',
  parseSecurityTxt(
    'Contact: mailto:security@example.com\nPolicy: https://example.com/security-policy',
    'https://example.com/.well-known/security.txt',
  ),
  midnight,
);
const whitehatReceipt = await submitReportForDemo(
  whitehatQualification,
  {
    departmentOrAsset: 'Export API',
    title: 'Cross-tenant invoice export',
    summary: 'A tenant can request another tenant’s export by changing an identifier.',
    details:
      'Testing was limited to accounts I control. Validate tenant ownership before loading the export object.',
  },
  midnight,
  relay,
);

console.log(line);
console.log('✓ security.txt destination approved');
console.log(`✓ Destination locked: ${whitehatReceipt.destinationEmail}`);
console.log(`✓ Ticket accepted:    ${whitehatReceipt.ticket}`);
console.log(line);
console.log('Public ledger model:', midnight.snapshot());
console.log(
  'Relay deliveries:',
  relay.delivered.map(({ to, ticket }) => ({ to, ticket })),
);
console.log('No source email, credential secret, or report body exists in ledger state.\n');
