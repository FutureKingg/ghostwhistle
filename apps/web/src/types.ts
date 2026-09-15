export type DisclosureMode = 'internal' | 'whitehat';
export type AppStep = 'qualify' | 'compose' | 'prove' | 'receipt';

export type ReportDraft = {
  department: string;
  title: string;
  summary: string;
  details: string;
};

export type ProofReceipt = {
  ticket: string;
  reportCommitment: string;
  destinationCommitment: string;
  powNonce: number;
  createdAt: string;
  nullifier?: string;
  transactionId?: string;
  source?: 'demo' | 'live';
  delivery?: 'email' | 'verified-local' | 'failed';
  deliveryError?: string;
  attachmentCount?: number;
  attachmentBytes?: number;
};
