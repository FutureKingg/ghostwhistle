import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  GhostWhistleError,
  InMemoryOtpStore,
  LocalModerationAdapter,
  OtpService,
  SlidingWindowRateLimiter,
  createWhitehatQualification,
  issueCredentialAfterOtp,
  normalizeReportAttachments,
  verifyPow,
  type CredentialRegistryPort,
  type DestinationRegistryPort,
  type OtpDeliveryPort,
  type OtpStore,
  type RelayMessage,
  type RelayAttachment,
  type RelayPort,
  type ModerationPort,
  type SecurityTxtResolverPort,
} from '@ghostwhistle/core';
import { submitWithRpcRecovery } from './submission.js';
import { InMemoryReportDeliveryStore, type ReportDeliveryStore } from './report-delivery-store.js';

export type SponsorOptions = {
  wallet: WalletFacade;
  secrets: { shieldedSecretKeys: ledger.ZswapSecretKeys; dustSecretKey: ledger.DustSecretKey };
  unshieldedKeystore: { signData: (payload: Uint8Array) => ledger.Signature };
  indexerHttpUrl: string;
  contractAddress: string;
};

export type WhitehatOptions = {
  resolver: SecurityTxtResolverPort;
  registry: DestinationRegistryPort;
};

export type ReportRelayOptions = {
  relay: RelayPort;
  delivery: 'email' | 'verified-local';
};

export type RequestRateLimiter = {
  consume(
    key: string,
  ): { remaining: number; resetAt: number } | Promise<{ remaining: number; resetAt: number }>;
};

export type IssuerServerOptions = {
  registry: CredentialRegistryPort;
  delivery: OtpDeliveryPort;
  host?: string;
  port?: number;
  allowedOrigin?: string;
  sponsor?: SponsorOptions;
  whitehat?: WhitehatOptions;
  reportRelay?: ReportRelayOptions;
  deliveryStore?: ReportDeliveryStore;
  rateLimiterFactory?: (namespace: string, maxEvents: number, windowMs: number) => RequestRateLimiter;
  moderation?: ModerationPort;
  otpStore?: OtpStore;
  exposeDevelopmentOtp?: boolean;
};

export async function startIssuerServer(options: IssuerServerOptions): Promise<Server> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8787;
  const allowedOrigin = options.allowedOrigin ?? 'http://127.0.0.1:4173';
  const allowedOrigins = new Set([
    allowedOrigin,
    ...(allowedOrigin === 'http://127.0.0.1:4173' ? ['http://localhost:4173'] : []),
  ]);
  const developmentOtpCodes = new Map<string, string>();
  const otp = new OtpService(options.otpStore ?? new InMemoryOtpStore(), {
    async send(input) {
      if (options.exposeDevelopmentOtp) developmentOtpCodes.set(input.to.toLowerCase(), input.code);
      await options.delivery.send(input);
    },
  });
  const createRateLimiter =
    options.rateLimiterFactory ??
    ((_namespace: string, maxEvents: number, windowMs: number) =>
      new SlidingWindowRateLimiter(maxEvents, windowMs));
  const requests = createRateLimiter('otp', 3, 10 * 60 * 1000);
  const sponsorRequests = createRateLimiter('sponsor', 5, 10 * 60 * 1000);
  const whitehatRequests = createRateLimiter('whitehat', 10, 10 * 60 * 1000);
  const relayRequests = createRateLimiter('relay', 5, 10 * 60 * 1000);
  const moderationRequests = createRateLimiter('moderation', 30, 10 * 60 * 1000);
  const moderation = options.moderation ?? new LocalModerationAdapter();
  const deliveryStore = options.deliveryStore ?? new InMemoryReportDeliveryStore();

  const server = createServer(async (request, response) => {
    const requestOrigin = request.headers.origin;
    setCommonHeaders(
      response,
      requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : allowedOrigin,
    );
    try {
      if (!originAllowed(request, allowedOrigins)) {
        sendJson(response, 403, { error: 'Origin is not allowed.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ready' });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/internal/request') {
        const body = await readJson(request);
        const email = requiredString(body.email, 'email');
        const credentialCommitment = requiredString(body.credentialCommitment, 'credentialCommitment');
        const remoteAddress = request.socket.remoteAddress ?? 'unknown';
        await requests.consume(`ip:${remoteAddress}`);
        await requests.consume(`email:${email.toLowerCase()}`);
        const challenge = await otp.request(email, credentialCommitment);
        const developmentCode = options.exposeDevelopmentOtp
          ? developmentOtpCodes.get(email.toLowerCase())
          : undefined;
        developmentOtpCodes.delete(email.toLowerCase());
        sendJson(response, 201, { ...challenge, ...(developmentCode ? { developmentCode } : {}) });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/internal/verify') {
        const body = await readJson(request);
        const code = requiredString(body.code, 'code');
        if (!/^\d{6}$/.test(code)) {
          throw new GhostWhistleError('code must be a 6-digit value.', 'INVALID_INPUT');
        }
        const issuance = await issueCredentialAfterOtp(
          requiredString(body.challengeId, 'challengeId'),
          code,
          otp,
          options.registry,
        );
        sendJson(response, 200, issuance);
        return;
      }
      if (request.method === 'POST' && request.url === '/api/whitehat/qualify') {
        if (!options.whitehat) {
          sendJson(response, 503, { error: 'Whitehat qualification is not configured.' });
          return;
        }
        const remoteAddress = request.socket.remoteAddress ?? 'unknown';
        await whitehatRequests.consume(`ip:${remoteAddress}`);
        const body = await readJson(request);
        const domain = requiredString(body.domain, 'domain');
        const securityTxt = await options.whitehat.resolver.resolve(domain);
        const qualification = createWhitehatQualification(domain, securityTxt);
        await options.whitehat.registry.approveSecurityDestination(qualification.destinationEmail);
        sendJson(response, 200, qualification);
        return;
      }
      if (request.method === 'POST' && request.url === '/api/report/moderate') {
        const remoteAddress = request.socket.remoteAddress ?? 'unknown';
        await moderationRequests.consume(`ip:${remoteAddress}`);
        const body = await readJson(request, 80 * 1024);
        const title = boundedString(body.title, 'title', 200);
        const summary = boundedString(body.summary, 'summary', 4_000);
        const details = boundedString(body.details, 'details', 64_000);
        const decision = await moderation.classify(`${title}\n${summary}\n${details}`);
        sendJson(response, 200, decision);
        return;
      }
      if (request.method === 'POST' && request.url === '/api/relay/submit') {
        if (!options.sponsor) {
          sendJson(response, 503, { error: 'DUST sponsor is not configured.' });
          return;
        }
        const remoteAddress = request.socket.remoteAddress ?? 'unknown';
        await sponsorRequests.consume(`ip:${remoteAddress}`);
        const body = await readJson(request, 12 * 1024 * 1024);
        const txHex = requiredHex(body.tx, 'tx', 12 * 1024 * 1024);
        const reportCommitment = exactHex(body.reportCommitment, 'reportCommitment', 32);
        const powNonce = body.powNonce;
        if (typeof powNonce !== 'number' || !(await verifyPow(reportCommitment, powNonce))) {
          throw new GhostWhistleError('Proof-of-work verification failed.', 'INVALID_INPUT');
        }
        const transaction = ledger.Transaction.deserialize<
          ledger.SignatureEnabled,
          ledger.Proof,
          ledger.Binding
        >('signature', 'proof', 'binding', Buffer.from(txHex, 'hex'));
        assertSponsoredContractCall(transaction, options.sponsor.contractAddress);
        const recipe = await options.sponsor.wallet.balanceFinalizedTransaction(
          transaction,
          options.sponsor.secrets,
          {
            ttl: new Date(Date.now() + 3_600_000),
            tokenKindsToBalance: ['dust'],
          },
        );
        const signed = await options.sponsor.wallet.signRecipe(recipe, (payload) =>
          options.sponsor!.unshieldedKeystore.signData(payload),
        );
        const finalized = await options.sponsor.wallet.finalizeRecipe(signed);
        const transactionId = await submitWithRpcRecovery(
          options.sponsor.wallet,
          options.sponsor.indexerHttpUrl,
          finalized,
        );
        sendJson(response, 200, { transactionId });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/report/deliver') {
        if (!options.reportRelay) {
          sendJson(response, 503, { error: 'Report relay is not configured.' });
          return;
        }
        const remoteAddress = request.socket.remoteAddress ?? 'unknown';
        await relayRequests.consume(`ip:${remoteAddress}`);
        const message = parseRelayMessage(await readJson(request, 16 * 1024 * 1024));
        const claim = await deliveryStore.claim(message.ticket);
        if (claim === 'already-delivered') {
          sendJson(response, 200, { delivery: options.reportRelay.delivery, duplicate: true });
          return;
        }
        if (claim === 'in-progress') {
          sendJson(response, 409, { error: 'This report delivery is already in progress.' });
          return;
        }
        try {
          await options.reportRelay.relay.deliver(message);
          await deliveryStore.complete(message.ticket);
        } catch (error) {
          await deliveryStore.release(message.ticket);
          throw error;
        }
        sendJson(response, 200, { delivery: options.reportRelay.delivery, duplicate: false });
        return;
      }
      sendJson(response, 404, { error: 'Route not found.' });
    } catch (error) {
      const status = error instanceof GhostWhistleError ? 400 : 500;
      const message = error instanceof Error ? error.message : 'Unknown issuer failure.';
      sendJson(response, status, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export function assertSponsoredContractCall(
  transaction: Pick<ledger.FinalizedTransaction, 'intents'>,
  contractAddress: string,
): void {
  const actions = [...(transaction.intents?.values() ?? [])].flatMap((intent) => intent.actions);
  const calls = actions.filter(
    (action): action is ledger.ContractCall<ledger.Proof> =>
      typeof action === 'object' && action !== null && 'address' in action && 'entryPoint' in action,
  );
  if (actions.length !== 1 || calls.length !== 1) {
    throw new GhostWhistleError(
      'Sponsor accepts exactly one GhostWhistle contract call.',
      'POLICY_VIOLATION',
    );
  }
  const [call] = calls;
  if (call.address !== contractAddress) {
    throw new GhostWhistleError('Sponsor transaction targets an unapproved contract.', 'POLICY_VIOLATION');
  }
  const entryPoint =
    typeof call.entryPoint === 'string' ? call.entryPoint : Buffer.from(call.entryPoint).toString('hex');
  const allowedEntryPoints = new Set([
    'submitInternal',
    'submitWhitehat',
    ledger.entryPointHash('submitInternal'),
    ledger.entryPointHash('submitWhitehat'),
  ]);
  if (!allowedEntryPoints.has(entryPoint)) {
    throw new GhostWhistleError('Sponsor accepts report submission circuits only.', 'POLICY_VIOLATION');
  }
}

export async function waitForIssuerShutdown(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    const close = () => server.close(() => resolve());
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}

function setCommonHeaders(response: ServerResponse, allowedOrigin: string): void {
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function originAllowed(request: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.origin;
  return origin === undefined || allowedOrigins.has(origin);
}

async function readJson(request: IncomingMessage, maxBytes = 16_384): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) throw new GhostWhistleError('Request body is too large.', 'INVALID_INPUT');
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new GhostWhistleError('Request body must be a JSON object.', 'INVALID_INPUT');
  }
}

function requiredHex(value: unknown, name: string, maxBytes: number): string {
  const text = requiredString(value, name);
  if (
    text.length === 0 ||
    text.length % 2 !== 0 ||
    text.length > maxBytes * 2 ||
    !/^[0-9a-f]+$/i.test(text)
  ) {
    throw new GhostWhistleError(`${name} must be an even-length hexadecimal value.`, 'INVALID_INPUT');
  }
  return text;
}

function exactHex(value: unknown, name: string, byteLength: number): string {
  const text = requiredHex(value, name, byteLength);
  if (text.length !== byteLength * 2) {
    throw new GhostWhistleError(`${name} must be exactly ${byteLength} bytes.`, 'INVALID_INPUT');
  }
  return text;
}

function parseRelayMessage(value: Record<string, unknown>): RelayMessage {
  const report = requiredRecord(value.body, 'body');
  const verification = requiredRecord(value.verification, 'verification');
  const attachments = parseRelayAttachments(value.attachments);
  const mode = verification.mode;
  if (mode !== 'internal' && mode !== 'whitehat') {
    throw new GhostWhistleError('verification.mode is invalid.', 'INVALID_INPUT');
  }
  const to = requiredString(value.to, 'to').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new GhostWhistleError('to must be a valid email address.', 'INVALID_INPUT');
  }
  return {
    ticket: exactHex(value.ticket, 'ticket', 32),
    to,
    subject: boundedString(value.subject, 'subject', 200),
    body: {
      departmentOrAsset: boundedString(report.departmentOrAsset, 'body.departmentOrAsset', 200),
      title: boundedString(report.title, 'body.title', 200),
      summary: boundedString(report.summary, 'body.summary', 4_000),
      details: boundedString(report.details, 'body.details', 64_000),
      attachments: attachments.map(({ name, mediaType, size, sha256 }) => ({
        name,
        mediaType,
        size,
        sha256,
      })),
    },
    verification: {
      mode,
      reportCommitment: exactHex(verification.reportCommitment, 'verification.reportCommitment', 32),
      destinationCommitment: exactHex(
        verification.destinationCommitment,
        'verification.destinationCommitment',
        32,
      ),
      reportSalt: Buffer.from(exactHex(verification.reportSalt, 'verification.reportSalt', 32), 'hex'),
      nullifier: exactHex(verification.nullifier, 'verification.nullifier', 32),
    },
    attachments,
  };
}

function parseRelayAttachments(value: unknown): RelayAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new GhostWhistleError('attachments must be an array.', 'INVALID_INPUT');
  }

  const parsed = value.map((item, index) => {
    const attachment = requiredRecord(item, `attachments[${index}]`);
    const contentBase64 = requiredString(attachment.contentBase64, `attachments[${index}].contentBase64`);
    if (!isCanonicalBase64(contentBase64)) {
      throw new GhostWhistleError(`attachments[${index}].contentBase64 is invalid.`, 'INVALID_INPUT');
    }
    const bytes = Buffer.from(contentBase64, 'base64');
    const declaredSize = attachment.size;
    if (!Number.isSafeInteger(declaredSize)) {
      throw new GhostWhistleError(`attachments[${index}].size must be an integer.`, 'INVALID_INPUT');
    }
    const sha256 = exactHex(attachment.sha256, `attachments[${index}].sha256`, 32);
    if (bytes.byteLength !== declaredSize) {
      throw new GhostWhistleError(`attachments[${index}] size verification failed.`, 'INVALID_INPUT');
    }
    if (createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) {
      throw new GhostWhistleError(`attachments[${index}] digest verification failed.`, 'INVALID_INPUT');
    }
    assertEvidenceContent(
      bytes,
      requiredString(attachment.mediaType, `attachments[${index}].mediaType`),
      index,
    );
    return {
      name: requiredString(attachment.name, `attachments[${index}].name`),
      mediaType: requiredString(attachment.mediaType, `attachments[${index}].mediaType`),
      size: declaredSize,
      sha256,
      contentBase64,
    };
  });

  const normalized = normalizeReportAttachments(parsed);
  return parsed.map((attachment, index) => ({
    ...normalized[index]!,
    contentBase64: attachment.contentBase64,
  }));
}

function assertEvidenceContent(bytes: Buffer, mediaTypeInput: string, index: number): void {
  const mediaType = mediaTypeInput.trim().toLowerCase();
  const startsWith = (...signature: number[]) =>
    bytes.byteLength >= signature.length &&
    bytes.subarray(0, signature.length).equals(Buffer.from(signature));
  const asciiAt = (offset: number, value: string) =>
    bytes.byteLength >= offset + value.length &&
    bytes.subarray(offset, offset + value.length).toString('ascii') === value;

  let valid = true;
  switch (mediaType) {
    case 'image/png':
      valid = startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
      break;
    case 'image/jpeg':
      valid = startsWith(0xff, 0xd8, 0xff);
      break;
    case 'image/gif':
      valid = asciiAt(0, 'GIF87a') || asciiAt(0, 'GIF89a');
      break;
    case 'image/webp':
      valid = asciiAt(0, 'RIFF') && asciiAt(8, 'WEBP');
      break;
    case 'application/pdf':
      valid = asciiAt(0, '%PDF-');
      break;
    case 'application/json':
      try {
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        valid = false;
      }
      break;
    case 'text/csv':
    case 'text/plain':
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        valid = !text.includes('\0');
      } catch {
        valid = false;
      }
      break;
  }

  if (!valid) {
    throw new GhostWhistleError(
      `attachments[${index}] content does not match its declared media type.`,
      'INVALID_INPUT',
    );
  }
}

function isCanonicalBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GhostWhistleError(`${name} must be a JSON object.`, 'INVALID_INPUT');
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, name: string, maxLength: number): string {
  const text = requiredString(value, name);
  if (text.length > maxLength) {
    throw new GhostWhistleError(`${name} exceeds ${maxLength} characters.`, 'INVALID_INPUT');
  }
  return text;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GhostWhistleError(`${name} is required.`, 'INVALID_INPUT');
  }
  return value.trim();
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
