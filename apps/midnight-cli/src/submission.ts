import { makeDefaultSubmissionService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import type {
  DefaultSubmissionConfiguration,
  SubmissionService,
} from '@midnight-ntwrk/wallet-sdk-capabilities';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';

/**
 * The SDK's default submission service starts its Polkadot API connection as
 * soon as the facade is initialized. A temporary Preprod outage during that
 * startup can leave its deferred client permanently failed. This wrapper
 * creates the service on first use and discards a broken instance so the next
 * attempt can establish a fresh RPC connection.
 */
export const createLazySubmissionService = (
  configuration: DefaultSubmissionConfiguration,
): SubmissionService<ledger.FinalizedTransaction> => {
  let delegate: SubmissionService<ledger.FinalizedTransaction> | undefined;
  let opening: Promise<SubmissionService<ledger.FinalizedTransaction>> | undefined;

  const open = async () => {
    if (!opening) {
      opening = Promise.resolve().then(() =>
        makeDefaultSubmissionService<ledger.FinalizedTransaction>(configuration),
      );
    }
    try {
      delegate = await opening;
      return delegate;
    } catch (error) {
      opening = undefined;
      throw error;
    }
  };

  const submitTransaction = async (
    transaction: ledger.FinalizedTransaction,
    waitForStatus?: 'Submitted' | 'InBlock' | 'Finalized',
  ): Promise<unknown> => {
    const current = await open();
    try {
      return await current.submitTransaction(transaction, waitForStatus);
    } catch (error) {
      // Closing also disconnects the underlying ApiPromise. The next call
      // will build a new client instead of reusing a stale socket/deferred.
      delegate = undefined;
      opening = undefined;
      await Promise.resolve(current.close()).catch(() => undefined);
      throw error;
    }
  };

  return {
    // SubmissionService has a status-dependent overload. The implementation
    // above delegates to that same overload; this cast preserves the public
    // facade type without duplicating its three signatures here.
    submitTransaction:
      submitTransaction as SubmissionService<ledger.FinalizedTransaction>['submitTransaction'],
    async close() {
      const current = delegate;
      delegate = undefined;
      opening = undefined;
      if (current) await Promise.resolve(current.close()).catch(() => undefined);
    },
  };
};

export type IndexedTransactionStatus = 'success' | 'partial' | 'failure' | 'unknown';

const TRANSACTION_STATUS_QUERY = `query TransactionStatus($transactionId: HexEncoded!) {
  transactions(offset: {identifier: $transactionId}) {
    __typename
    ... on RegularTransaction {
      transactionResult {
        status
        segments { id success }
      }
    }
  }
}`;

const statusFromResponse = (value: unknown): IndexedTransactionStatus => {
  const transaction = (
    value as { data?: { transactions?: { __typename?: string; transactionResult?: { status?: string } } } }
  )?.data?.transactions;
  if (!transaction || transaction.__typename !== 'RegularTransaction') return 'unknown';
  switch (transaction.transactionResult?.status) {
    case 'SUCCESS':
      return 'success';
    case 'PARTIAL_SUCCESS':
      return 'partial';
    case 'FAILURE':
      return 'failure';
    default:
      return 'unknown';
  }
};

/**
 * Checks the indexer by each transaction identifier. This is used after an RPC
 * watcher disconnects because the extrinsic may have reached the chain even
 * though the WebSocket did not deliver its final status to the caller.
 */
export const findIndexedTransactionStatus = async (
  indexerHttpUrl: string,
  transaction: ledger.FinalizedTransaction,
): Promise<IndexedTransactionStatus> => {
  for (const transactionId of transaction.identifiers()) {
    try {
      const response = await fetch(indexerHttpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: TRANSACTION_STATUS_QUERY, variables: { transactionId } }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const result = statusFromResponse(await response.json());
      if (result !== 'unknown') return result;
    } catch {
      // The indexer can be briefly unavailable while the RPC is recovering.
      // Treat that as inconclusive and let the caller decide whether to retry.
    }
  }
  return 'unknown';
};

const readPositiveNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const describeError = (error: unknown): string => {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current) && messages.length < 5) {
    seen.add(current);
    if (typeof current === 'string') {
      messages.push(current);
      break;
    }
    if (typeof current === 'object') {
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

const isTransientError = (error: unknown): boolean => {
  const message = describeError(error).toLowerCase();
  if (
    /(invalid|dropped|usurped|overspend|insufficient|signature|malformed|expired|rejected)/i.test(message)
  ) {
    return false;
  }
  return /(submission|connect|timeout|disconnected|websocket|socket|network|no response|rpc|finality)/i.test(
    message,
  );
};

/**
 * Submits a finalized transaction with an ambiguity check. If the RPC watcher
 * disconnects after acceptance, the indexer lookup prevents a duplicate
 * submission. If the transaction is absent, the lazy submission service will
 * establish a fresh RPC connection on the next attempt.
 */
export const submitWithRpcRecovery = async (
  wallet: WalletFacade,
  indexerHttpUrl: string,
  transaction: ledger.FinalizedTransaction,
  onRetry?: (attempt: number, total: number, delayMs: number) => void,
  onAcceptedAfterDisconnect?: () => void,
): Promise<string> => {
  const total = Math.max(1, Math.floor(readPositiveNumber('GHOSTWHISTLE_SUBMISSION_ATTEMPTS', 3)));
  const delayMs = readPositiveNumber('GHOSTWHISTLE_SUBMISSION_RETRY_DELAY_MS', 5_000);
  let lastError: unknown;
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      return await wallet.submitTransaction(transaction);
    } catch (error) {
      lastError = error;
      const indexedStatus = await findIndexedTransactionStatus(indexerHttpUrl, transaction);
      if (indexedStatus === 'success') {
        onAcceptedAfterDisconnect?.();
        return transaction.identifiers().at(-1) ?? transaction.transactionHash();
      }
      if (indexedStatus === 'partial') {
        throw new Error(
          `Transaction is indexed with PARTIAL_SUCCESS; it will not be resubmitted. Original error: ${describeError(error)}`,
        );
      }
      if (indexedStatus === 'failure') {
        throw new Error(`Transaction is indexed with FAILURE: ${describeError(error)}`);
      }
      if (!isTransientError(error) || attempt >= total) break;
      const waitMs = delayMs * attempt;
      onRetry?.(attempt, total, waitMs);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`Transaction submission failed after ${total} attempt(s): ${describeError(lastError)}`);
};
