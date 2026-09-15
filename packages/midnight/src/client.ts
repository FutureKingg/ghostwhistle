import {
  compiledGhostWhistleContract,
  ledger,
  pureCircuits,
  type GhostWhistleContract,
  type GhostWhistlePrivateState,
  type Ledger,
} from '@ghostwhistle/contract';
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';
import {
  canonicalReport,
  destinationCommitment,
  domainCommitment,
  hexToBytes,
  isOfficialDestination,
  normalizeDomain,
  reportCommitment,
  type ChainReceipt,
  type RelayMessage,
} from '@ghostwhistle/core';
import { compactPad32 } from './encoding.js';

export const ghostWhistlePrivateStateId = 'ghostWhistlePrivateState';
export type GhostWhistlePrivateStateId = typeof ghostWhistlePrivateStateId;
export type GhostWhistleCircuit = Exclude<keyof GhostWhistleContract['impureCircuits'], number | symbol>;
export type GhostWhistleProviders = MidnightProviders<
  GhostWhistleCircuit,
  GhostWhistlePrivateStateId,
  GhostWhistlePrivateState
>;
export type DeployedGhostWhistleContract = FoundContract<GhostWhistleContract>;

const emptyPrivateState = (): GhostWhistlePrivateState => ({});

export class GhostWhistleContractClient {
  private constructor(
    readonly deployedContract: DeployedGhostWhistleContract,
    private readonly providers: GhostWhistleProviders,
  ) {}

  get address(): ContractAddress {
    return this.deployedContract.deployTxData.public.contractAddress;
  }

  static async deploy(
    providers: GhostWhistleProviders,
    issuerSecret: Uint8Array,
    oracleSecret: Uint8Array,
  ): Promise<GhostWhistleContractClient> {
    assertBytes32(issuerSecret, 'Issuer secret');
    assertBytes32(oracleSecret, 'Oracle secret');
    const deployed = await deployContract(providers, {
      compiledContract: compiledGhostWhistleContract,
      privateStateId: ghostWhistlePrivateStateId,
      initialPrivateState: emptyPrivateState(),
      args: [issuerSecret, oracleSecret],
    });
    providers.privateStateProvider.setContractAddress(deployed.deployTxData.public.contractAddress);
    return new GhostWhistleContractClient(deployed, providers);
  }

  static async join(
    providers: GhostWhistleProviders,
    contractAddress: string,
  ): Promise<GhostWhistleContractClient> {
    assertIsContractAddress(contractAddress);
    providers.privateStateProvider.setContractAddress(contractAddress);
    const deployed = await findDeployedContract<GhostWhistleContract>(providers, {
      contractAddress,
      compiledContract: compiledGhostWhistleContract,
      privateStateId: ghostWhistlePrivateStateId,
      initialPrivateState: emptyPrivateState(),
    });
    return new GhostWhistleContractClient(deployed, providers);
  }

  async getLedger(): Promise<Ledger> {
    const state = await this.providers.publicDataProvider.queryContractState(this.address);
    if (!state) throw new Error(`GhostWhistle contract was not found at ${this.address}.`);
    return ledger(state.data);
  }

  async deriveCredentialAsync(domain: string, secret: Uint8Array): Promise<string> {
    assertBytes32(secret, 'Credential secret');
    return toHex(
      pureCircuits.deriveCredential(hexToBytes(await domainCommitment(normalizeDomain(domain))), secret),
    );
  }

  async issueCredential(credentialCommitment: string, issuerSecret: Uint8Array): Promise<void> {
    await this.deployedContract.callTx.issueCredential(hexToBytes(credentialCommitment), issuerSecret);
  }

  async revokeCredential(credentialCommitment: string, issuerSecret: Uint8Array): Promise<void> {
    await this.deployedContract.callTx.revokeCredential(hexToBytes(credentialCommitment), issuerSecret);
  }

  async approveSecurityDestination(destinationEmail: string, oracleSecret: Uint8Array): Promise<void> {
    const destinationHash = await destinationCommitment(destinationEmail);
    const destination = hexToBytes(destinationHash);
    const currentLedger = await this.getLedger();
    if (currentLedger.approvedSecurityDestinations.member(destination)) return;

    try {
      await this.deployedContract.callTx.approveSecurityDestination(destination, oracleSecret);
    } catch (error) {
      // A concurrent qualification may approve the same destination after the
      // ledger check. Treat that race as success so this operation is idempotent.
      if (error instanceof Error && error.message.includes('Destination is already approved')) return;
      throw error;
    }
  }

  async submitInternal(input: {
    domain: string;
    destinationEmail: string;
    reportCommitment: string;
    secret: Uint8Array;
    salt: Uint8Array;
  }): Promise<ChainReceipt> {
    const domainHash = hexToBytes(await domainCommitment(normalizeDomain(input.domain)));
    const destinationHash = hexToBytes(await destinationCommitment(input.destinationEmail));
    const reportHash = hexToBytes(input.reportCommitment);
    const nullifier = pureCircuits.deriveInternalNullifier(input.secret, reportHash, input.salt);
    const internalDestination = pureCircuits.deriveInternalDestination(domainHash, destinationHash);
    const ticket = pureCircuits.deriveTicket(
      compactPad32('ghostwhistle:internal:'),
      internalDestination,
      reportHash,
      nullifier,
    );
    const submitted = await this.deployedContract.callTx.submitInternal(
      domainHash,
      destinationHash,
      reportHash,
      domainHash,
      input.secret,
      input.salt,
    );
    return { ticket: toHex(ticket), nullifier: toHex(nullifier), transactionId: submitted.public.txId };
  }

  async submitWhitehat(input: {
    destinationEmail: string;
    reportCommitment: string;
    salt: Uint8Array;
  }): Promise<ChainReceipt> {
    const destinationHash = hexToBytes(await destinationCommitment(input.destinationEmail));
    const reportHash = hexToBytes(input.reportCommitment);
    const nullifier = pureCircuits.deriveWhitehatNullifier(reportHash, input.salt);
    const ticket = pureCircuits.deriveTicket(
      compactPad32('ghostwhistle:whitehat:'),
      destinationHash,
      reportHash,
      nullifier,
    );
    const submitted = await this.deployedContract.callTx.submitWhitehat(
      destinationHash,
      reportHash,
      input.salt,
    );
    return { ticket: toHex(ticket), nullifier: toHex(nullifier), transactionId: submitted.public.txId };
  }

  async verifyRelayMessage(message: RelayMessage): Promise<boolean> {
    const destinationDomain = message.to.split('@')[1];
    if (
      message.verification.mode === 'internal' &&
      (!destinationDomain || !isOfficialDestination(message.to, destinationDomain, 'audit'))
    )
      return false;
    const destinationHash = await destinationCommitment(message.to);
    const reportHash = await reportCommitment(canonicalReport(message.body), message.verification.reportSalt);
    if (
      destinationHash !== message.verification.destinationCommitment ||
      reportHash !== message.verification.reportCommitment
    )
      return false;
    const expectedTicket = pureCircuits.deriveTicket(
      compactPad32(`ghostwhistle:${message.verification.mode}:`),
      message.verification.mode === 'internal'
        ? pureCircuits.deriveInternalDestination(
            hexToBytes(await domainCommitment(destinationDomain!)),
            hexToBytes(destinationHash),
          )
        : hexToBytes(destinationHash),
      hexToBytes(reportHash),
      hexToBytes(message.verification.nullifier),
    );
    if (toHex(expectedTicket) !== message.ticket) return false;
    return (await this.getLedger()).acceptedTickets.member(expectedTicket);
  }
}

function assertBytes32(value: Uint8Array, label: string): void {
  if (value.byteLength !== 32) throw new Error(`${label} must be 32 bytes.`);
}
