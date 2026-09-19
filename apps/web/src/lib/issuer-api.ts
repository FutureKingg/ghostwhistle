import { bytesToHex } from '@ghostwhistle/core';
import type {
  CredentialIssuance,
  InternalEnrollment,
  ModerationDecision,
  PublicDestination,
  PublicOtpChallenge,
  Receipt,
  RelayAttachment,
  ReportDraft,
  WhitehatQualification,
} from '@ghostwhistle/core';

const baseUrl = (import.meta.env.VITE_ISSUER_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

export async function requestInternalOtp(enrollment: InternalEnrollment): Promise<PublicOtpChallenge> {
  return post('/api/internal/request', {
    email: enrollment.email,
    credentialCommitment: enrollment.credentialCommitment,
  });
}

export async function verifyInternalOtp(challengeId: string, code: string): Promise<CredentialIssuance> {
  return post('/api/internal/verify', { challengeId, code });
}

export async function qualifyWhitehat(domain: string): Promise<WhitehatQualification> {
  return post('/api/whitehat/qualify', { domain });
}

export async function listPublicDestinations(): Promise<PublicDestination[]> {
  const response = await get<{ destinations: PublicDestination[] }>('/api/public/destinations');
  return response.destinations;
}

export async function qualifyPublicDestination(destinationId: string): Promise<WhitehatQualification> {
  return post('/api/public/qualify', { destinationId });
}

export async function moderateReport(
  draft: Pick<ReportDraft, 'title' | 'summary' | 'details'>,
): Promise<ModerationDecision> {
  return post('/api/report/moderate', draft);
}

export async function deliverVerifiedReport(
  receipt: Receipt,
  draft: ReportDraft,
  attachments: RelayAttachment[] = [],
): Promise<{ delivery: 'email' | 'verified-local'; duplicate?: boolean }> {
  return post('/api/report/deliver', {
    ticket: receipt.ticket,
    to: receipt.destinationEmail,
    subject: draft.title,
    body: draft,
    attachments,
    verification: {
      mode: receipt.mode,
      reportCommitment: receipt.reportCommitment,
      destinationCommitment: receipt.destinationCommitment,
      reportSalt: bytesToHex(receipt.reportSalt),
      nullifier: receipt.nullifier,
    },
  });
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('로컬 issuer API에 연결할 수 없습니다. issuer-server를 실행해 주세요.');
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Issuer API returned HTTP ${response.status}.`);
  return payload;
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { method: 'GET' });
  } catch {
    throw new Error('로컬 issuer API에 연결할 수 없습니다. issuer-server를 실행해 주세요.');
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Issuer API returned HTTP ${response.status}.`);
  return payload;
}
