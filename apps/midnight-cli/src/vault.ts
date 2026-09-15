import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { LOCAL_VAULT_FILE, NETWORKS, type MidnightNetworkId } from './config.js';

type VaultRecord = {
  version: 1;
  network: MidnightNetworkId;
  kdf: 'scrypt';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

let preparedSeed: Promise<string> | undefined;

type SessionPasswords = {
  walletVaultPassword: string;
  adminSecretsVaultPassword: string;
};

type ProtectedPasswordStore = {
  version: 1;
  protector: 'windows-dpapi-current-user';
  ciphertext: string;
};

let sessionPasswords: Promise<SessionPasswords | undefined> | undefined;

const passwordFileFromArgs = (): string | undefined => {
  const inline = process.argv.find((argument) => argument.startsWith('--password-file='));
  if (inline) return inline.slice('--password-file='.length);
  const index = process.argv.indexOf('--password-file');
  return index >= 0 ? process.argv[index + 1] : process.env.GHOSTWHISTLE_VAULT_PASSWORD_FILE;
};

const persistentPasswordStorePath = (): string | undefined =>
  process.env.GHOSTWHISTLE_VAULT_PASSWORD_STORE ??
  (process.platform === 'win32' && process.env.USERPROFILE
    ? join(process.env.USERPROFILE, 'Desktop', 'ghostwhistle-vault-passwords.json')
    : undefined);

const runPowerShell = (script: string, input: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8').trim());
      reject(
        new Error(Buffer.concat(stderr).toString('utf8').trim() || `PowerShell exited with code ${code}.`),
      );
    });
    child.stdin.end(input, 'utf8');
  });

const protectForCurrentWindowsUser = async (value: string): Promise<string> => {
  if (process.platform !== 'win32')
    throw new Error('Persistent password storage is supported on Windows only.');
  return runPowerShell(
    'Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); $bytes=[Text.Encoding]::UTF8.GetBytes($inputText); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))',
    value,
  );
};

const unprotectForCurrentWindowsUser = async (ciphertext: string): Promise<string> => {
  if (process.platform !== 'win32')
    throw new Error('Persistent password storage is supported on Windows only.');
  return runPowerShell(
    'Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd().Trim(); $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputText),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($bytes)',
    ciphertext,
  );
};

const isSessionPasswords = (value: unknown): value is SessionPasswords => {
  const candidate = value as Partial<SessionPasswords>;
  return (
    typeof candidate.walletVaultPassword === 'string' &&
    candidate.walletVaultPassword.length > 0 &&
    typeof candidate.adminSecretsVaultPassword === 'string' &&
    candidate.adminSecretsVaultPassword.length > 0
  );
};

const loadSessionPasswords = async (): Promise<SessionPasswords | undefined> => {
  const path = passwordFileFromArgs();
  if (!path) {
    const persistentPath = persistentPasswordStorePath();
    if (!persistentPath) return undefined;
    let raw: string;
    try {
      raw = await readFile(persistentPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const record = JSON.parse(raw) as Partial<ProtectedPasswordStore>;
    if (record.version !== 1 || record.protector !== 'windows-dpapi-current-user' || !record.ciphertext) {
      throw new Error(`Unsupported persistent password store: ${persistentPath}`);
    }
    const value = JSON.parse(await unprotectForCurrentWindowsUser(record.ciphertext)) as unknown;
    if (!isSessionPasswords(value)) throw new Error(`Invalid persistent password store: ${persistentPath}`);
    return value;
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } finally {
    // The operator explicitly opts into a one-time plaintext handoff. Remove
    // it before parsing or decrypting so it is never left behind after use.
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  const value = JSON.parse(raw) as unknown;
  if (!isSessionPasswords(value)) {
    throw new Error('One-time password file must contain walletVaultPassword and adminSecretsVaultPassword.');
  }
  return value;
};

const getSessionPasswords = (): Promise<SessionPasswords | undefined> => {
  sessionPasswords ??= loadSessionPasswords();
  return sessionPasswords;
};

const rememberSessionPassword = async (name: keyof SessionPasswords, password: string): Promise<void> => {
  if (password.length === 0 || passwordFileFromArgs()) return;
  const existing = await getSessionPasswords();
  const next = { ...(existing ?? {}), [name]: password } as Partial<SessionPasswords>;
  if (!isSessionPasswords(next)) {
    sessionPasswords = Promise.resolve(next as SessionPasswords);
    return;
  }
  const path = persistentPasswordStorePath();
  if (!path) return;
  const ciphertext = await protectForCurrentWindowsUser(JSON.stringify(next));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ version: 1, protector: 'windows-dpapi-current-user', ciphertext } satisfies ProtectedPasswordStore, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  sessionPasswords = Promise.resolve(next);
  console.log(`  Encrypted persistent vault password store saved locally: ${path}`);
};

const ask = (question: string): Promise<string> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
};

const keyFromPassword = (password: string, salt: Buffer) => scryptSync(password, salt, 32);

const encrypt = (seedHex: string, password: string, network: MidnightNetworkId): VaultRecord => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromPassword(password, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(seedHex, 'utf8'), cipher.final()]);
  return {
    version: 1,
    network,
    kdf: 'scrypt',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
};

const decrypt = (record: VaultRecord, password: string): string => {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFromPassword(password, Buffer.from(record.salt, 'base64url')),
    Buffer.from(record.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

const readOrCreateSeed = async (
  generateSeed: () => string,
  network: MidnightNetworkId = 'preprod',
): Promise<string> => {
  const path = fileURLToPath(LOCAL_VAULT_FILE);
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as VaultRecord;
    if (record.version !== 1 || !(record.network in NETWORKS)) throw new Error('Unsupported wallet vault');
    const suppliedPassword = (await getSessionPasswords())?.walletVaultPassword;
    if (suppliedPassword) {
      try {
        return decrypt(record, suppliedPassword);
      } catch {
        throw new Error('Wallet password in the one-time password file is incorrect.');
      }
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const password = await ask(`Wallet vault password (attempt ${attempt}/3): `);
      try {
        const seed = decrypt(record, password);
        await rememberSessionPassword('walletVaultPassword', password);
        return seed;
      } catch {
        console.log('  Incorrect vault password.');
      }
    }
    throw new Error('Unable to decrypt the local wallet vault.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const seed = generateSeed();
    const password = await ask('Create a local vault password (never share it): ');
    if (password.length < 12) throw new Error('Use a vault password with at least 12 characters.');
    const record = encrypt(seed, password, network);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(`  Encrypted wallet backup saved locally: ${path}`);
    return seed;
  }
};

/**
 * Unlock the lightweight local vault before importing the large Midnight SDK
 * graph. This makes the password prompt appear immediately on Windows/Node 24.
 */
export function prepareSeed(
  generateSeed: () => string,
  network: MidnightNetworkId = 'preprod',
): Promise<string> {
  preparedSeed ??= readOrCreateSeed(generateSeed, network);
  return preparedSeed;
}

export async function loadOrCreateSeed(
  generateSeed: () => string,
  network: MidnightNetworkId = 'preprod',
): Promise<string> {
  return preparedSeed ?? readOrCreateSeed(generateSeed, network);
}

export async function loadOrCreateVault<T>(
  file: URL,
  generateValue: () => T,
  label: string,
  network: MidnightNetworkId = 'preprod',
): Promise<T> {
  const path = fileURLToPath(file);
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as VaultRecord;
    if (record.version !== 1 || !(record.network in NETWORKS)) throw new Error(`Unsupported ${label} vault`);
    const storedPassword = (await getSessionPasswords())?.adminSecretsVaultPassword;
    const password = storedPassword ?? (await ask(`${label} vault password: `));
    const value = JSON.parse(decrypt(record, password)) as T;
    if (!storedPassword && label === 'admin secrets') {
      await rememberSessionPassword('adminSecretsVaultPassword', password);
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const value = generateValue();
    const password = await ask(`Create ${label} vault password (never share it): `);
    if (password.length < 12) throw new Error('Use a vault password with at least 12 characters.');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(encrypt(JSON.stringify(value), password, network), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    console.log(`  Encrypted ${label} backup saved locally: ${path}`);
    return value;
  }
}
