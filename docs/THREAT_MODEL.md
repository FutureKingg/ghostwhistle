# Threat model

## Protected data

- reporter email and direct identity;
- credential secret and report salt;
- report body and attachments before delivery;
- linkability between credential issuance and later ticket submission.

## Public by design

- issued credential commitments;
- approved destination-email commitments;
- report commitments;
- nullifiers and ticket commitments;
- transaction timing and normal blockchain metadata.

## Trust boundaries

| Party               | May observe                                          | Must not receive                      |
| ------------------- | ---------------------------------------------------- | ------------------------------------- |
| OTP issuer          | email, domain, credential commitment, issuance time  | credential secret, report             |
| Midnight ledger     | commitments, nullifier, ticket, transaction metadata | email, report plaintext, secret, salt |
| Moderation provider | report text when production AI moderation is enabled | email, credential secret              |
| Relay provider      | destination, report text, ticket, delivery metadata  | source email, credential secret       |
| Recipient           | report text, ticket, qualification class             | reporter identity and wallet details  |

The system avoids giving any one application component both the reporter's source email and report body. Infrastructure operators can still correlate traffic or logs if deployment hygiene is poor.

## Attacks addressed

- arbitrary recipient spam: destination is derived from the credential domain or verified `security.txt`;
- replay: the contract rejects an already-consumed nullifier;
- report tampering: recipient-visible text is bound to a salted commitment;
- credential guessing: commitments require a random 32-byte browser secret;
- OTP guessing: expiry, durable attempt limits, and one-time challenge deletion;
- HTML injection in received reports: all content is escaped;
- basic attachment disguise: allowlist, digest verification, and server-side file signatures;
- low-cost flooding: client proof-of-work plus a rate-limit port;
- active physical threats: replaceable context classifier before delivery.

## Not solved by this MVP

- network anonymity or resistance to global traffic analysis;
- malicious endpoint devices, browser extensions, or corporate monitoring software;
- email provider or recipient retention after delivery;
- proof that a delivered report was read, investigated, or acted upon;
- legal privilege or immunity for reporters or security researchers;
- universal proof of employment—OTP proves mailbox control at issuance time;
- reliable multi-instance/serverless rate limiting without an external shared store;
- safe attachment malware scanning and encrypted reply channels.

## Deployment requirements

1. Disable body logging and redact authorization headers.
2. Put OTP and rate-limit state in a shared TTL store.
3. Resolve and reject private, loopback, link-local, and reserved IP ranges, then pin the validated address into the HTTPS connection to prevent DNS rebinding.
4. Revalidate destination locks in the relay, never only in the browser.
5. Use separate credential-issuer and destination-oracle secrets.
6. Pin the Compact compiler, Midnight JS, proof-server, and ledger versions.
7. Label simulated and live proof paths visibly and separately.
