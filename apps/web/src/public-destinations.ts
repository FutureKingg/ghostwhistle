import type { PublicDestination } from '@ghostwhistle/core';

/**
 * Keyless presentation entries only. Live deployments replace these with the
 * issuer's server-side, operator-verified directory.
 */
export const demoPublicDestinations: PublicDestination[] = [
  {
    id: 'demo-broadcaster',
    category: 'broadcaster',
    organization: 'GhostWhistle Demo Newsroom',
    label: '제보 전용 뉴스룸',
    email: 'newsroom@demo.ghostwhistle.test',
    description: '해커톤 시연용 방송사 제보 접수처입니다.',
  },
  {
    id: 'demo-regulator',
    category: 'regulator',
    organization: 'GhostWhistle Demo Regulator',
    label: '공익·감독 제보 창구',
    email: 'reports@demo.ghostwhistle.test',
    description: '해커톤 시연용 감독기관 제보 접수처입니다.',
  },
  {
    id: 'demo-journalist',
    category: 'journalist',
    organization: 'GhostWhistle Demo Journalist',
    label: '기자 제보 메일함',
    email: 'tips@demo.ghostwhistle.test',
    description: '해커톤 시연용 기자 제보 접수처입니다.',
  },
];
