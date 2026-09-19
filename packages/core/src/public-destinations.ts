import { invalidInput } from './errors.js';
import { normalizeEmail } from './validation.js';

export type PublicDestinationCategory = 'broadcaster' | 'regulator' | 'journalist';

export type PublicDestination = {
  id: string;
  category: PublicDestinationCategory;
  organization: string;
  label: string;
  email: string;
  description: string;
};

const categories = new Set<PublicDestinationCategory>(['broadcaster', 'regulator', 'journalist']);

function boundedText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw invalidInput(`${name} must be a string.`);
  const text = value.normalize('NFC').trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw invalidInput(`${name} must be between 1 and ${maxLength} safe characters.`);
  }
  return text;
}

/**
 * Normalizes an operator-configured destination before it is exposed or approved.
 * Public reports never accept an arbitrary recipient supplied by the browser.
 */
export function normalizePublicDestination(input: unknown): PublicDestination {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidInput('A public destination must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  const id = boundedText(candidate.id, 'destination id', 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(id)) {
    throw invalidInput('A public destination id must use lowercase letters, numbers, and hyphens.');
  }
  const category = candidate.category;
  if (typeof category !== 'string' || !categories.has(category as PublicDestinationCategory)) {
    throw invalidInput('A public destination category is invalid.');
  }
  const { email } = normalizeEmail(boundedText(candidate.email, 'destination email', 254));
  return {
    id,
    category: category as PublicDestinationCategory,
    organization: boundedText(candidate.organization, 'destination organization', 120),
    label: boundedText(candidate.label, 'destination label', 160),
    email,
    description: boundedText(candidate.description, 'destination description', 320),
  };
}

export function normalizePublicDestinations(input: readonly unknown[]): PublicDestination[] {
  const destinations = input.map(normalizePublicDestination);
  const ids = new Set<string>();
  for (const destination of destinations) {
    if (ids.has(destination.id)) throw invalidInput(`Duplicate public destination id: ${destination.id}.`);
    ids.add(destination.id);
  }
  return destinations;
}
