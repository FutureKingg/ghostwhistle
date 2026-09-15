import { sha256Hex } from './commitments.js';

export type PowPolicy = { leadingZeroBits: number; maxIterations: number };
export const defaultPowPolicy: PowPolicy = { leadingZeroBits: 12, maxIterations: 1_000_000 };

export async function verifyPow(
  commitment: string,
  nonce: number,
  policy = defaultPowPolicy,
): Promise<boolean> {
  if (!Number.isSafeInteger(nonce) || nonce < 0 || nonce > policy.maxIterations) return false;
  const digest = await sha256Hex(`${commitment}:${nonce}`);
  const fullNibbles = Math.floor(policy.leadingZeroBits / 4);
  const extraBits = policy.leadingZeroBits % 4;
  if (!digest.startsWith('0'.repeat(fullNibbles))) return false;
  return extraBits === 0 || Number.parseInt(digest[fullNibbles], 16) < 2 ** (4 - extraBits);
}

export async function solvePow(
  commitment: string,
  policy = defaultPowPolicy,
  batchSize = 128,
): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1024)
    throw new Error('Proof-of-work batch size must be between 1 and 1024.');
  for (let start = 0; start <= policy.maxIterations; start += batchSize) {
    const end = Math.min(start + batchSize, policy.maxIterations + 1);
    const candidates = Array.from({ length: end - start }, (_, index) => start + index);
    const matches = await Promise.all(
      candidates.map(async (nonce) => ((await verifyPow(commitment, nonce, policy)) ? nonce : undefined)),
    );
    const match = matches.find((nonce) => nonce !== undefined);
    if (match !== undefined) return match;
  }
  throw new Error('Proof-of-work budget exhausted.');
}
