import { WebSocket } from 'ws';
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

import { Buffer } from 'node:buffer';
import * as readline from 'node:readline';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { WalletEntrySchema, WalletFacade, mergeWalletEntries } from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import {
  FailSafeModerationAdapter,
  GeminiModerationAdapter,
  ResendGateway,
  ResendOtpDelivery,
  SecureSecurityTxtResolver,
} from '@ghostwhistle/adapters';
import { normalizeEmail, type RelayMessage } from '@ghostwhistle/core';
import { MidnightCredentialIssuerAdapter, MidnightDestinationOracleAdapter } from '@ghostwhistle/midnight';
import { ADMIN_VAULT_FILE, getNetworkConfig, type MidnightNetworkConfig } from './config.js';
import { loadOrCreateSeed, loadOrCreateVault } from './vault.js';
import { deployWithCliWallet, joinWithCliWallet } from './deploy.js';
import { startIssuerServer, waitForIssuerShutdown } from './issuer-server.js';
import { LocalVerifiedReportRelay } from './local-report-relay.js';
import { FileReportDeliveryStore } from './report-delivery-store.js';
import { FileOtpStore } from './file-otp-store.js';
import { FileSlidingWindowRateLimiter } from './file-rate-limiter.js';
import { submitWithRpcRecovery } from './submission.js';

const ask = (question: string): Promise<string> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
};
const status = async <T>(message: string, fn: () => Promise<T>) => {
  process.stdout.write(`  … ${message}`);
  try {
    const result = await fn();
    console.log(`\r  ✓ ${message}`);
    return result;
  } catch (error) {
    console.log(`\r  ✗ ${message}`);
    throw error;
  }
};
const formatNight = (raw: bigint) => `${raw / 1_000_000n}.${(raw % 1_000_000n).toString().padStart(6, '0')}`;
const formatDust = (raw: bigint) =>
  `${raw / 1_000_000_000_000_000n}.${(raw % 1_000_000_000_000_000n).toString().padStart(15, '0')}`;

const readTimeoutMs = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const unshieldedSyncTimeoutMs = () => readTimeoutMs('GHOSTWHISTLE_UNSHIELDED_SYNC_TIMEOUT_MS', 180_000);
const dustSyncTimeoutMs = () => readTimeoutMs('GHOSTWHISTLE_DUST_SYNC_TIMEOUT_MS', 1_800_000);
const dustSyncInitialTimeoutMs = () => readTimeoutMs('GHOSTWHISTLE_DUST_SYNC_INITIAL_TIMEOUT_MS', 180_000);
const dustSyncStallTimeoutMs = () => readTimeoutMs('GHOSTWHISTLE_DUST_SYNC_STALL_TIMEOUT_MS', 600_000);
const registrationTimeoutMs = () => readTimeoutMs('GHOSTWHISTLE_REGISTRATION_TIMEOUT_MS', 600_000);
const registrationRetryDelayMs = () => readTimeoutMs('GHOSTWHISTLE_REGISTRATION_RETRY_DELAY_MS', 5_000);
const doctorRequestTimeoutMs = () => readTimeoutMs('GHOSTWHISTLE_DOCTOR_TIMEOUT_MS', 10_000);

const argumentValue = (name: string): string | undefined => {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const errorMessage = (error: unknown): string => {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current) && messages.length < 5) {
    seen.add(current);
    if (typeof current === 'string') {
      messages.push(current);
      break;
    }
    if (typeof current === 'object' && current !== null) {
      const value = current as { message?: unknown; _tag?: unknown; cause?: unknown };
      const tag = typeof value._tag === 'string' ? value._tag : undefined;
      const message = typeof value.message === 'string' ? value.message : undefined;
      if (tag && message) messages.push(`${tag}: ${message}`);
      else if (message) messages.push(message);
      else if (tag) messages.push(tag);
      current = value.cause;
      continue;
    }
    messages.push(String(current));
    break;
  }
  return messages.length > 0 ? [...new Set(messages)].join(' → ') : String(error);
};

const syncProgressText = (progress: {
  appliedIndex?: bigint;
  highestRelevantWalletIndex?: bigint;
  highestIndex?: bigint;
  appliedId?: bigint;
  highestTransactionId?: bigint;
  isConnected: boolean;
}) => {
  const applied = progress.appliedIndex ?? progress.appliedId ?? 0n;
  const target =
    progress.highestRelevantWalletIndex ?? progress.highestTransactionId ?? progress.highestIndex ?? 0n;
  return `${applied}/${target}${progress.isConnected ? '' : '…'}`;
};

/**
 * The SDK intentionally keeps syncing all three ledgers in the background. A
 * fresh DUST/shielded wallet can replay a large history, so never use the
 * facade's `isSynced` flag as a prerequisite for the CLI's usable operations.
 */
const startSyncReporter = (wallet: WalletFacade): (() => void) => {
  if (!process.stdout.isTTY) return () => undefined;
  let lastLine = '';
  const subscription = wallet
    .state()
    .pipe(Rx.throttleTime(2_000, undefined, { leading: true, trailing: true }))
    .subscribe({
      next: (state) => {
        const line =
          `  Sync · shielded ${syncProgressText(state.shielded.progress)} · ` +
          `unshielded ${syncProgressText(state.unshielded.progress)} · ` +
          `DUST ${syncProgressText(state.dust.progress)}`;
        if (line !== lastLine) {
          process.stdout.write(`\r${line}`);
          lastLine = line;
        }
      },
      // Individual SDK sync streams retry transient indexer/RPC failures in
      // the background. Keep this observer from turning those into a second
      // foreground failure.
      error: () => undefined,
    });
  return () => {
    subscription.unsubscribe();
    if (lastLine) process.stdout.write(`\r${' '.repeat(lastLine.length)}\r`);
  };
};

const waitForUnshieldedSync = async (wallet: WalletFacade, networkId: MidnightNetworkConfig['networkId']) => {
  try {
    return await Rx.firstValueFrom(
      wallet.unshielded.state.pipe(
        Rx.filter((state) => state.progress.isConnected && state.progress.isCompleteWithin(0n)),
        Rx.timeout({ first: unshieldedSyncTimeoutMs() }),
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `Unshielded ${networkId} sync did not reach the indexer tip within ${Math.round(unshieldedSyncTimeoutMs() / 1000)}s. ` +
          'Check the indexer connection and rerun; background DUST/shielded replay is not required for this step.',
      );
    }
    throw error;
  }
};

const waitForNightBalance = async (wallet: WalletFacade) => {
  try {
    return await Rx.firstValueFrom(
      wallet.unshielded.state.pipe(
        Rx.map((state) => ({ state, balance: state.balances[unshieldedToken().raw] ?? 0n })),
        Rx.filter(({ balance }) => balance > 0n),
        Rx.timeout({ first: unshieldedSyncTimeoutMs() }),
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `No tNIGHT reached this wallet within ${Math.round(unshieldedSyncTimeoutMs() / 1000)}s. ` +
          'Confirm the faucet transfer was sent to the printed unshielded address, then rerun.',
      );
    }
    throw error;
  }
};

const waitForDustSync = async (wallet: WalletFacade, networkId: MidnightNetworkConfig['networkId']) => {
  try {
    return await Rx.firstValueFrom(
      wallet.dust.state.pipe(
        Rx.filter((state) => state.progress.isConnected && state.progress.isCompleteWithin(0n)),
        // A fresh Preprod DUST wallet may need well over 30 minutes to replay
        // its history. Fail only when the stream stops emitting, not merely
        // because a healthy catch-up has exceeded an arbitrary total duration.
        Rx.timeout({ first: dustSyncInitialTimeoutMs(), each: dustSyncStallTimeoutMs() }),
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `DUST ${networkId} sync made no progress for ${Math.round(dustSyncStallTimeoutMs() / 60_000)} minutes. ` +
          (networkId === 'preprod'
            ? 'This matches the known Preprod commitment-tree ordering failure in Midnight Wallet issue #643. '
            : '') +
          'No registration transaction was submitted; keep this vault and do not repeat the command until the indexer sync path recovers.',
      );
    }
    throw error;
  }
};

const waitForDustBalance = async (wallet: WalletFacade) => {
  try {
    return await Rx.firstValueFrom(
      wallet.dust.state.pipe(
        Rx.map((state) => ({ state, balance: state.balance(new Date()) })),
        Rx.filter(({ state, balance }) => state.progress.isConnected && balance > 0n),
        Rx.timeout({ first: dustSyncTimeoutMs() }),
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `DUST sync did not expose a spendable balance within ${Math.round(dustSyncTimeoutMs() / 60_000)} minutes. ` +
          'The SDK is still replaying the DUST ledger; leave the process running or rerun later with the same vault.',
      );
    }
    throw error;
  }
};

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const parseRequiredDust = (message: string): bigint | undefined => {
  const match = message.match(/need\s+(\d+)/i);
  return match ? BigInt(match[1]) : undefined;
};

const isRetryableRegistrationError = (error: unknown): boolean => {
  const message = errorMessage(error).toLowerCase();
  if (/(invalid|malformed|signature|insufficient balance|not enough|already registered)/i.test(message)) {
    return false;
  }
  return /(unknown error|unexpected error|block data|indexer|network|timeout|fetch failed|no response|disconnected|websocket|rpc)/i.test(
    message,
  );
};

const deriveKeys = (seedHex: string) => {
  const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('Invalid wallet seed.');
  const result = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Unable to derive wallet keys.');
  hd.hdWallet.clear();
  return result.keys;
};

async function buildWallet(keys: ReturnType<typeof deriveKeys>, network: MidnightNetworkConfig) {
  setNetworkId(network.networkId);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const shared = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: network.indexerHttpUrl,
      indexerWsUrl: network.indexerWsUrl,
    },
    provingServerUrl: new URL(network.proofServerUrl),
    relayURL: new URL(network.nodeUrl.replace(/^http/, 'ws')),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    costParameters: { feeBlocksMargin: 5 },
  };
  const dustConfiguration = {
    ...shared,
    costParameters: {
      ledgerParams: ledger.LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    },
  };
  const wallet = await WalletFacade.init({
    configuration: shared,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: () =>
      DustWallet(dustConfiguration).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, unshieldedKeystore, shieldedSecretKeys, dustSecretKey };
}

async function main() {
  const network = getNetworkConfig();
  if (process.argv.includes('--doctor')) {
    const requestTimeout = doctorRequestTimeoutMs();
    const proofBase = network.proofServerUrl.replace(/\/$/, '');
    let proofResponse: Response | undefined;
    let proofError: unknown;
    for (const proofUrl of [`${proofBase}/version`, proofBase]) {
      try {
        const response = await fetch(proofUrl, { signal: AbortSignal.timeout(requestTimeout) });
        if (response.ok) {
          proofResponse = response;
          break;
        }
        proofError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        proofError = error;
      }
    }
    if (!proofResponse) {
      throw new Error(
        `Proof server is not reachable at ${network.proofServerUrl}. ${errorMessage(proofError ?? 'unknown error')}`,
      );
    }
    // Drain the response so Node can reuse and close the local HTTP socket.
    await proofResponse.arrayBuffer();
    const rpcResponse = await fetch(network.nodeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHeader', params: [] }),
      signal: AbortSignal.timeout(requestTimeout),
    });
    if (!rpcResponse.ok) throw new Error(`${network.networkId} RPC returned HTTP ${rpcResponse.status}.`);
    await rpcResponse.arrayBuffer();
    console.log(`  ✓ Local proof server and ${network.networkId} RPC are reachable.`);
    return;
  }
  const seed = await loadOrCreateSeed(() => toHex(Buffer.from(generateRandomSeed())), network.networkId);
  const { wallet, unshieldedKeystore, shieldedSecretKeys, dustSecretKey } = await status(
    'Building wallet',
    () => buildWallet(deriveKeys(seed), network),
  );
  let stopSyncReporter: () => void = () => undefined;
  try {
    const initial = await Rx.firstValueFrom(wallet.state());
    const shieldedAddress = ShieldedAddress.codec
      .encode(
        getNetworkId(),
        new ShieldedAddress(
          ShieldedCoinPublicKey.fromHexString(initial.shielded.coinPublicKey.toHexString()),
          ShieldedEncryptionPublicKey.fromHexString(initial.shielded.encryptionPublicKey.toHexString()),
        ),
      )
      .toString();
    const unshieldedAddress = unshieldedKeystore.getBech32Address();
    // Use the address object produced by the same DustWallet instance for both
    // display and registration. This avoids crossing codec instances and mirrors
    // the official Midnight wallet flow.
    const dustAddress = MidnightBech32m.encode(getNetworkId(), initial.dust.address).toString();
    console.log('\n  Addresses (do not commit these to app config):');
    console.log(`    Shielded:   ${shieldedAddress}`);
    console.log(
      `    Unshielded: ${unshieldedAddress}${network.faucetUrl ? '  ← paste this into the faucet' : ''}`,
    );
    console.log(`    DUST:       ${dustAddress}`);
    if (network.faucetUrl) console.log(`\n  Faucet: ${network.faucetUrl}`);

    stopSyncReporter = startSyncReporter(wallet);
    await status('Syncing unshielded wallet', () => waitForUnshieldedSync(wallet, network.networkId));
    // Registration depends on the DUST wallet's current ledger parameters and
    // generation state. Starting it while DUST is still replaying (for example
    // 12,127/1,514,479 events) creates an invalid/incomplete transaction and the
    // SDK collapses the underlying failure to "unknown error". The official
    // Midnight example gates registration on this same strict sync condition.
    const syncedDustState = await status('Syncing DUST wallet', () =>
      waitForDustSync(wallet, network.networkId),
    );
    let state = await Rx.firstValueFrom(wallet.state());
    let night = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    let dust = syncedDustState.balance(new Date());
    console.log(`  tNIGHT: ${formatNight(night)} · DUST: ${formatDust(dust)}`);
    if (night === 0n) {
      stopSyncReporter();
      stopSyncReporter = () => undefined;
      if (network.networkId === 'undeployed') {
        throw new Error(
          'No tNIGHT is available on the local devnet. Use midnight-local-dev menu option 2 to fund the printed unshielded address, then rerun with the same vault.',
        );
      }
      console.log('\n  Add tNIGHT at the faucet, then press Enter here.');
      await ask('  Press Enter after the faucet confirms the transfer: ');
      stopSyncReporter = startSyncReporter(wallet);
      const nightState = await status('Waiting for tNIGHT', () => waitForNightBalance(wallet));
      state = await Rx.firstValueFrom(wallet.state());
      night = nightState.balance;
      console.log(`  tNIGHT received: ${formatNight(night)}`);
    }
    if (dust === 0n) {
      const coins = state.unshielded.availableCoins.filter(
        (coin: { meta?: { registeredForDustGeneration?: boolean } }) =>
          coin.meta?.registeredForDustGeneration !== true,
      );
      if (coins.length > 0) {
        await status('Registering tNIGHT for DUST generation', async () => {
          const deadline = Date.now() + registrationTimeoutMs();
          let registrationAttempt = 0;
          let lastError: unknown;
          while (Date.now() < deadline) {
            registrationAttempt += 1;
            let recipe;
            try {
              recipe = await wallet.registerNightUtxosForDustGeneration(
                coins,
                unshieldedKeystore.getPublicKey(),
                (payload) => unshieldedKeystore.signData(payload),
              );
            } catch (error) {
              lastError = error;
              const message = errorMessage(error);
              const isFeeShortfall = /Insufficient generated dust to cover registration fee/i.test(message);
              if (!isFeeShortfall && !isRetryableRegistrationError(error)) throw error;
              const remainingMs = Math.max(1_000, deadline - Date.now());
              const waitMs = Math.min(registrationRetryDelayMs() * registrationAttempt, remainingMs);
              if (isFeeShortfall) {
                const requiredDust = parseRequiredDust(message);
                console.log('\n  DUST is still accruing for the registration fee; waiting before retrying…');
                if (requiredDust !== undefined) {
                  await wallet.waitForGeneratedDust(coins, requiredDust, { timeoutMs: remainingMs });
                } else {
                  await sleep(Math.min(15_000, remainingMs));
                }
              } else {
                console.log(
                  `\n  Registration construction hit a transient ${network.networkId} error; retrying in ${Math.ceil(waitMs / 1000)}s…`,
                );
                await sleep(waitMs);
              }
              continue;
            }
            // Once a recipe exists, do not rebuild it after a submission error:
            // submitWithRpcRecovery checks the indexer before retrying and avoids
            // duplicate registration if the RPC watcher disconnects.
            await submitWithRpcRecovery(
              wallet,
              network.indexerHttpUrl,
              await wallet.finalizeRecipe(recipe),
              (attempt, total, waitMs) =>
                console.log(
                  `\n  RPC submission attempt ${attempt}/${total} was inconclusive; ` +
                    `reconnecting and retrying in ${Math.ceil(waitMs / 1000)}s…`,
                ),
              () =>
                console.log(
                  '  ✓ RPC watcher disconnected after the transaction was indexed; continuing safely.',
                ),
            );
            return;
          }
          throw new Error(
            `DUST registration timed out after ${Math.round(registrationTimeoutMs() / 60_000)} minutes: ${errorMessage(lastError)}`,
          );
        });
      } else {
        console.log('  No unregistered tNIGHT UTXO is currently available; waiting for DUST sync.');
      }
      const dustState = await status('Waiting for spendable DUST', () => waitForDustBalance(wallet));
      state = await Rx.firstValueFrom(wallet.state());
      dust = dustState.balance;
    }
    console.log(`\n  Ready · tNIGHT ${formatNight(night)} · DUST ${formatDust(dust)}`);
    const revokeCommitment = argumentValue('--revoke-credential');
    const approveDestination = argumentValue('--approve-security-destination');
    if (revokeCommitment || approveDestination) {
      if (revokeCommitment && approveDestination) {
        throw new Error('Run only one administrator operation at a time.');
      }
      const contractAddress = argumentValue('--contract') ?? process.env.GHOSTWHISTLE_CONTRACT_ADDRESS;
      if (!contractAddress) {
        throw new Error('Use --contract <address> or set GHOSTWHISTLE_CONTRACT_ADDRESS.');
      }
      const adminSecrets = await loadOrCreateVault<{ issuerSecret: string; oracleSecret: string }>(
        ADMIN_VAULT_FILE,
        () => {
          throw new Error('Admin secrets vault is required for administrator operations.');
        },
        'admin secrets',
        network.networkId,
      );
      const client = await status('Joining deployed GhostWhistle contract', () =>
        joinWithCliWallet(
          wallet,
          network,
          { shieldedSecretKeys, dustSecretKey },
          unshieldedKeystore,
          contractAddress,
        ),
      );
      if (revokeCommitment) {
        if (!/^[0-9a-f]{64}$/i.test(revokeCommitment)) {
          throw new Error('--revoke-credential must be a 32-byte hexadecimal commitment.');
        }
        const issuer = new MidnightCredentialIssuerAdapter(
          client,
          Buffer.from(adminSecrets.issuerSecret, 'hex'),
        );
        await status('Revoking credential commitment', () => issuer.revokeCredential(revokeCommitment));
        console.log(`  Revoked credential: ${revokeCommitment}`);
      } else {
        const destination = normalizeEmail(approveDestination!).email;
        const oracle = new MidnightDestinationOracleAdapter(
          client,
          Buffer.from(adminSecrets.oracleSecret, 'hex'),
        );
        await status('Approving security destination', () => oracle.approveSecurityDestination(destination));
        console.log(`  Approved security destination: ${destination}`);
      }
      return;
    }
    if (process.argv.includes('--issuer-server')) {
      const contractAddress = argumentValue('--contract') ?? process.env.GHOSTWHISTLE_CONTRACT_ADDRESS;
      if (!contractAddress) {
        throw new Error('Use --contract <address> or set GHOSTWHISTLE_CONTRACT_ADDRESS.');
      }
      const adminSecrets = await loadOrCreateVault<{ issuerSecret: string; oracleSecret: string }>(
        ADMIN_VAULT_FILE,
        () => {
          throw new Error('Admin secrets vault is required for issuer mode.');
        },
        'admin secrets',
        network.networkId,
      );
      const client = await status('Joining deployed GhostWhistle contract', () =>
        joinWithCliWallet(
          wallet,
          network,
          { shieldedSecretKeys, dustSecretKey },
          unshieldedKeystore,
          contractAddress,
        ),
      );
      const resendApiKey = process.env.RESEND_API_KEY;
      const resendOtpFrom = process.env.RESEND_OTP_FROM;
      if (Boolean(resendApiKey) !== Boolean(resendOtpFrom)) {
        throw new Error('Set both RESEND_API_KEY and RESEND_OTP_FROM, or neither for local console OTP.');
      }
      const delivery =
        resendApiKey && resendOtpFrom
          ? new ResendOtpDelivery({ apiKey: resendApiKey, otpFrom: resendOtpFrom })
          : {
              async send(input: { to: string; code: string; expiresInMinutes: number }) {
                console.log(
                  `\n  Local OTP for ${input.to}: ${input.code} (expires in ${input.expiresInMinutes} minutes)`,
                );
              },
            };
      const ticketVerifier = {
        async verify(message: RelayMessage) {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            if (await client.verifyRelayMessage(message)) return true;
            if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
          return false;
        },
      };
      const reportFrom = process.env.RESEND_REPORT_FROM;
      const reportRelay =
        resendApiKey && resendOtpFrom && reportFrom
          ? {
              delivery: 'email' as const,
              relay: new ResendGateway({
                apiKey: resendApiKey,
                reportFrom,
                otpFrom: resendOtpFrom,
                ticketVerifier,
              }),
            }
          : {
              delivery: 'verified-local' as const,
              relay: new LocalVerifiedReportRelay(ticketVerifier),
            };
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const moderation = geminiApiKey
        ? new FailSafeModerationAdapter(
            new GeminiModerationAdapter({
              apiKey: geminiApiKey,
              model: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
            }),
          )
        : undefined;
      const port = Number(process.env.GHOSTWHISTLE_ISSUER_PORT ?? 8787);
      const origin = process.env.GHOSTWHISTLE_WEB_ORIGIN ?? 'http://127.0.0.1:4173';
      const server = await startIssuerServer({
        registry: new MidnightCredentialIssuerAdapter(client, Buffer.from(adminSecrets.issuerSecret, 'hex')),
        delivery,
        port,
        allowedOrigin: origin,
        sponsor: {
          wallet,
          secrets: { shieldedSecretKeys, dustSecretKey },
          unshieldedKeystore,
          indexerHttpUrl: network.indexerHttpUrl,
          contractAddress,
        },
        whitehat: {
          resolver: new SecureSecurityTxtResolver(),
          registry: new MidnightDestinationOracleAdapter(
            client,
            Buffer.from(adminSecrets.oracleSecret, 'hex'),
          ),
        },
        reportRelay,
        deliveryStore: new FileReportDeliveryStore(),
        otpStore: new FileOtpStore(),
        rateLimiterFactory: (namespace, maxEvents, windowMs) =>
          new FileSlidingWindowRateLimiter(namespace, maxEvents, windowMs),
        moderation,
        exposeDevelopmentOtp: network.networkId === 'undeployed' && !resendApiKey,
      });
      console.log(`\n  Issuer API ready: http://127.0.0.1:${port}`);
      console.log('  DUST sponsor API ready: POST /api/relay/submit');
      console.log('  Whitehat qualification API ready: POST /api/whitehat/qualify');
      console.log(
        geminiApiKey
          ? '  Automatic abuse filter: Gemini + local fallback'
          : '  Automatic abuse filter: local fallback',
      );
      console.log(
        reportRelay.delivery === 'email'
          ? '  Report delivery: Resend email'
          : '  Report delivery: verified local inbox (set RESEND_REPORT_FROM to send email)',
      );
      console.log(`  Allowed web origin: ${origin}`);
      console.log(
        resendApiKey ? '  OTP delivery: Resend' : '  OTP delivery: local terminal only (development mode)',
      );
      console.log('  Press Ctrl+C to stop.\n');
      await waitForIssuerShutdown(server);
      return;
    }
    if (process.argv.includes('--deploy')) {
      const adminSecrets = await loadOrCreateVault(
        ADMIN_VAULT_FILE,
        () => ({
          issuerSecret: toHex(Buffer.from(generateRandomSeed()).subarray(0, 32)),
          oracleSecret: toHex(Buffer.from(generateRandomSeed()).subarray(0, 32)),
        }),
        'admin secrets',
        network.networkId,
      );
      const deployed = await status('Deploying GhostWhistle contract', () =>
        deployWithCliWallet(
          wallet,
          network,
          { shieldedSecretKeys, dustSecretKey },
          unshieldedKeystore,
          Buffer.from(adminSecrets.issuerSecret, 'hex'),
          Buffer.from(adminSecrets.oracleSecret, 'hex'),
        ),
      );
      console.log(`  Contract address: ${deployed.client.address}`);
      console.log(`  Deployment tx id: ${deployed.deploymentTxId}`);
    }
    console.log('  Keep this terminal and local vault private. Press Ctrl+C when finished.\n');
  } finally {
    stopSyncReporter();
    await wallet.stop();
  }
}

main().catch((error: unknown) => {
  console.error('\n  Error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
