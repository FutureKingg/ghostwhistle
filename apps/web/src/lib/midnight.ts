import {
  createInternalEnrollment,
  prepareSubmission,
  type InternalEnrollment,
  type InternalQualification,
  type ModerationDecision,
  type Qualification,
  type RelayAttachment,
  type ReportDraft,
  type Receipt,
} from '@ghostwhistle/core';
import { deliverVerifiedReport, moderateReport } from './issuer-api';

export type WalletAvailability = 'available' | 'missing';
export type LiveConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

export type LiveContractConnection = {
  address: string;
  acceptedCount: bigint;
};

export class ModerationRejectedError extends Error {
  constructor(
    readonly category: ModerationDecision['category'],
    readonly moderationReason: string,
  ) {
    super('제출 내용이 자동 악용 방지 정책에 의해 차단되었습니다.');
    this.name = 'ModerationRejectedError';
  }
}

type MidnightWindow = Window & {
  midnight?: Record<string, { apiVersion?: string }>;
};

export function getWalletAvailability(): WalletAvailability {
  const injected = (window as MidnightWindow).midnight;
  return injected && Object.values(injected).some((wallet) => wallet?.apiVersion?.startsWith('4.'))
    ? 'available'
    : 'missing';
}

const configuredNetwork = import.meta.env.VITE_MIDNIGHT_NETWORK ?? 'preview';
if (!['preprod', 'preview', 'undeployed'].includes(configuredNetwork)) {
  throw new Error(`Unsupported VITE_MIDNIGHT_NETWORK: ${configuredNetwork}`);
}

export const network = {
  name: configuredNetwork as 'preprod' | 'preview' | 'undeployed',
  contractAddress: (import.meta.env.VITE_CONTRACT_ADDRESS ?? '') as string,
  demoMode: import.meta.env.VITE_DEMO_MODE !== 'false',
  zkAssetBaseUrl: (import.meta.env.VITE_MIDNIGHT_ZK_ASSET_BASE_URL ?? '').replace(/\/$/, ''),
  sponsorUrl: (import.meta.env.VITE_SPONSOR_API_URL ?? import.meta.env.VITE_ISSUER_API_URL ?? '').replace(
    /\/$/,
    '',
  ),
};

type LiveContractSession = LiveContractConnection & {
  reporter: import('@ghostwhistle/midnight').MidnightReporterAdapter;
};

let connectionPromise: Promise<LiveContractSession> | undefined;
let activeSponsorAuthorization: { reportCommitment: string; powNonce: number } | undefined;

const walletChannelPatterns = [
  /midnight-authenticator/i,
  /remote api.*shutdown/i,
  /object can no longer be used/i,
  /channel.*shutdown/i,
  /Lace 연결 세션이 종료/i,
];

export function isWalletConnectionExpired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return walletChannelPatterns.some((pattern) => pattern.test(message));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeWalletError(error: unknown): Error {
  if (!isWalletConnectionExpired(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  connectionPromise = undefined;
  return new Error('Lace 연결 세션이 종료되었습니다. “Lace로 다시 연결”을 누른 뒤 계속해 주세요.');
}

/**
 * Loads the large Midnight SDK only after the user asks to connect. This keeps
 * the demo usable without Lace while giving the UI an honest read-only check
 * against the configured deployment.
 */
export async function connectLiveContract(): Promise<LiveContractConnection> {
  if (!network.contractAddress) {
    throw new Error('VITE_CONTRACT_ADDRESS가 설정되지 않았습니다.');
  }

  connectionPromise ??= (async () => {
    const { createLaceProviders, GhostWhistleContractClient, MidnightReporterAdapter } =
      await import('@ghostwhistle/midnight');
    const providers = await createLaceProviders({
      networkId: network.name,
      zkAssetBaseUrl: network.zkAssetBaseUrl || `${window.location.origin}/midnight/ghostwhistle`,
      sponsorUrl: network.sponsorUrl || undefined,
      sponsorAuthorization: () => activeSponsorAuthorization,
      timeoutMs: 120_000,
    });
    const client = await GhostWhistleContractClient.join(providers, network.contractAddress);
    const ledger = await client.getLedger();
    return {
      address: client.address,
      acceptedCount: ledger.acceptedCount,
      reporter: new MidnightReporterAdapter(client),
    };
  })();

  try {
    return await withTimeout(
      connectionPromise,
      150_000,
      'Lace 연결 또는 계약 조회가 2분 30초 동안 응답하지 않았습니다. Lace의 설정 > Authorized dApps에서 이 사이트 연결을 해제한 뒤 페이지를 새로고침해 주세요.',
    );
  } catch (error) {
    connectionPromise = undefined;
    throw normalizeWalletError(error);
  }
}

async function requireLiveContractSession(): Promise<LiveContractSession> {
  if (!connectionPromise) {
    await connectLiveContract();
  }

  const session = connectionPromise;
  if (!session) {
    throw new Error('Lace 계약 세션을 다시 만들지 못했습니다. Lace에서 연결을 승인해 주세요.');
  }

  try {
    return await session;
  } catch (error) {
    connectionPromise = undefined;
    throw normalizeWalletError(error);
  }
}

export async function createLiveInternalEnrollment(email: string): Promise<InternalEnrollment> {
  const session = await requireLiveContractSession();
  return createInternalEnrollment(email, session.reporter);
}

export type LiveReportReceipt = Receipt & {
  delivery: 'email' | 'verified-local' | 'failed';
  deliveryError?: string;
};

export async function retryLiveReportDelivery(
  receipt: Receipt,
  draft: ReportDraft,
  attachments: RelayAttachment[] = [],
): Promise<{ delivery: 'email' | 'verified-local' }> {
  return deliverVerifiedReport(receipt, draft, attachments);
}

export async function submitLiveReport(
  qualification: Qualification,
  draft: ReportDraft,
  attachments: RelayAttachment[] = [],
): Promise<LiveReportReceipt> {
  // Run the abuse gate before any ZK proof or sponsored transaction is created.
  // It filters obvious misuse without deciding whether the underlying report is true.
  const moderation = await moderateReport(draft);
  if (moderation.decision === 'REJECT') {
    throw new ModerationRejectedError(moderation.category, moderation.reason);
  }
  const session = await requireLiveContractSession();
  const prepared = await prepareSubmission(qualification, draft);
  activeSponsorAuthorization = {
    reportCommitment: prepared.reportCommitment,
    powNonce: prepared.powNonce,
  };
  try {
    let chainReceipt;
    try {
      chainReceipt =
        qualification.mode === 'internal'
          ? await session.reporter.submitInternal({
              domain: qualification.domain,
              destinationEmail: qualification.destinationEmail,
              reportCommitment: prepared.reportCommitment,
              secret: qualification.credentialSecret,
              salt: prepared.reportSalt,
            })
          : await session.reporter.submitWhitehat({
              destinationEmail: qualification.destinationEmail,
              reportCommitment: prepared.reportCommitment,
              salt: prepared.reportSalt,
            });
    } catch (error) {
      throw normalizeWalletError(error);
    }
    const receipt = { ...prepared, ...chainReceipt, createdAt: new Date().toISOString() };
    try {
      const result = await deliverVerifiedReport(receipt, draft, attachments);
      return { ...receipt, delivery: result.delivery };
    } catch (error) {
      return {
        ...receipt,
        delivery: 'failed',
        deliveryError: error instanceof Error ? error.message : '리포트 relay에 실패했습니다.',
      };
    }
  } finally {
    activeSponsorAuthorization = undefined;
  }
}
