import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import {
  GhostWhistleContractClient,
  ephemeralPrivateStateProvider,
  ghostWhistlePrivateStateId,
} from '@ghostwhistle/midnight';
import { compiledGhostWhistleContract } from '@ghostwhistle/contract';
import type { GhostWhistlePrivateState } from '@ghostwhistle/contract';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
} from '@midnight-ntwrk/midnight-js-types';
import type { ProverKey, VerifierKey, ZKIR } from '@midnight-ntwrk/midnight-js-types';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import type { FacadeState, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightNetworkConfig } from './config.js';
import { submitWithRpcRecovery } from './submission.js';

type Circuit =
  'approveSecurityDestination' | 'issueCredential' | 'revokeCredential' | 'submitInternal' | 'submitWhitehat';

class LocalZkConfigProvider extends ZKConfigProvider<Circuit> {
  private readonly base = new URL('../../../packages/contract/src/managed/ghostwhistle/', import.meta.url);
  private async bytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(new URL(path, this.base)));
  }
  getProverKey(circuitId: Circuit): Promise<ProverKey> {
    return this.bytes(`keys/${circuitId}.prover`).then(createProverKey);
  }
  getVerifierKey(circuitId: Circuit): Promise<VerifierKey> {
    return this.bytes(`keys/${circuitId}.verifier`).then(createVerifierKey);
  }
  getZKIR(circuitId: Circuit): Promise<ZKIR> {
    return this.bytes(`zkir/${circuitId}.bzkir`).then(createZKIR);
  }
}

export async function deployWithCliWallet(
  wallet: WalletFacade,
  network: MidnightNetworkConfig,
  secrets: { shieldedSecretKeys: ledger.ZswapSecretKeys; dustSecretKey: ledger.DustSecretKey },
  unshieldedKeystore: {
    getPublicKey: () => ledger.SignatureVerifyingKey;
    signData: (payload: Uint8Array) => ledger.Signature;
  },
  issuerSecret: Uint8Array,
  oracleSecret: Uint8Array,
) {
  const providers = await createCliProviders(wallet, network, secrets, unshieldedKeystore);
  const client = await GhostWhistleContractClient.deploy(providers, issuerSecret, oracleSecret);
  return { client, deploymentTxId: client.deployedContract.deployTxData.public.txId };
}

export async function joinWithCliWallet(
  wallet: WalletFacade,
  network: MidnightNetworkConfig,
  secrets: { shieldedSecretKeys: ledger.ZswapSecretKeys; dustSecretKey: ledger.DustSecretKey },
  unshieldedKeystore: {
    getPublicKey: () => ledger.SignatureVerifyingKey;
    signData: (payload: Uint8Array) => ledger.Signature;
  },
  contractAddress: string,
): Promise<GhostWhistleContractClient> {
  const providers = await createCliProviders(wallet, network, secrets, unshieldedKeystore);
  return GhostWhistleContractClient.join(providers, contractAddress);
}

async function createCliProviders(
  wallet: WalletFacade,
  network: MidnightNetworkConfig,
  secrets: { shieldedSecretKeys: ledger.ZswapSecretKeys; dustSecretKey: ledger.DustSecretKey },
  unshieldedKeystore: {
    getPublicKey: () => ledger.SignatureVerifyingKey;
    signData: (payload: Uint8Array) => ledger.Signature;
  },
) {
  // A fresh wallet may need a long time to replay the shielded/DUST ledgers.
  // Contract deployment only needs the shielded public keys and one spendable
  // DUST coin, so do not block on WalletFacade.waitForSyncedState() (which
  // requires all three ledgers to reach their global tips).
  let state: FacadeState;
  try {
    state = await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.filter(
          (candidate) =>
            candidate.dust.progress.isConnected &&
            candidate.dust.availableCoins.length > 0 &&
            candidate.dust.balance(new Date()) > 0n,
        ),
        Rx.timeout({ first: readDustTimeoutMs() }),
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `Deployment could not find a spendable DUST coin within ${Math.round(readDustTimeoutMs() / 60_000)} minutes. ` +
          'Keep the CLI running while DUST sync catches up, then retry with the same vault.',
      );
    }
    throw error;
  }
  const zkConfigProvider = new LocalZkConfigProvider();
  const providers = {
    privateStateProvider: ephemeralPrivateStateProvider<
      typeof ghostWhistlePrivateStateId,
      GhostWhistlePrivateState
    >(),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(network.proofServerUrl, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(
      network.indexerHttpUrl,
      network.indexerWsUrl,
      WebSocket as never,
    ),
    walletProvider: {
      getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
      getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
      async balanceTx(tx: UnboundTransaction, ttl?: Date) {
        const recipe = await wallet.balanceUnboundTransaction(tx, secrets, {
          ttl: ttl ?? new Date(Date.now() + 3_600_000),
        });
        const signed = await wallet.signRecipe(recipe, (payload) => unshieldedKeystore.signData(payload));
        return wallet.finalizeRecipe(signed);
      },
    },
    midnightProvider: {
      async submitTx(tx: ledger.FinalizedTransaction) {
        return submitWithRpcRecovery(wallet, network.indexerHttpUrl, tx);
      },
    },
  };
  return providers;
}

const readDustTimeoutMs = (): number => {
  const value = Number(process.env.GHOSTWHISTLE_DUST_SYNC_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 1_800_000;
};

export { compiledGhostWhistleContract };
