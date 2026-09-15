import { bytesToHex, concatBytes, utf8 } from './encoding.js';

const domainSeparator = utf8('ghostwhistle:v1\u0000');

export async function sha256(value: Uint8Array | string): Promise<Uint8Array> {
  const input = typeof value === 'string' ? utf8(value) : value;
  const owned = Uint8Array.from(input);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer));
}

export async function sha256Hex(value: Uint8Array | string): Promise<string> {
  return bytesToHex(await sha256(value));
}

export async function commitment(...parts: (Uint8Array | string)[]): Promise<string> {
  const encoded = parts.map((part) => (typeof part === 'string' ? utf8(part) : part));
  return sha256Hex(concatBytes(domainSeparator, ...encoded));
}

export function randomSecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
}

export function randomSalt(): Uint8Array {
  return randomSecret();
}

export async function credentialCommitment(domain: string, secret: Uint8Array): Promise<string> {
  return commitment('credential', domain, secret);
}

export async function reportCommitment(reportJson: string, salt: Uint8Array): Promise<string> {
  return commitment('report', reportJson, salt);
}

export async function destinationCommitment(email: string): Promise<string> {
  return commitment('destination', email.trim().toLowerCase());
}

export async function domainCommitment(domain: string): Promise<string> {
  return commitment('domain', domain.trim().toLowerCase());
}

export async function internalDestinationCommitment(
  domainCommitmentValue: string,
  emailCommitmentValue: string,
): Promise<string> {
  return commitment('internal-destination', domainCommitmentValue, emailCommitmentValue);
}

export async function nullifier(secret: Uint8Array, report: string, salt: Uint8Array): Promise<string> {
  return commitment('nullifier', secret, report, salt);
}

export async function ticketCommitment(
  mode: 'internal' | 'whitehat',
  destinationCommitmentValue: string,
  report: string,
  nullifierValue: string,
): Promise<string> {
  return commitment('ticket', mode, destinationCommitmentValue, report, nullifierValue);
}
