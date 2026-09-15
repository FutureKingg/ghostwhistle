# Midnight public-network runbook

This runbook is for the real Midnight path. The deterministic demo does not count as a network transaction.

## Choose the network first

The hackathon accepts a public `preview` or `preprod` deployment, as well as the
official local `undeployed` devnet. For this project, use `preview` for the shared
demo and keep `preprod` as the final validation option. The CLI keeps the network
ID and all endpoints together so they cannot be mixed accidentally:

```powershell
npm run midnight:proof-server
npm run midnight:wallet -- --network preview --doctor
npm run midnight:wallet -- --network preview --deploy
```

For a local-only workflow, start the official Midnight local devnet and use
`--network undeployed`; it has pre-funded genesis accounts and does not require a
public faucet. A Preview or Preprod wallet has a different address prefix, so fund
the address printed for the selected network rather than reusing an address from a
different environment.

## Pinned compatibility set

- Node.js 24.11.1
- Compact compiler 0.31.1, language version 0.23
- Midnight.js 4.1.1
- DApp Connector API 4.x
- Proof server 8.1.0
- Network: `preview` (switch to `preprod` for final validation)

These versions follow the current official Midnight example repositories and are pinned to avoid accidental protocol drift before judging.

## Prerequisites

1. Install Lace with Midnight DApp Connector API 4.x and select the same network as the command (`Preview` or `Preprod`).
2. Fund that wallet with the assets required by the selected public network transaction flow.
3. Install Docker and start the local prover:

   ```bash
   npm run midnight:proof-server
   ```

4. Confirm `http://127.0.0.1:6300` (or `/version`) responds, then configure that prover URL in Lace.
5. Compile the contract and build the browser-served ZK artifacts:

   ```bash
   npm run contract:compile
   npm run build
   ```

If Lace cannot complete the DUST registration flow, use the isolated official Wallet
SDK utility instead. It uses the selected public-network endpoints and the same local
prover, but does not depend on the Lace extension's wallet-sync state:

```bash
npm run midnight:proof-server
npm run midnight:wallet -- --network preview --doctor   # connectivity check
npm run midnight:wallet -- --network preview --deploy   # after DUST is ready, deploy GhostWhistle
```

The CLI does not wait for the facade's global `isSynced` flag before every action.
It gates tNIGHT discovery on the unshielded ledger, then explicitly waits for the
DUST ledger to reach a strict indexer tip before constructing the registration
transaction. This gate is required: building registration while DUST is still
replaying can produce an opaque SDK `unknown error` and an unusable transaction.
The shielded ledger continues replaying in the background. Live replay positions
are printed in an interactive terminal. A fresh DUST wallet may still need time to
reach the registration and deployment events. The defaults can be adjusted for a
slow connection without changing the source:

```powershell
$env:GHOSTWHISTLE_UNSHIELDED_SYNC_TIMEOUT_MS = '180000'   # tNIGHT/indexer tip
$env:GHOSTWHISTLE_REGISTRATION_TIMEOUT_MS = '600000'      # DUST registration fee
$env:GHOSTWHISTLE_DUST_SYNC_INITIAL_TIMEOUT_MS = '180000' # first DUST update
$env:GHOSTWHISTLE_DUST_SYNC_STALL_TIMEOUT_MS = '600000'   # fail only after no progress
$env:GHOSTWHISTLE_DUST_SYNC_TIMEOUT_MS = '1800000'        # spendable DUST/deploy wait
```

The initial DUST replay has no fixed total-duration limit: a healthy replay may
take longer than 30 minutes on a public indexer. It fails only when no
sync update arrives for the configured stall window.

If registration reports that generated DUST is below its fee, the utility waits
for the projected amount and retries the same UTxOs. Do not request another faucet
transfer for that message.

RPC WebSocket interruptions are handled separately: the CLI checks the selected
indexer for the finalized transaction before retrying, so a watcher timeout cannot
silently cause a duplicate registration. The submission client is opened lazily
after wallet sync rather than during startup, avoiding a stale client when the RPC
endpoint is temporarily unavailable.

On first run the utility creates an encrypted AES-256-GCM vault at
`apps/midnight-cli/.local/wallet-vault.json`. The vault password is entered locally
and is never printed or sent to GhostWhistle. The utility prints an unshielded
address with the selected network prefix (for example `mn_addr_preview...`); paste
only that address into the matching official faucet, then press Enter in the utility.
It registers tNIGHT for DUST generation and
waits for the initial DUST balance. The seed is never committed to the repository.

This CLI wallet is a separate disposable administrator wallet, not a replacement for
the reporter's Lace wallet. It is safe for the hackathon because deployment and
reporting target the same selected network and Compact contract; only the signing
account differs.

`--deploy` also creates a separate encrypted admin-secrets vault. Keep both local
vault passwords: the admin secrets are required later to issue/revoke credentials
and approve `security.txt` destinations. The command prints the contract address and
deployment transaction ID as the only deployment evidence intended for the runbook.

The web build publishes only `keys/` and binary ZK IR files below `/midnight/ghostwhistle/`. It does not publish issuer secrets, oracle secrets, report salts, credentials, emails, or report bodies.

## Connect, deploy, and join

For a one-time deployment, run the isolated local administrator console:

```bash
npm run dev --workspace @ghostwhistle/midnight-admin
```

Open `http://127.0.0.1:5174` in the Chrome profile containing Lace. The console generates independent issuer and destination-oracle secrets in memory and requires an AES-256-GCM encrypted backup before enabling deployment. It does not use local storage or send those secrets to an application server.

`createLaceProviders` discovers a compatible Lace connector, uses Lace's selected
network indexer and prover configuration, and serves the circuit assets from an
absolute base URL such as:

```ts
const providers = await createLaceProviders({
  networkId: 'preview',
  zkAssetBaseUrl: `${window.location.origin}/midnight/ghostwhistle`,
});
```

An administrator deploys once with two independently generated 32-byte secrets. The deployment address is then stored as `VITE_CONTRACT_ADDRESS`; ordinary reporters join that address and never receive either administrator secret.

Never commit the issuer secret, oracle secret, wallet seed, or Lace recovery phrase. A wallet confirmation is required for deployment and each state-changing call.

## Acceptance evidence

Stage 1 is considered live only after retaining all of the following:

- deployed Preview/Preprod contract address;
- deployment transaction identifier;
- one credential issuance transaction identifier;
- one internal or white-hat submission transaction identifier;
- a relay-side verification result showing that the returned ticket exists in `acceptedTickets`;
- a negative test showing that a reused nullifier is rejected.

Local generated-circuit tests prove implementation consistency, but they are not presented as network evidence.

## Privacy boundary

Only commitments, nullifiers, tickets, registry membership, and counters are ledger state. Lace, the browser host, an OTP provider, an email relay, or the recipient mail server may still observe metadata. Mailbox control is not proof of current employment, and a `security.txt` policy is not legal immunity.
