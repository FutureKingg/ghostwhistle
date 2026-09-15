import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { beforeAll, describe, expect, it } from 'vitest';
import { pureCircuits } from '../managed/ghostwhistle/contract/index.js';
import { bytes, GhostWhistleSimulator } from './simulator.js';

const compactPad32 = (value: string): Uint8Array => {
  const encoded = new TextEncoder().encode(value);
  const result = new Uint8Array(32);
  result.set(encoded);
  return result;
};

beforeAll(() => setNetworkId('undeployed'));

describe('GhostWhistle Compact contract', () => {
  it('initializes separated roles and empty registries', () => {
    const simulator = new GhostWhistleSimulator(bytes(1), bytes(2));
    const state = simulator.getLedger();
    expect(state.credentialIssuerKey).not.toEqual(state.destinationOracleKey);
    expect(state.credentialCommitments.size()).toBe(0n);
    expect(state.acceptedCount).toBe(0n);
  });

  it('accepts an issued same-domain internal report', () => {
    const simulator = new GhostWhistleSimulator(bytes(1), bytes(2));
    const domain = bytes(3);
    const secret = bytes(4);
    const credential = simulator.deriveCredential(domain, secret);
    simulator.issueCredential(credential);
    const { ticket, nullifier } = simulator.submitInternal({
      destinationDomainHash: domain,
      destinationEmailHash: bytes(7),
      reportCommitment: bytes(5),
      credentialDomainHash: domain,
      credentialSecret: secret,
      reportSalt: bytes(6),
    });
    const state = simulator.getLedger();
    expect(state.acceptedCount).toBe(1n);
    expect(state.acceptedTickets.member(ticket)).toBe(true);
    expect(state.usedNullifiers.member(nullifier)).toBe(true);
    const boundDestination = pureCircuits.deriveInternalDestination(domain, bytes(7));
    expect(ticket).toEqual(
      pureCircuits.deriveTicket(
        compactPad32('ghostwhistle:internal:'),
        boundDestination,
        bytes(5),
        nullifier,
      ),
    );
  });

  it('rejects a credential used for another destination domain', () => {
    const simulator = new GhostWhistleSimulator(bytes(1), bytes(2));
    const credentialDomain = bytes(3);
    const secret = bytes(4);
    simulator.issueCredential(simulator.deriveCredential(credentialDomain, secret));
    expect(() =>
      simulator.submitInternal({
        destinationDomainHash: bytes(9),
        destinationEmailHash: bytes(7),
        reportCommitment: bytes(5),
        credentialDomainHash: credentialDomain,
        credentialSecret: secret,
        reportSalt: bytes(6),
      }),
    ).toThrow('Credential and destination domains differ');
  });

  it('rejects unissued and revoked credentials', () => {
    const domain = bytes(3);
    const secret = bytes(4);
    const unissued = new GhostWhistleSimulator(bytes(1), bytes(2));
    expect(() =>
      unissued.submitInternal({
        destinationDomainHash: domain,
        destinationEmailHash: bytes(7),
        reportCommitment: bytes(5),
        credentialDomainHash: domain,
        credentialSecret: secret,
        reportSalt: bytes(6),
      }),
    ).toThrow('No issued credential');

    const revoked = new GhostWhistleSimulator(bytes(1), bytes(2));
    const credential = revoked.deriveCredential(domain, secret);
    revoked.issueCredential(credential);
    revoked.revokeCredential(credential);
    expect(() =>
      revoked.submitInternal({
        destinationDomainHash: domain,
        destinationEmailHash: bytes(7),
        reportCommitment: bytes(5),
        credentialDomainHash: domain,
        credentialSecret: secret,
        reportSalt: bytes(6),
      }),
    ).toThrow('revoked');
  });

  it('enforces independent issuer and oracle authorization', () => {
    const simulator = new GhostWhistleSimulator(bytes(1), bytes(2));
    expect(() => simulator.issueCredential(bytes(3), bytes(8))).toThrow('Only the credential issuer');
    expect(() => simulator.approveSecurityDestination(bytes(3), bytes(8))).toThrow(
      'Only the destination oracle',
    );
  });

  it('accepts only approved white-hat destinations and rejects replay', () => {
    const simulator = new GhostWhistleSimulator(bytes(1), bytes(2));
    const input = { destinationEmailHash: bytes(3), reportCommitment: bytes(5), reportSalt: bytes(6) };
    expect(() => simulator.submitWhitehat(input)).toThrow('Destination is not in the security.txt registry');
    simulator.approveSecurityDestination(input.destinationEmailHash);
    const { ticket, nullifier } = simulator.submitWhitehat(input);
    expect(simulator.getLedger().acceptedTickets.member(ticket)).toBe(true);
    expect(simulator.getLedger().usedNullifiers.member(nullifier)).toBe(true);
    expect(() => simulator.submitWhitehat(input)).toThrow('already used');
  });
});
