import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type {
  ExportPrivateStatesOptions,
  ExportSigningKeysOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  PrivateStateId,
  PrivateStateProvider,
  SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';

/** Browser-only ephemeral storage. No report, email, or credential secret is persisted here. */
export function ephemeralPrivateStateProvider<PSI extends PrivateStateId, PS>(): PrivateStateProvider<
  PSI,
  PS
> {
  const states = new Map<ContractAddress, Map<PSI, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let activeAddress: ContractAddress | undefined;
  const requireAddress = () => {
    if (!activeAddress) throw new Error('Contract address must be selected before private-state access.');
    return activeAddress;
  };
  const scoped = (address = requireAddress()) => {
    let state = states.get(address);
    if (!state) {
      state = new Map();
      states.set(address, state);
    }
    return state;
  };
  const encode = (value: unknown) => JSON.stringify(value);

  return {
    setContractAddress(address) {
      activeAddress = address;
    },
    async set(key, state) {
      scoped().set(key, state);
    },
    async get(key) {
      return scoped().get(key) ?? null;
    },
    async remove(key) {
      scoped().delete(key);
    },
    async clear() {
      states.delete(requireAddress());
    },
    async setSigningKey(address, signingKey) {
      signingKeys.set(address, signingKey);
    },
    async getSigningKey(address) {
      return signingKeys.get(address) ?? null;
    },
    async removeSigningKey(address) {
      signingKeys.delete(address);
    },
    async clearSigningKeys() {
      signingKeys.clear();
    },
    async exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      const address = requireAddress();
      return {
        format: 'midnight-private-state-export',
        encryptedPayload: encode({ address, states: Object.fromEntries(scoped(address)) }),
        salt: 'ephemeral-browser-provider',
      };
    },
    async importPrivateStates(
      _data: PrivateStateExport,
      _options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      throw new Error('Import is disabled for ephemeral GhostWhistle private state.');
    },
    async exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      return {
        format: 'midnight-signing-key-export',
        encryptedPayload: encode({ keys: Object.fromEntries(signingKeys) }),
        salt: 'ephemeral-browser-provider',
      };
    },
    async importSigningKeys(
      _data: SigningKeyExport,
      _options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      throw new Error('Signing-key import is disabled for the ephemeral browser provider.');
    },
  };
}
