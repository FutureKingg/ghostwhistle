import type { DisclosureMode, ReportDraft } from './types';

export type Language = 'ko' | 'en';

const languageStorageKey = 'ghostwhistle-language';

export function pick<T>(language: Language, korean: T, english: T): T {
  return language === 'ko' ? korean : english;
}

export function loadLanguage(): Language {
  try {
    return window.localStorage.getItem(languageStorageKey) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
}

export function saveLanguage(language: Language): void {
  try {
    window.localStorage.setItem(languageStorageKey, language);
  } catch {
    // Persistence is optional when storage is unavailable.
  }
}

export const moderationCategoryLabels: Record<Language, Record<string, string>> = {
  ko: {
    abuse: '악성 비방·욕설',
    spam: '스팸·도배',
    'active-threat': '테러·협박성 메시지',
    unclear: '악성 메시지',
    report: '정책 위반 메시지',
  },
  en: {
    abuse: 'abusive language',
    spam: 'spam or flooding',
    'active-threat': 'threatening content',
    unclear: 'harmful content',
    report: 'policy-violating content',
  },
};

export const defaultDrafts: Record<Language, Record<DisclosureMode, ReportDraft>> = {
  ko: {
    internal: {
      department: '재무운영팀',
      title: '2026년 2분기 외부 계좌 분할 이체 정황',
      summary: '승인되지 않은 외부 계좌로 반복적인 분할 이체가 발생한 정황을 제보합니다.',
      details:
        '지난 6월부터 동일 거래처 코드 아래 서로 다른 수취 계좌가 등록되었습니다. 내부 승인 문서의 계좌와 실제 송금 계좌가 일치하지 않으며, 첨부 증빙의 전표 번호를 기준으로 독립 감사를 요청합니다.',
    },
    whitehat: {
      department: '공식 서비스 / 웹사이트',
      title: '권한 없는 정보 조회 가능성',
      summary: '일반 권한으로 다른 조직의 정보에 접근할 수 있는 정황을 제보합니다.',
      details:
        '테스트 계정에서 소유권 확인 없이 다른 조직의 자료가 조회되는 것을 확인했습니다. 실제 이용자 데이터에는 접근하지 않았으며, 객체를 반환하기 전에 조직 소유권을 검증하는 조치를 권고합니다.',
    },
  },
  en: {
    internal: {
      department: 'Finance Operations',
      title: 'Suspected split transfers to unapproved external accounts',
      summary: 'Repeated split transfers appear to have been sent to accounts that were not approved.',
      details:
        'Since June, multiple recipient accounts have appeared under the same vendor code. The accounts in the approval records do not match the accounts used for payment. I request an independent review using the attached voucher numbers.',
    },
    whitehat: {
      department: 'Web application / API',
      title: 'Possible unauthorized access to organization data',
      summary: 'A low-privilege account may be able to access information belonging to another organization.',
      details:
        'Using a test account, I observed an object being returned without an organization ownership check. I did not access real user data. I recommend verifying ownership before returning the object.',
    },
  },
};

export const proofPhases: Record<Language, string[]> = {
  ko: [
    '브라우저에서 리포트 커밋 생성',
    '자격 증명 membership 검증',
    '도메인 락 constraint 확인',
    'Midnight ticket 트랜잭션 구성',
  ],
  en: [
    'Create the report commitment in the browser',
    'Verify credential membership',
    'Check the destination constraint',
    'Build the Midnight ticket transaction',
  ],
};

export const reportSteps = ['qualify', 'compose', 'prove', 'receipt'] as const;
