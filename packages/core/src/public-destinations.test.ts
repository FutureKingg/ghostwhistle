import { describe, expect, it } from 'vitest';
import {
  createPublicDestinationQualification,
  normalizePublicDestinations,
  normalizePublicDestination,
} from './index';

const destination = {
  id: 'public-newsroom',
  category: 'broadcaster' as const,
  organization: 'Example Newsroom',
  label: 'Tips desk',
  email: 'tips@news.example',
  description: 'Verified public-interest test destination.',
};

describe('public destination directory', () => {
  it('normalizes a configured destination and creates a white-hat qualification', () => {
    const normalized = normalizePublicDestination({ ...destination, email: 'TIPS@NEWS.EXAMPLE' });
    expect(normalized.email).toBe('tips@news.example');
    expect(createPublicDestinationQualification(normalized)).toMatchObject({
      mode: 'whitehat',
      channel: 'public-directory',
      destinationId: 'public-newsroom',
      destinationCategory: 'broadcaster',
      destinationEmail: 'tips@news.example',
      domain: 'news.example',
    });
  });

  it('rejects arbitrary categories and duplicate ids', () => {
    expect(() => normalizePublicDestination({ ...destination, category: 'random' })).toThrow(
      'category is invalid',
    );
    expect(() => normalizePublicDestinations([destination, destination])).toThrow('Duplicate');
  });
});
