import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as GhostWhistle from './managed/ghostwhistle/contract/index.js';

export * from './managed/ghostwhistle/contract/index.js';

export type GhostWhistlePrivateState = Record<string, never>;
export type GhostWhistleContract = GhostWhistle.Contract<GhostWhistlePrivateState>;

export const compiledGhostWhistleContract = CompiledContract.make<GhostWhistleContract>(
  'GhostWhistle',
  GhostWhistle.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets('./managed/ghostwhistle'),
);
