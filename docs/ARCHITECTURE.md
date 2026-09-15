# Architecture

## Design goals

1. Keep identity and report contents outside public ledger state.
2. Make destination restrictions enforceable, not a UI convention.
3. Keep business rules independent from vendors and presentation code.
4. Provide a keyless, reproducible demo without representing simulation as a live proof.
5. Fail closed at every trust-boundary adapter.

## Components

### `packages/core`

Pure TypeScript domain and application code:

- `commitments.ts` — Web Crypto primitives used by the deterministic demo;
- `validation.ts` — canonical email, domain, and report validation;
- `otp.ts` — expiring and attempt-limited OTP challenges;
- `security-txt.ts` — RFC 9116 Contact parsing and same-domain selection;
- `moderation.ts` — conservative offline fallback implementing `ModerationPort`;
- `pow.ts` — client puzzle generation and verification;
- `rate-limit.ts` — storage-agnostic window semantics for local mode;
- `ports.ts` — boundaries for issuer, Midnight, moderation, and delivery;
- `use-cases.ts` — browser preparation and trusted-boundary orchestration, kept as separate entry points;
- `demo-midnight.ts` — in-memory invariant model used by tests and CLI.

The core package has no framework or vendor dependencies.

### `packages/contract`

The Compact contract is the authoritative live-network policy. Its role-specific administrator commitments prevent the credential issuer from silently acting as the `security.txt` oracle.

`MidnightPort.createCredentialCommitment` is intentional. A live implementation must call the generated Compact pure circuit so the issued credential uses the same hiding `persistentCommit` as `submitInternal`. The demo implementation uses Web Crypto only to model the rule locally.

The contract also exports pure `deriveTicket`. A live delivery verifier must recompute the ticket from the public mode tag, destination commitment, report commitment, and returned nullifier, then confirm ticket membership before sending mail.

### `packages/adapters`

Server-only vendor implementations:

- `ResendGateway` implements both OTP and report delivery;
- `GeminiModerationAdapter` requests schema-constrained JSON and validates it;
- email rendering escapes every reporter-controlled field;
- upstream errors are bounded and do not expose credentials in request bodies.

No adapter is imported by the browser application.

### `apps/demo-cli`

A complete local walkthrough of internal and white-hat flows. This is the first diagnostic path for reviewers because it does not depend on network availability, API credentials, browser extensions, or faucets.

### `apps/web`

Presentation only. It may hold ephemeral browser secrets but must call application use cases through ports. Environment variables prefixed with `VITE_` are public build-time values and must never contain credentials.

## Internal disclosure sequence

```text
Browser generates credential secret
  → Midnight adapter derives Compact-compatible credential commitment
  → browser requests OTP with mailbox + commitment (not secret)
  → trusted issuer verifies the OTP and receives no browser secret
  → issuer adds commitment to Compact credential set
  → browser salts and commits report
  → submitInternal proves membership + hidden-domain equality
  → contract consumes nullifier and stores ticket
  → relay verifies ticket and delivers plaintext to locked audit mailbox
```

`createInternalEnrollment` and `finalizeInternalQualification` are client operations. `issueCredentialAfterOtp` is an issuer operation. The latter accepts only a challenge ID and code, so the credential secret cannot accidentally cross into the OTP/API boundary.

Report submission is split similarly: `prepareSubmission` performs client-side salting and Hashcash work; `submitPreparedReport` independently recomputes both commitments and verifies the work before moderation, ledger submission, and relay delivery. `submitReportForDemo` is only a deterministic CLI/test convenience wrapper.

## White-hat sequence

```text
Resolver fetches /.well-known/security.txt
  → parser selects same-domain mailto Contact
  → trusted oracle independently approves the exact Contact email commitment
  → browser salts and commits report
  → submitWhitehat proves exact Contact commitment membership
  → contract consumes nullifier and stores ticket
  → relay delivers only to the parsed Contact
```

`createWhitehatQualification` performs no registry mutation. `approveWhitehatDestination` is the privileged oracle operation; only `qualifyWhitehatForDemo` combines them for the local walkthrough. This prevents a browser-facing API from accidentally inheriting the oracle capability.

## Production storage decisions

- OTP challenge storage must be shared and TTL-capable, not process memory. Its `attempt` operation must atomically increment attempts and consume a successful challenge (for example, a Redis transaction or Lua script).
- Rate limits must be enforced at the edge or in shared storage. The in-memory class is only a semantic reference and local adapter.
- Report plaintext should be streamed through moderation and delivery; it must not be written to application logs.
- Operational logs should contain ticket IDs, coarse status, and latency only.
