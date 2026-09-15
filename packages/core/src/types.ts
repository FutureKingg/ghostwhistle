export type DisclosureMode = 'internal' | 'whitehat';

export type ReportAttachment = {
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
};

export type RelayAttachment = ReportAttachment & {
  contentBase64: string;
};

export type ReportDraft = {
  departmentOrAsset: string;
  title: string;
  summary: string;
  details: string;
  attachments?: ReportAttachment[];
};

export type InternalQualification = {
  mode: 'internal';
  domain: string;
  destinationEmail: string;
  credentialSecret: Uint8Array;
};

export type InternalEnrollment = InternalQualification & {
  email: string;
  credentialCommitment: string;
};

export type CredentialIssuance = {
  domain: string;
  credentialCommitment: string;
};

export type WhitehatQualification = {
  mode: 'whitehat';
  domain: string;
  destinationEmail: string;
  securityTxtUrl: string;
};

export type Qualification = InternalQualification | WhitehatQualification;

export type PreparedSubmission = {
  mode: DisclosureMode;
  destinationEmail: string;
  destinationDomain: string;
  reportCommitment: string;
  destinationCommitment: string;
  reportSalt: Uint8Array;
  powNonce: number;
};

export type ChainReceipt = {
  ticket: string;
  nullifier: string;
  transactionId?: string;
};

export type Receipt = PreparedSubmission &
  ChainReceipt & {
    createdAt: string;
  };

export type RelayMessage = {
  ticket: string;
  to: string;
  subject: string;
  body: ReportDraft;
  verification: {
    mode: DisclosureMode;
    reportCommitment: string;
    destinationCommitment: string;
    reportSalt: Uint8Array;
    nullifier: string;
  };
  attachments: RelayAttachment[];
};

export type ModerationDecision = {
  decision: 'PASS' | 'REJECT';
  category: 'report' | 'abuse' | 'spam' | 'active-threat' | 'unclear';
  reason: string;
};
