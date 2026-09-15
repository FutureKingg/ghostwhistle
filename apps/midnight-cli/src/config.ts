export type MidnightNetworkId = 'preprod' | 'preview' | 'undeployed';

export type MidnightNetworkConfig = {
  networkId: MidnightNetworkId;
  indexerHttpUrl: string;
  indexerWsUrl: string;
  nodeUrl: string;
  proofServerUrl: string;
  faucetUrl?: string;
};

export const NETWORKS: Record<MidnightNetworkId, MidnightNetworkConfig> = {
  preprod: {
    networkId: 'preprod',
    indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.preprod.midnight.network',
    proofServerUrl: 'http://127.0.0.1:6300',
    faucetUrl: 'https://midnight-tmnight-preprod.nethermind.dev/',
  },
  preview: {
    networkId: 'preview',
    indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.preview.midnight.network',
    proofServerUrl: 'http://127.0.0.1:6300',
    faucetUrl: 'https://midnight-tmnight-preview.nethermind.dev/',
  },
  undeployed: {
    networkId: 'undeployed',
    indexerHttpUrl: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    nodeUrl: 'http://127.0.0.1:9944',
    proofServerUrl: 'http://127.0.0.1:6300',
  },
};

export const PREPROD = NETWORKS.preprod;

const networkFromArgs = (): string | undefined => {
  const inline = process.argv.find((argument) => argument.startsWith('--network='));
  if (inline) return inline.slice('--network='.length);
  const index = process.argv.indexOf('--network');
  return index >= 0 ? process.argv[index + 1] : undefined;
};

export const getNetworkConfig = (): MidnightNetworkConfig => {
  const requested = networkFromArgs() ?? process.env.GHOSTWHISTLE_NETWORK ?? 'preview';
  if (!(requested in NETWORKS)) {
    throw new Error(`Unsupported network "${requested}". Choose preprod, preview, or undeployed.`);
  }
  return NETWORKS[requested as MidnightNetworkId];
};

export const LOCAL_VAULT_FILE = new URL('../.local/wallet-vault.json', import.meta.url);
export const ADMIN_VAULT_FILE = new URL('../.local/admin-secrets-vault.json', import.meta.url);
