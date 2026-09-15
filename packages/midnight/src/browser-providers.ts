import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  Transaction,
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import type { GhostWhistlePrivateState } from '@ghostwhistle/contract';
import {
  ghostWhistlePrivateStateId,
  type GhostWhistleCircuit,
  type GhostWhistleProviders,
} from './client.js';
import { ephemeralPrivateStateProvider } from './private-state.js';

type MidnightWindow = Window & { midnight?: Record<string, InitialAPI | undefined> };

export type BrowserProviderOptions = {
  networkId?: NetworkId;
  zkAssetBaseUrl: string;
  /** Optional backend that attaches sponsor-owned DUST before broadcasting. */
  sponsorUrl?: string;
  /** Supplies the anti-abuse proof that authorizes one sponsored report. */
  sponsorAuthorization?: () => { reportCommitment: string; powNonce: number } | undefined;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

export async function createLaceProviders(options: BrowserProviderOptions): Promise<GhostWhistleProviders> {
  const networkId = options.networkId ?? 'preprod';
  const sponsorUrl = options.sponsorUrl?.replace(/\/$/, '');
  setNetworkId(networkId);
  const connected = await connectToLace(networkId, options.timeoutMs);
  const connectionStatus = await withTimeout(
    connected.getConnectionStatus(),
    10_000,
    'Lace 연결 상태 확인 시간이 초과되었습니다.',
  );
  if (connectionStatus.status !== 'connected' || connectionStatus.networkId !== networkId) {
    throw new Error(`Lace가 ${networkId} 네트워크에 연결되지 않았습니다.`);
  }
  const configuration = await withTimeout(
    connected.getConfiguration(),
    10_000,
    'Lace 서비스 설정 조회 시간이 초과되었습니다.',
  );
  if (!configuration.proverServerUri) throw new Error('Lace has no proof-server URI configured.');
  const addresses = await withTimeout(
    connected.getShieldedAddresses(),
    10_000,
    'Lace 주소 조회 시간이 초과되었습니다.',
  );
  const zkAssetBaseUrl = resolveHttpUrl(options.zkAssetBaseUrl);
  const zkConfigProvider = new FetchZkConfigProvider<GhostWhistleCircuit>(
    zkAssetBaseUrl,
    options.fetcher ?? fetch.bind(globalThis),
  );

  return {
    privateStateProvider: ephemeralPrivateStateProvider<
      typeof ghostWhistlePrivateStateId,
      GhostWhistlePrivateState
    >(),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(configuration.proverServerUri, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(
      configuration.indexerUri,
      configuration.indexerWsUri,
      globalThis.WebSocket as never,
    ),
    walletProvider: {
      getCoinPublicKey: () => addresses.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => addresses.shieldedEncryptionPublicKey,
      async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
        const balanced = await connected.balanceUnsealedTransaction(toHex(tx.serialize()), {
          payFees: !sponsorUrl,
        });
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(balanced.tx),
        );
      },
    },
    midnightProvider: {
      async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
        if (sponsorUrl) {
          const authorization = options.sponsorAuthorization?.();
          if (!authorization) {
            throw new Error('Sponsored submission requires a report proof-of-work authorization.');
          }
          let response: Response;
          try {
            response = await fetch(`${sponsorUrl}/api/relay/submit`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tx: toHex(tx.serialize()), ...authorization }),
            });
          } catch {
            throw new Error('DUST sponsor API에 연결할 수 없습니다. issuer-server를 실행해 주세요.');
          }
          const payload = (await response.json().catch(() => ({}))) as {
            transactionId?: unknown;
            error?: unknown;
          };
          if (!response.ok) {
            throw new Error(
              typeof payload.error === 'string'
                ? payload.error
                : `DUST sponsor API returned HTTP ${response.status}.`,
            );
          }
          if (typeof payload.transactionId !== 'string' || payload.transactionId.length === 0) {
            throw new Error('DUST sponsor API returned no transaction id.');
          }
          return payload.transactionId as TransactionId;
        }
        await connected.submitTransaction(toHex(tx.serialize()));
        const [transactionId] = tx.identifiers();
        if (!transactionId) throw new Error('Submitted transaction has no identifier.');
        return transactionId;
      },
    },
  };
}

function resolveHttpUrl(value: string): string {
  try {
    const origin = typeof window === 'undefined' ? undefined : window.location.origin;
    const url = new URL(value, origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported protocol ${url.protocol}`);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(
      `ZK asset URL이 올바르지 않습니다: ${value}. 절대 URL 또는 현재 웹사이트 기준 상대경로를 사용해 주세요.`,
    );
  }
}

export async function connectToLace(
  networkId: NetworkId = 'preprod',
  timeoutMs = 120_000,
): Promise<ConnectedAPI> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const wallets = (window as MidnightWindow).midnight ?? {};
    const candidates = [wallets.mnLace, ...Object.values(wallets)].filter(
      (wallet, index, values) => wallet !== undefined && values.indexOf(wallet) === index,
    );
    const compatible = candidates.find((wallet): wallet is InitialAPI =>
      wallet?.apiVersion?.startsWith('4.'),
    );
    if (compatible) {
      return withTimeout(
        compatible.connect(networkId),
        timeoutMs,
        'Lace 연결 승인 시간이 2분을 초과했습니다. Lace의 설정 > Authorized dApps에서 이 사이트 연결을 해제한 뒤 페이지를 새로고침해 주세요.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Compatible Midnight Lace wallet was not found. Install and enable connector API 4.x.');
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
