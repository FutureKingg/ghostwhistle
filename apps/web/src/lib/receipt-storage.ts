import type { ProofReceipt } from '../types';

const receiptKey = 'ghostwhistle:last-public-receipt:v1';
const hex32 = /^[0-9a-f]{64}$/i;

export function loadPublicReceipt(): ProofReceipt | null {
  try {
    const raw = localStorage.getItem(receiptKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ProofReceipt>;
    if (
      typeof value.ticket !== 'string' ||
      !hex32.test(value.ticket) ||
      typeof value.reportCommitment !== 'string' ||
      !hex32.test(value.reportCommitment) ||
      typeof value.destinationCommitment !== 'string' ||
      !hex32.test(value.destinationCommitment) ||
      !Number.isSafeInteger(value.powNonce) ||
      (value.powNonce ?? -1) < 0 ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      (value.nullifier !== undefined && !hex32.test(value.nullifier)) ||
      (value.transactionId !== undefined && !hex32.test(value.transactionId)) ||
      (value.source !== undefined && value.source !== 'demo' && value.source !== 'live') ||
      (value.delivery !== undefined &&
        value.delivery !== 'email' &&
        value.delivery !== 'verified-local' &&
        value.delivery !== 'failed')
    ) {
      localStorage.removeItem(receiptKey);
      return null;
    }
    return value as ProofReceipt;
  } catch {
    localStorage.removeItem(receiptKey);
    return null;
  }
}

export function savePublicReceipt(receipt: ProofReceipt): void {
  localStorage.setItem(receiptKey, JSON.stringify(receipt));
}

export function clearPublicReceipt(): void {
  localStorage.removeItem(receiptKey);
}
