import { randomBytes } from 'node:crypto';
import { getNetworkConfig } from './config.js';
import { prepareSeed } from './vault.js';

const network = getNetworkConfig();

console.log(`\nGhostWhistle Midnight CLI · ${network.networkId} admin wallet\n`);
console.log(`  Network: ${network.networkId}`);
console.log(`  Proof server: ${network.proofServerUrl}`);

// Unlock the vault before loading Midnight's large ESM graph. On Windows with
// Node 24 those imports can be slow, and previously left a blank terminal that
// looked as though the password prompt had failed to open.
if (!process.argv.includes('--doctor')) {
  await prepareSeed(() => randomBytes(32).toString('hex'), network.networkId);
}

console.log('  Loading Midnight SDK…');

await import('./cli.js');
