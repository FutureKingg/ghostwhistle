import { beforeEach, describe, expect, it } from 'vitest';
import { clearPublicReceipt, loadPublicReceipt, savePublicReceipt } from './receipt-storage';
import type { ProofReceipt } from '../types';

const receipt: ProofReceipt = {
  ticket: 'ab'.repeat(32),
  reportCommitment: 'cd'.repeat(32),
  destinationCommitment: 'ef'.repeat(32),
  powNonce: 42,
  createdAt: '2026-09-15T00:00:00.000Z',
  nullifier: '12'.repeat(32),
  transactionId: '34'.repeat(32),
  source: 'live',
  delivery: 'email',
};

describe('public receipt storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips public receipt fields', () => {
    savePublicReceipt(receipt);
    expect(loadPublicReceipt()).toEqual(receipt);
    clearPublicReceipt();
    expect(loadPublicReceipt()).toBeNull();
  });

  it('drops malformed or forged local values', () => {
    localStorage.setItem(
      'ghostwhistle:last-public-receipt:v1',
      JSON.stringify({ ...receipt, ticket: '<script>alert(1)</script>' }),
    );

    expect(loadPublicReceipt()).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
