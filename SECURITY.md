# Security policy

Please do not include reporter identities, report contents, API keys, wallet seeds, OTP codes, or production contract secrets in a public issue.

For a security report, contact the repository owner privately and include the affected commit and component, a minimal reproduction without real personal data, impact, suggested mitigation, and whether active exploitation is suspected.

## Supported version

Only the latest `main` revision is supported during the hackathon build period.

## Secret handling

- `.env` files are ignored;
- browser variables (`VITE_*`) are always public and cannot contain secrets;
- production credentials belong only in the deployment provider's encrypted server environment;
- CI must use repository secrets and never echo them.

The privacy boundary and non-goals are documented in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
