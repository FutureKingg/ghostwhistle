import { describe, expect, it } from 'vitest';
import { moderateReport } from './moderation';

describe('local moderation fallback', () => {
  it.each([
    '팀장이 죽여버리겠다고 협박했습니다.',
    'I was threatened by my manager after reporting the issue.',
    'The API returns another tenant’s invoice.',
  ])('allows reports and descriptions of received harm', (text) => {
    expect(moderateReport(text).decision).toBe('PASS');
  });

  it.each(['내가 실제로 죽인다.', 'I will bomb the office tomorrow.', '폭탄을 설치하겠다.'])(
    'blocks active threats',
    (text) => {
      expect(moderateReport(text).decision).toBe('REJECT');
    },
  );

  it.each([
    ['제목\n요약\n너는 병신이다.', 'abuse'],
    ['광고\n고수익\n수익 보장, 지금 클릭 https://spam.example', 'spam'],
  ])('blocks high-confidence abuse and spam', (text, category) => {
    expect(moderateReport(text)).toMatchObject({ decision: 'REJECT', category });
  });
});
