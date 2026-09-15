import { BlockList, isIP } from 'node:net';
import { lookup as nodeLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import {
  invalidInput,
  normalizeDomain,
  parseSecurityTxt,
  type SecurityTxt,
  type SecurityTxtResolverPort,
} from '@ghostwhistle/core';

export type LookupAddress = { address: string; family: number };
type Lookup = (hostname: string) => Promise<LookupAddress[]>;
export type SecurityTxtTransport = (input: {
  url: string;
  address: LookupAddress;
  maxBytes: number;
}) => Promise<{ status: number; body: string }>;

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');

export function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (family === 0) throw invalidInput('DNS returned an invalid address.');
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
    return assertPublicAddress(address.slice(7));
  }
  if (blocked.check(address, family === 4 ? 'ipv4' : 'ipv6'))
    throw invalidInput('security.txt resolved to a non-public address.');
}

export class SecureSecurityTxtResolver implements SecurityTxtResolverPort {
  constructor(
    private readonly dependencies: {
      lookup?: Lookup;
      transport?: SecurityTxtTransport;
      maxBytes?: number;
    } = {},
  ) {}

  async resolve(domainInput: string): Promise<SecurityTxt> {
    const domain = normalizeDomain(domainInput);
    const addresses = await (this.dependencies.lookup ?? defaultLookup)(domain);
    if (addresses.length === 0) throw invalidInput('security.txt domain did not resolve.');
    addresses.forEach(({ address }) => assertPublicAddress(address));

    const url = `https://${domain}/.well-known/security.txt`;
    const maxBytes = this.dependencies.maxBytes ?? 128 * 1024;
    const response = await (this.dependencies.transport ?? pinnedHttpsTransport)({
      url,
      address: addresses[0],
      maxBytes,
    });
    if (response.status < 200 || response.status >= 300)
      throw invalidInput(`Unable to fetch security.txt (${response.status}).`);
    return parseSecurityTxt(response.body, url);
  }
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return nodeLookup(hostname, { all: true, verbatim: true });
}

export const pinnedHttpsTransport: SecurityTxtTransport = ({ url, address, maxBytes }) =>
  new Promise((resolve, reject) => {
    const family = isIP(address.address);
    if (family === 0) return reject(invalidInput('Pinned security.txt address is invalid.'));
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        headers: { accept: 'text/plain', 'user-agent': 'GhostWhistle/0.1' },
        // Node 24 may ask for all lookup results when auto-selecting a family.
        // Returning a single string in that mode makes node:net treat the
        // address as an array and eventually try to connect to `undefined`.
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [{ address: address.address, family }]);
            return;
          }
          callback(null, address.address, family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const declaredLength = Number(response.headers['content-length'] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.destroy(invalidInput('security.txt exceeds the size limit.'));
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > maxBytes) {
            response.destroy(invalidInput('security.txt exceeds the size limit.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      },
    );
    request.setTimeout(7_000, () => request.destroy(invalidInput('security.txt request timed out.')));
    request.on('error', reject);
    request.end();
  });
