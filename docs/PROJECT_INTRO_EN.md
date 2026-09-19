# GhostWhistle — Project Introduction

## People who report the truth should not be punished for it

The people who notice problems inside an organization are often the people who work there. Misused departmental budgets, approval violations, workplace harassment, and similar issues are difficult for an audit team to discover unless someone close to the situation can speak up.

Yet reporting can put that person in a difficult position. A work-email report may reveal who submitted it. A completely anonymous message may be dismissed because the recipient cannot tell whether it came from a real employee or from an outsider. Even when the report is accurate, a manager or colleague may infer the reporter's identity and retaliate through a transfer, a poor performance review, or isolation.

GhostWhistle is designed to address that trust problem without turning the reporter's identity into the evidence.

## Prove eligibility without delivering identity

An internal reporter verifies organizational affiliation once through a work-email OTP. This raises the credibility of an internal report and makes it harder to abuse the official audit channel.

The work email and name are not attached to the report. The browser creates a separate credential secret, and the Midnight credential stores only a commitment derived from that secret. When the report is submitted, the system proves the required condition — that the reporter holds an eligible credential for the organization — without sending the work email again.

The audit team receives the report, its evidence, and the fact that the required eligibility check passed. The reporter's name, work email, and wallet details are not delivered to the audit recipient.

Company verification is not an identity disclosure step. It increases confidence in the report while reducing the risk of retaliation inside the reporter's department.

## Internal audit and external public-interest reporting serve different purposes

GhostWhistle is not intended to expose every report to the public.

Issues that an organization can investigate and correct itself — such as departmental misuse of funds, approval violations, or workplace harassment — use the internal audit route. The report is routed to the organization's official audit or compliance destination while the recipient does not receive the reporter's identity.

Some situations may require an independent recipient because the organization is suspected of covering up the issue or its internal process is not sufficient. In those cases, GhostWhistle supports verified destinations such as regulators, investigative newsrooms, broadcasters, journalists, and other public-interest channels.

The reporter does not type an arbitrary email address. They choose a destination from an operator-curated directory, or use the official security contact published in the target domain's RFC 9116 `security.txt`. The server and the Midnight destination commitment both re-check the exact approved destination before delivery.

## Security researchers need a safe reporting path too

Security researchers do not need to prove company affiliation. What matters is that the report reaches the correct security contact and follows responsible-disclosure boundaries.

GhostWhistle's security-reporting route checks the target domain's official `security.txt` contact. It lets a researcher begin without an employment check, while preventing the browser from selecting an arbitrary recipient. The report is routed only to a verified security destination, reducing misdelivery and abuse.

## Midnight verifies only what needs to be verified

Ordinary blockchain applications often make data public for transparency. A whistleblowing system must do the opposite: the reporter's identity and the report itself should not become public ledger data.

GhostWhistle uses a Midnight Compact contract to verify the conditions required for a trustworthy submission while keeping the underlying values private:

- an internal reporter holds an eligible organization credential;
- the report is bound to an approved destination;
- the same credential or submission cannot be replayed;
- an accepted submission receives a tamper-evident receipt.

Email addresses, report text, attachments, credential secrets, and report salts are not ledger fields. The ledger stores commitments, a one-time nullifier, and the information required to verify the accepted ticket.

## Main capabilities

### Internal public-interest reporting

- Verify organization affiliation through a work-email OTP.
- Generate the credential secret in the browser so the issuer does not receive it.
- Deliver the report to the audit destination without attaching the reporter's name or work email.
- Preserve the credibility of an eligibility check without exposing the reporter to the recipient.

### Security vulnerability reporting

- Start without proving company affiliation.
- Resolve the target domain's official `security.txt` contact.
- Deliver only to the approved security destination.

### Public-interest destination selection

- Choose an operator-verified broadcaster, regulator, journalist, or public-interest media destination.
- Prevent the browser from changing the recipient email arbitrarily.
- Revalidate the exact destination on the server and through the Midnight destination commitment.

### Zero-knowledge eligibility checks

- Use Compact circuits to verify credential, destination, and replay-prevention rules.
- Use a one-time nullifier for each submission.
- Prove eligibility without publishing the reporter's identity.

### Evidence attachments

- Submit approved image and document evidence with the report.
- Validate file size and type and calculate an integrity digest.
- Keep attachments off-chain and deliver them through the verified reporting route.

### Abuse prevention

GhostWhistle blocks clear misuse before creating a proof or delivering a report, including direct abusive messages, promotional spam, and high-confidence active threats.

The filter is deliberately conservative. A report describing a threat received by the reporter, wrongdoing, a vulnerability, or harsh language quoted as evidence should pass when the context is clear. Ambiguous text is not treated as a reason to suppress a legitimate report.

Moderation is exposed through a replaceable provider boundary so additional AI services can be added later. The external provider currently implemented and tested is Google Gemini, and Gemini is used only as an abuse gate — not as a truth judge or human reviewer. If no Gemini API key is configured, or if Gemini is unavailable, external AI moderation is disabled for that request and GhostWhistle uses its conservative local fallback rules instead. In either case, a rejected message is not sent to the ledger or the reporting recipient by the application, and the reporter receives the reason in the interface.

### Sponsored submission fees

- The sponsor covers the DUST fee required for submission.
- Reporters do not need to understand the fee structure or obtain DUST separately for the demo flow.
- The reporter still connects Lace once to authorize the user-side transaction signature.

### Verifiable submission receipts

- Show a transaction identifier, report commitment, nullifier, and delivery ticket after submission.
- Deliver the report with its verified ticket to the selected official destination.
- Track delivery state so browser retries or issuer restarts do not send the same accepted report twice.

## What GhostWhistle changes

GhostWhistle is not designed to attack organizations. It is designed to give organizations an earlier, safer way to discover and correct problems before they become larger failures.

Instead of requiring the recipient to know who the reporter is, GhostWhistle lets the reporter prove the narrower fact that matters: that they are eligible to use the reporting route. The organization receives facts and evidence, while the reporter is less exposed to retaliation by the people involved in the issue.

Problems that can be handled internally go to the audit team. Problems that require independent review go to a verified public-interest destination. Security vulnerabilities go to an official security contact. Each route matches the purpose of the report while keeping identity data separate from the report content.

GhostWhistle reduces the link between identity and report at the application and ledger layers. It is not a Tor replacement: a normal browser session may still expose IP address, browser fingerprint, wallet transaction metadata, or corporate-network activity to infrastructure outside the recipient mailbox. A high-risk deployment would require separately operated Tor/onion infrastructure, secure operational procedures, and a threat model comparable to dedicated whistleblower systems.

## Scope and demo status

The public reviewer demo is intentionally keyless and does not send real email or create a live on-chain transaction. The repository also includes the local issuer and Lace integration path for an operator-assisted demonstration.

This separation makes the privacy boundaries visible: the demo shows the complete user flow, while the live path demonstrates the actual wallet, issuer, proof, sponsor, and delivery boundaries when the required local services are available.
