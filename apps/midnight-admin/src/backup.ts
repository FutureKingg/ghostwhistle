export type MidnightNetworkId = 'preprod' | 'preview' | 'undeployed';

export type AdminBackup = {
  format: 'ghostwhistle-admin-backup-v1';
  network: MidnightNetworkId;
  createdAt: string;
  contractAddress?: string;
  issuerSecret: string;
  oracleSecret: string;
};

type EncryptedBackup = {
  format: 'ghostwhistle-encrypted-backup-v1';
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: 600_000; salt: string };
  cipher: { name: 'AES-GCM'; iv: string; ciphertext: string };
};

export async function encryptedBackup(backup: AdminBackup, passphrase: string): Promise<Blob> {
  if (passphrase.length < 12) throw new Error('Use a backup passphrase of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(backup));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const payload: EncryptedBackup = {
    format: 'ghostwhistle-encrypted-backup-v1',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 600_000,
      salt: toBase64(salt),
    },
    cipher: { name: 'AES-GCM', iv: toBase64(iv), ciphertext: toBase64(ciphertext) },
  };
  plaintext.fill(0);
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
