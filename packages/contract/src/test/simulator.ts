import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits, type Ledger } from '../managed/ghostwhistle/contract/index.js';

export type PrivateState = Record<string, never>;

export type SimulatedChainReceipt = {
  ticket: Uint8Array;
  nullifier: Uint8Array;
};

export class GhostWhistleSimulator {
  readonly contract = new Contract<PrivateState>({});
  circuitContext: CircuitContext<PrivateState>;

  constructor(
    readonly issuerSecret: Uint8Array,
    readonly oracleSecret: Uint8Array,
  ) {
    const state = this.contract.initialState(
      createConstructorContext({}, '0'.repeat(64)),
      issuerSecret,
      oracleSecret,
    );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      state.currentZswapLocalState,
      state.currentContractState,
      state.currentPrivateState,
    );
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  deriveCredential(domainHash: Uint8Array, credentialSecret: Uint8Array): Uint8Array {
    return pureCircuits.deriveCredential(domainHash, credentialSecret);
  }

  issueCredential(credential: Uint8Array, issuerSecret = this.issuerSecret): void {
    this.circuitContext = this.contract.impureCircuits.issueCredential(
      this.circuitContext,
      credential,
      issuerSecret,
    ).context;
  }

  revokeCredential(credential: Uint8Array, issuerSecret = this.issuerSecret): void {
    this.circuitContext = this.contract.impureCircuits.revokeCredential(
      this.circuitContext,
      credential,
      issuerSecret,
    ).context;
  }

  approveSecurityDestination(destinationEmailHash: Uint8Array, oracleSecret = this.oracleSecret): void {
    this.circuitContext = this.contract.impureCircuits.approveSecurityDestination(
      this.circuitContext,
      destinationEmailHash,
      oracleSecret,
    ).context;
  }

  submitInternal(input: {
    destinationDomainHash: Uint8Array;
    destinationEmailHash: Uint8Array;
    reportCommitment: Uint8Array;
    credentialDomainHash: Uint8Array;
    credentialSecret: Uint8Array;
    reportSalt: Uint8Array;
  }): SimulatedChainReceipt {
    const result = this.contract.impureCircuits.submitInternal(
      this.circuitContext,
      input.destinationDomainHash,
      input.destinationEmailHash,
      input.reportCommitment,
      input.credentialDomainHash,
      input.credentialSecret,
      input.reportSalt,
    );
    this.circuitContext = result.context;
    const [ticket, nullifier] = result.result;
    if (!ticket || !nullifier) throw new Error('Compact contract returned an invalid internal receipt');
    return { ticket, nullifier };
  }

  submitWhitehat(input: {
    destinationEmailHash: Uint8Array;
    reportCommitment: Uint8Array;
    reportSalt: Uint8Array;
  }): SimulatedChainReceipt {
    const result = this.contract.impureCircuits.submitWhitehat(
      this.circuitContext,
      input.destinationEmailHash,
      input.reportCommitment,
      input.reportSalt,
    );
    this.circuitContext = result.context;
    const [ticket, nullifier] = result.result;
    if (!ticket || !nullifier) throw new Error('Compact contract returned an invalid white-hat receipt');
    return { ticket, nullifier };
  }
}

export const bytes = (value: number) => new Uint8Array(32).fill(value);
