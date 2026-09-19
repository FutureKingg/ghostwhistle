# GhostWhistle

**Prove eligibility, not identity.** GhostWhistle is a privacy-preserving whistleblowing and coordinated vulnerability disclosure protocol built for Midnight.

**Reviewer demo:** [ghostwhistle.vercel.app](https://ghostwhistle.vercel.app) — keyless interactive demo; no real email or on-chain transaction is sent.

Project introduction: [English](docs/PROJECT_INTRO_EN.md) · [한국어](docs/PROJECT_INTRO_KO.md)

An eligible reporter can prove that they hold an organization credential, bind a report to an approved destination, and create a tamper-evident ticket without publishing their email address, credential secret, report body, or attachments on-chain.

> Project status: the functional core, Compact contract, deterministic demo, live Midnight.js/Lace provider boundary, end-to-end OTP issuance flow, `security.txt` parser, operator-curated public destination directory, moderation boundary, anti-replay logic, and email adapters are implemented. A real Preview/Preprod deployment is reported only after its address and transaction identifiers are captured; the UI never presents simulator output as a live proof.

## Why it exists

Anonymous messages are easy to dismiss because recipients cannot distinguish an eligible insider or responsible researcher from spam. Conventional identity verification fixes that trust problem by revealing the reporter. GhostWhistle proves a smaller claim:

- internal mode: an issued credential opens to a secret whose hidden domain equals the destination domain;
- white-hat mode: the exact destination Contact was approved from its RFC 9116 `security.txt` policy or from an operator-verified public-interest directory;
- both modes: the ticket binds a salted report commitment and a one-time nullifier.

The report is still delivered off-chain because an audit or security team needs to read it. Midnight is used for eligibility, routing constraints, anti-replay, and an immutable receipt—not as document storage.

## Functional demo

Requirements: Node.js 24.11.1 or newer and npm 11.

```bash
npm install
npm test
npm run demo
```

The CLI runs both disclosure tracks without API keys and prints the modeled public ledger state. It is deterministic in architecture, not a fake claim of a live ZK transaction.

To start the presentation UI after the functional checks:

```bash
npm run dev
```

## Repository layout

```text
ghostwhistle/
├── apps/
│   ├── demo-cli/              # End-to-end, keyless functional demonstration
│   ├── midnight-cli/          # Official Wallet SDK admin/DUST utility + local issuer API
│   ├── midnight-admin/        # Local-only Lace deployment console
│   └── web/                   # Presentation layer; depends on core, contains no server keys
├── packages/
│   ├── core/                  # Domain rules, use cases, ports, and tests
│   ├── adapters/              # Server-only Resend and Gemini implementations
│   ├── contract/              # Compact source and generated artifacts boundary
│   └── midnight/              # Live Midnight.js client and least-privilege role adapters
├── infra/midnight/            # Pinned local proof-server definition
├── docs/
│   ├── ARCHITECTURE.md        # Components, data flow, and dependency rules
│   └── THREAT_MODEL.md        # Honest privacy claims and known limitations
└── .github/workflows/ci.yaml  # Node checks plus Compact compiler verification
```

Dependency direction is one-way:

```text
web / demo-cli  →  core ports  ←  adapters
                       ↑
                 Compact adapter
```

The domain layer does not import React, Resend, Gemini, Vercel, or Midnight JS. Chain-specific hashing is delegated through `MidnightPort`, because Compact `persistentHash` must not be substituted with browser SHA-256 in a live build.

## Implemented behavior

| Capability                   | Implementation                                                                                                                    | Verification                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Work-email challenge         | Browser commitment → expiring OTP → trusted issuer                                                                                | Integration + OTP tests     |
| Credential privacy           | Client creates the secret; issuer receives only a commitment                                                                      | Core integration tests      |
| Internal destination lock    | `credentialDomainHash == destinationDomainHash` in Compact                                                                        | Compact source + CI compile |
| White-hat destination lock   | Exact same-domain `mailto:` Contact commitment from RFC 9116                                                                      | Parser/integration tests    |
| Public destination directory | Browser selects an operator-verified broadcaster, regulator, or journalist destination by id; the server approves the exact email | Core + issuer API tests     |
| Report integrity             | Salted commitment; plaintext is not ledger state                                                                                  | Core integration tests      |
| Replay defense               | One-time nullifier set in Compact and demo adapter                                                                                | Replay test                 |
| Flood cost                   | Verifiable client Hashcash puzzle                                                                                                 | Core integration tests      |
| Threat filtering             | Replaceable AI moderation port; the current production adapter is Gemini, with a conservative local fallback                      | Unit/adapter tests          |
| Enterprise delivery          | HTML-escaped Resend relay with ticket header                                                                                      | Adapter tests               |
| Evidence validation          | Size, digest, allowlist, and server-side file signatures                                                                          | API + browser tests         |

Run every TypeScript check:

```bash
npm run check
```

After compiling the Compact contract, run its generated-circuit simulator suite:

```bash
npm run contract:test
```

For a real Lace/Preview or Lace/Preprod deployment, follow [the Midnight network runbook](docs/MIDNIGHT_PREPROD.md). A contract address and transaction identifiers are mandatory evidence; passing local tests alone is not labeled as a live deployment.

## Compact contract

The contract is in [`packages/contract/src/ghostwhistle.compact`](packages/contract/src/ghostwhistle.compact). It targets Compact language `0.23` and separates the credential issuer key from the destination-oracle key.

On Linux/macOS with Compact toolchain `0.31.1`:

```bash
npm run contract:compile
```

Windows does not have a native Compact compiler release. GitHub Actions installs the official toolchain and compiles the contract on Ubuntu, so every public commit is independently checked.

## Configuration

Copy `.env.example` to `.env` for local presentation settings. Secrets must be configured only in a server environment.

```dotenv
VITE_DEMO_MODE=true
VITE_MIDNIGHT_NETWORK=preview
VITE_CONTRACT_ADDRESS=
VITE_MIDNIGHT_ZK_ASSET_BASE_URL=
VITE_ISSUER_API_URL=http://127.0.0.1:8787
# Optional; if omitted, the issuer API also receives sponsored submissions.
VITE_SPONSOR_API_URL=http://127.0.0.1:8787

# Server-only; never prefix these with VITE_
RESEND_API_KEY=
RESEND_REPORT_FROM=
RESEND_OTP_FROM=
GEMINI_API_KEY=
GEMINI_MODEL=
GHOSTWHISTLE_PUBLIC_DESTINATIONS_JSON=[]
```

The demo does not require these keys. A deployment must fail closed when a selected production adapter is not configured.

### AI moderation provider

GhostWhistle keeps moderation behind a replaceable `ModerationPort`, so another AI provider can be added later without changing the domain or ledger rules. The provider currently implemented and tested is Google Gemini. When `GEMINI_API_KEY` is configured on the server, Gemini acts only as an abuse gate for obvious insults, spam, advertising, or direct active threats; it is not a truth judge or human reviewer. If the key is absent or Gemini is unavailable, the issuer falls back to the conservative local rules instead. The public keyless demo uses the local rules and does not call an external AI service.

### Local issuer API

After deploying the local contract, keep the wallet terminal available and start the trusted issuer boundary in a second terminal:

```bash
npm run midnight:issuer:local -- --contract <local-contract-address>
```

Replace `<local-contract-address>` with the contract address printed by the local deployment command. The address is environment-specific and is intentionally not committed to the repository.

The command unlocks the existing encrypted admin vault, joins the contract with the CLI wallet, and serves OTP, `security.txt` qualification, the operator-curated public destination directory, report relay, and DUST sponsorship on `127.0.0.1:8787`. The browser submits a user-signed transaction without attaching its own DUST; the issuer process adds only sponsor-owned DUST, signs the fee section, and broadcasts it. Without Resend settings, OTP is printed in the private terminal and a report is ticket-verified locally without sending external email. With `RESEND_API_KEY`, `RESEND_OTP_FROM`, and `RESEND_REPORT_FROM`, both are delivered by email. The browser receives only the credential commitment and never receives issuer secrets. To exercise this live path in the web app, set `VITE_DEMO_MODE=false` in `apps/web/.env.local`; leave it `true` for the keyless presentation demo. The current live path still uses Lace for the reporter's transaction signature; the sponsor removes the DUST requirement, not the wallet signature requirement.

### Public-interest destination directory

Set the server-only `GHOSTWHISTLE_PUBLIC_DESTINATIONS_JSON` value to a JSON array of destinations that the operator has verified out of band. The browser receives the display metadata and an id, but never chooses an arbitrary recipient address. The issuer looks up the id, approves the exact email commitment with the destination-oracle key, and the same destination is checked again by the relay before delivery.

Example shape (use real, independently verified addresses only in a real deployment):

```json
[
  {
    "id": "example-newsroom",
    "category": "broadcaster",
    "organization": "Example Newsroom",
    "label": "Tips desk",
    "email": "tips@example.org",
    "description": "Official public-interest tip channel."
  }
]
```

Successful report delivery is claimed atomically by ticket and persisted below the ignored `apps/midnight-cli/.local/delivery-receipts/` directory. Resend also receives the ticket as an idempotency key. This prevents browser retries and issuer restarts from sending the same accepted report twice on a single-instance deployment. Use an atomic shared store for a multi-instance service.

Short-lived OTP challenges are likewise kept below the ignored `apps/midnight-cli/.local/otp-challenges/` directory. Only the OTP hash is stored, so restarting the single issuer process does not invalidate an in-progress challenge or reset its attempt counter. Request limits persist below `.local/rate-limits/`; email and IP keys are SHA-256 hashed before storage. Production multi-instance hosting must replace these single-process file stores with an encrypted shared TTL store.

Credential revocation and direct `security.txt` destination approval remain operator-only wallet operations. The browser-facing qualification routes can only approve a parsed same-domain `security.txt` contact or an entry already present in the operator-curated directory:

```bash
npm run midnight:wallet -- --network preview --contract <address> --revoke-credential <commitment>
npm run midnight:wallet -- --network preview --contract <address> --approve-security-destination security@example.com
```

For a local operator-assisted run, `--password-file <path>` accepts a JSON file containing `walletVaultPassword` and `adminSecretsVaultPassword`. The CLI deletes that plaintext file immediately after reading it. Keep it under the ignored `apps/midnight-cli/.local/` directory and never commit, upload, or reuse it.

On Windows, after both passwords are entered successfully once, the CLI stores them in `Desktop/ghostwhistle-vault-passwords.json` using CurrentUser DPAPI encryption. The file contains ciphertext rather than plaintext and can be decrypted only in the same Windows user context. Set `GHOSTWHISTLE_VAULT_PASSWORD_STORE` to choose another protected-store path.

## Midnight usage

The Compact contract maintains issued credential commitments, approved destination-email commitments, consumed nullifiers, accepted ticket commitments, and an accepted count. It never declares ledger fields for plaintext email, report plaintext, attachments, credential secrets, or salts.

`submitInternal` proves membership and hidden-domain equality in-circuit, then binds the ticket to a public destination-email commitment. `submitWhitehat` proves that exact destination commitment is in the registry. Both insert a nullifier and ticket.

## Privacy statement

GhostWhistle does **not** claim network-level anonymity by itself. It separates the report from the verified mailbox/credential and avoids analytics, third-party fonts, and raw IP persistence, but a browser host, issuer server, OTP provider, relay provider, corporate network, or recipient mail server may still observe metadata. IP, browser fingerprint, device compromise, and internal-network monitoring are outside the Midnight contract. High-risk deployments need a separately designed Tor/onion or equivalent privacy infrastructure; users should not treat a normal browser session as Tor. OTP demonstrates control of a mailbox at issuance time; it is not universal proof of employment. A ticket proves contract acceptance of commitments; it does not prove that an email was read or investigated.

See [Threat model](docs/THREAT_MODEL.md) for the complete boundary.

## Hackathon submission fit

The Midnight Korea Hackathon 2026 reviewer flow clones and compiles the public repository, checks that the submission matches this README, evaluates how clearly Midnight is used, and verifies the demo. This repository therefore keeps a zero-key CLI path, compile-checking CI, presentation UI, and explicit live/demo labeling. The deployment utility supports Midnight `preview`, `preprod`, and `undeployed` environments; use Preview for the shared public demo unless a submission specifically requires Preprod.

### Public reviewer demo

For the hackathon, publish the repository publicly and deploy the presentation UI as a separate static demo. The included `vercel.json` is configured for a Git-connected Vercel project:

1. Import the GitHub repository into Vercel.
2. Keep the project root at the repository root.
3. Use the configured build command and output directory (`apps/web/dist`).
4. Leave `VITE_DEMO_MODE` unset or set it to `true` for the public reviewer link.

The public demo does not need `GEMINI_API_KEY`, `RESEND_API_KEY`, wallet vaults, issuer secrets, or a public Midnight sponsor. Never add those values to Vercel build variables for the static demo. The live Lace/issuer path remains available for a local operator-assisted demonstration and is intentionally separate from the zero-key reviewer flow.

## License

Apache License 2.0. See [LICENSE](LICENSE).
