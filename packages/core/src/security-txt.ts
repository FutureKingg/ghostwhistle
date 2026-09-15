import { invalidInput } from './errors.js';
import { normalizeDomain } from './validation.js';

export type SecurityContact = { email: string; source: string };
export type SecurityTxt = { url: string; contacts: SecurityContact[]; policy?: string; expires?: string };

function parseMailto(value: string): string | undefined {
  const email = value
    .trim()
    .replace(/^mailto:/i, '')
    .split('?')[0]
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,63}$/i.test(email) ? email : undefined;
}

export function parseSecurityTxt(raw: string, url: string): SecurityTxt {
  const contacts: SecurityContact[] = [];
  let policy: string | undefined;
  let expires: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const normalized = line.trim();
    if (!normalized || normalized.startsWith('#')) continue;
    const separator = normalized.indexOf(':');
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim().toLowerCase();
    const value = normalized.slice(separator + 1).trim();
    if (key === 'contact') {
      const email = parseMailto(value);
      if (email) contacts.push({ email, source: url });
    } else if (key === 'policy' && /^https:\/\//i.test(value)) policy = value;
    else if (key === 'expires') expires = value;
  }
  if (contacts.length === 0) throw invalidInput('security.txt has no valid mailto Contact.');
  return { url, contacts, policy, expires };
}

export function chooseSecurityContact(document: SecurityTxt, targetDomain: string, now = Date.now()): string {
  const domain = normalizeDomain(targetDomain);
  if (document.expires) {
    const expiresAt = Date.parse(document.expires);
    if (!Number.isFinite(expiresAt) || expiresAt <= now)
      throw invalidInput('security.txt is expired or has an invalid Expires value.');
  }
  const contact = document.contacts.find((candidate) => candidate.email.endsWith(`@${domain}`));
  if (!contact) throw invalidInput('security.txt Contact must belong to the target domain.');
  return contact.email;
}
