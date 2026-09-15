import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialCommitment_0: Uint8Array,
                  _issuerSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialCommitment_0: Uint8Array,
                   _issuerSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  approveSecurityDestination(context: __compactRuntime.CircuitContext<PS>,
                             destinationEmailHash_0: Uint8Array,
                             _oracleSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitInternal(context: __compactRuntime.CircuitContext<PS>,
                 destinationDomainHash_0: Uint8Array,
                 destinationEmailHash_0: Uint8Array,
                 reportCommitment_0: Uint8Array,
                 credentialDomainHash_0: Uint8Array,
                 credentialSecret_0: Uint8Array,
                 reportSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array[]>;
  submitWhitehat(context: __compactRuntime.CircuitContext<PS>,
                 destinationEmailHash_0: Uint8Array,
                 reportCommitment_0: Uint8Array,
                 reportSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array[]>;
}

export type ProvableCircuits<PS> = {
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialCommitment_0: Uint8Array,
                  _issuerSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialCommitment_0: Uint8Array,
                   _issuerSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  approveSecurityDestination(context: __compactRuntime.CircuitContext<PS>,
                             destinationEmailHash_0: Uint8Array,
                             _oracleSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitInternal(context: __compactRuntime.CircuitContext<PS>,
                 destinationDomainHash_0: Uint8Array,
                 destinationEmailHash_0: Uint8Array,
                 reportCommitment_0: Uint8Array,
                 credentialDomainHash_0: Uint8Array,
                 credentialSecret_0: Uint8Array,
                 reportSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array[]>;
  submitWhitehat(context: __compactRuntime.CircuitContext<PS>,
                 destinationEmailHash_0: Uint8Array,
                 reportCommitment_0: Uint8Array,
                 reportSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array[]>;
}

export type PureCircuits = {
  deriveRoleKey(role_0: Uint8Array, secret_0: Uint8Array): Uint8Array;
  deriveCredential(domainHash_0: Uint8Array, secret_0: Uint8Array): Uint8Array;
  deriveInternalNullifier(secret_0: Uint8Array,
                          report_0: Uint8Array,
                          salt_0: Uint8Array): Uint8Array;
  deriveWhitehatNullifier(report_0: Uint8Array, salt_0: Uint8Array): Uint8Array;
  deriveInternalDestination(domain_0: Uint8Array, email_0: Uint8Array): Uint8Array;
  deriveTicket(kind_0: Uint8Array,
               destination_0: Uint8Array,
               report_0: Uint8Array,
               nullifier_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialCommitment_0: Uint8Array,
                  _issuerSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialCommitment_0: Uint8Array,
                   _issuerSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  approveSecurityDestination(context: __compactRuntime.CircuitContext<PS>,
                             destinationEmailHash_0: Uint8Array,
                             _oracleSecret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitInternal(context: __compactRuntime.CircuitContext<PS>,
                 destinationDomainHash_0: Uint8Array,
                 destinationEmailHash_0: Uint8Array,
                 reportCommitment_0: Uint8Array,
                 credentialDomainHash_0: Uint8Array,
                 credentialSecret_0: Uint8Array,
                 reportSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array[]>;
  submitWhitehat(context: __compactRuntime.CircuitContext<PS>,
                 destinationEmailHash_0: Uint8Array,
                 reportCommitment_0: Uint8Array,
                 reportSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array[]>;
  deriveRoleKey(context: __compactRuntime.CircuitContext<PS>,
                role_0: Uint8Array,
                secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  deriveCredential(context: __compactRuntime.CircuitContext<PS>,
                   domainHash_0: Uint8Array,
                   secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  deriveInternalNullifier(context: __compactRuntime.CircuitContext<PS>,
                          secret_0: Uint8Array,
                          report_0: Uint8Array,
                          salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  deriveWhitehatNullifier(context: __compactRuntime.CircuitContext<PS>,
                          report_0: Uint8Array,
                          salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  deriveInternalDestination(context: __compactRuntime.CircuitContext<PS>,
                            domain_0: Uint8Array,
                            email_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  deriveTicket(context: __compactRuntime.CircuitContext<PS>,
               kind_0: Uint8Array,
               destination_0: Uint8Array,
               report_0: Uint8Array,
               nullifier_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
  readonly credentialIssuerKey: Uint8Array;
  readonly destinationOracleKey: Uint8Array;
  credentialCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  revokedCredentialCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  approvedSecurityDestinations: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  usedNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  acceptedTickets: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly acceptedCount: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               _credentialIssuerSecret_0: Uint8Array,
               _destinationOracleSecret_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
