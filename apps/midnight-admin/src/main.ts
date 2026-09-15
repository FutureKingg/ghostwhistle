import {
  GhostWhistleContractClient,
  createLaceProviders,
  type GhostWhistleProviders,
} from '@ghostwhistle/midnight';
import { encryptedBackup, toHex, type AdminBackup, type MidnightNetworkId } from './backup.js';
import './styles.css';

const connectButton = element<HTMLButtonElement>('connect');
const prepareButton = element<HTMLButtonElement>('prepare');
const deployButton = element<HTMLButtonElement>('deploy');
const passphraseInput = element<HTMLInputElement>('passphrase');
const backupConfirmed = element<HTMLInputElement>('backup-confirmed');
const status = element<HTMLPreElement>('status');

let providers: GhostWhistleProviders | undefined;
let issuerSecret: Uint8Array | undefined;
let oracleSecret: Uint8Array | undefined;
let backup: AdminBackup | undefined;
let deployed = false;

const configuredNetwork = import.meta.env.VITE_MIDNIGHT_NETWORK ?? 'preview';
if (!['preprod', 'preview', 'undeployed'].includes(configuredNetwork)) {
  throw new Error(`Unsupported VITE_MIDNIGHT_NETWORK: ${configuredNetwork}`);
}
const networkId = configuredNetwork as MidnightNetworkId;
const networkLabel =
  networkId === 'undeployed' ? 'Local Devnet' : networkId[0].toUpperCase() + networkId.slice(1);

connectButton.addEventListener('click', async () => {
  await run(async () => {
    status.textContent = 'Waiting for Lace permission…';
    providers = await createLaceProviders({
      networkId,
      zkAssetBaseUrl: `${window.location.origin}`,
      timeoutMs: 10_000,
    });
    connectButton.disabled = true;
    prepareButton.disabled = false;
    status.textContent = `Lace connected on ${networkLabel}. No transaction has been submitted.`;
  });
});

prepareButton.addEventListener('click', async () => {
  await run(async () => {
    if (deployed) {
      if (!backup) throw new Error('Deployment backup is unavailable.');
      await downloadBackup(backup, passphraseInput.value, `ghostwhistle-admin-${networkId}-deployed.json`);
      passphraseInput.value = '';
      status.textContent = 'Address-bound encrypted backup downloaded.';
      return;
    }
    if (!providers) throw new Error('Connect Lace first.');
    issuerSecret = crypto.getRandomValues(new Uint8Array(32));
    oracleSecret = crypto.getRandomValues(new Uint8Array(32));
    backup = {
      format: 'ghostwhistle-admin-backup-v1',
      network: networkId,
      createdAt: new Date().toISOString(),
      issuerSecret: toHex(issuerSecret),
      oracleSecret: toHex(oracleSecret),
    };
    if (passphraseInput.value.length < 12)
      throw new Error('Use a backup passphrase with at least 12 characters.');
    await downloadBackup(backup, passphraseInput.value, `ghostwhistle-admin-${networkId}-before-deploy.json`);
    passphraseInput.value = '';
    prepareButton.disabled = true;
    backupConfirmed.disabled = false;
    status.textContent =
      'Encrypted backup downloaded. Store its passphrase separately, then confirm before deployment.';
  });
});

backupConfirmed.addEventListener('change', () => {
  deployButton.disabled = !backupConfirmed.checked || !providers || !issuerSecret || !oracleSecret;
});

deployButton.addEventListener('click', async () => {
  await run(async () => {
    if (!providers || !issuerSecret || !oracleSecret || !backup)
      throw new Error('Connection and encrypted backup are required.');
    deployButton.disabled = true;
    status.textContent = 'Generating proof. Lace will request transaction approval…';
    const client = await GhostWhistleContractClient.deploy(providers, issuerSecret, oracleSecret);
    backup.contractAddress = client.address;
    deployed = true;
    status.textContent = [
      `DEPLOYED ON ${networkLabel.toUpperCase()}`,
      `Contract address: ${client.address}`,
      '',
      'Keep this page open. Enter the same backup passphrase to download the address-bound backup.',
    ].join('\n');
    passphraseInput.value = '';
    passphraseInput.focus();
    prepareButton.textContent = 'Download address-bound encrypted backup';
    prepareButton.disabled = false;
  });
});

async function downloadBackup(value: AdminBackup, passphrase: string, filename: string): Promise<void> {
  const blob = await encryptedBackup(value, passphrase);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    status.textContent = error instanceof Error ? `ERROR: ${error.message}` : 'ERROR: Unknown failure';
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}
