import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Contract, pureCircuits } from '@ghostwhistle/contract';
import { describe, expect, it } from 'vitest';
import { compactPad32 } from './encoding.js';

const bytes = (value: number) => new Uint8Array(32).fill(value);

describe('Midnight live-binding compatibility', () => {
  it('derives the same internal receipt before and inside the Compact transition', () => {
    const contract = new Contract<Record<string, never>>({});
    const issuerSecret = bytes(1);
    const oracleSecret = bytes(2);
    const initial = contract.initialState(
      createConstructorContext({}, '0'.repeat(64)),
      issuerSecret,
      oracleSecret,
    );
    let context = createCircuitContext(
      sampleContractAddress(),
      initial.currentZswapLocalState,
      initial.currentContractState,
      initial.currentPrivateState,
    );
    const domain = bytes(3);
    const destination = bytes(4);
    const report = bytes(5);
    const secret = bytes(6);
    const salt = bytes(7);
    const credential = pureCircuits.deriveCredential(domain, secret);
    context = contract.impureCircuits.issueCredential(context, credential, issuerSecret).context;

    const transition = contract.impureCircuits.submitInternal(
      context,
      domain,
      destination,
      report,
      domain,
      secret,
      salt,
    );
    const [ticket, nullifier] = transition.result;
    const expectedNullifier = pureCircuits.deriveInternalNullifier(secret, report, salt);
    const expectedDestination = pureCircuits.deriveInternalDestination(domain, destination);
    const expectedTicket = pureCircuits.deriveTicket(
      compactPad32('ghostwhistle:internal:'),
      expectedDestination,
      report,
      expectedNullifier,
    );

    expect(nullifier).toEqual(expectedNullifier);
    expect(ticket).toEqual(expectedTicket);
  });

  it('encodes Compact text tags as fixed 32-byte values', () => {
    const value = 'ghostwhistle:whitehat:';
    const valueLength = new TextEncoder().encode(value).byteLength;
    const tag = compactPad32(value);
    expect(tag).toHaveLength(32);
    expect(new TextDecoder().decode(tag.slice(0, valueLength))).toBe(value);
    expect([...tag.slice(valueLength)]).toEqual(new Array(32 - valueLength).fill(0));
  });
});
