import type { ModerationDecision } from './types.js';
import type { ModerationPort } from './ports.js';

const activeThreat = [
  /i\s+will\s+(kill|murder|bomb|explode)/i,
  /죽여버리겠|살해하겠|폭발시키겠|폭탄을\s*(설치|터뜨리)/i,
  /실제로\s*(죽인다|해친다|폭파한다)/i,
];

const reportedAbuse = [
  /협박받/i,
  /폭언을\s*(당|들)/i,
  /[가-힣]+(?:이|가)\s+.+(?:겠다고|한다고)\s*(?:협박|폭언)/i,
  /threatened\s+by/i,
  /harassment/i,
];

// Only reject unmistakable abuse in the offline fallback. A report may quote
// abusive language as evidence, so broad keyword filtering would be unsafe.
const obviousAbuseOnly = [
  /(?:^|\s)(?:꺼져|닥쳐|병신|씨발|좆까|개새끼)(?:이다|이야|같다)?(?:\s|[!.?]|$)/i,
  /\b(?:fuck you|you(?:'re| are) (?:trash|an? idiot)|shut up)\b/i,
];

const obviousSpam = [
  /(?:수익|당첨|대출).{0,20}(?:보장|문의|클릭).{0,40}(?:https?:\/\/|카톡|텔레그램)/i,
  /(?:buy now|guaranteed returns?|promo code).{0,60}https?:\/\//i,
];

export function moderateReport(text: string): ModerationDecision {
  if (reportedAbuse.some((pattern) => pattern.test(text))) {
    return {
      decision: 'PASS',
      category: 'report',
      reason: 'The text describes harm received by the reporter.',
    };
  }
  if (activeThreat.some((pattern) => pattern.test(text))) {
    return {
      decision: 'REJECT',
      category: 'active-threat',
      reason: 'The text contains an active threat of physical harm.',
    };
  }
  if (text.length <= 500 && obviousAbuseOnly.some((pattern) => pattern.test(text.trim()))) {
    return {
      decision: 'REJECT',
      category: 'abuse',
      reason: 'The submission contains only direct abusive language, not a report.',
    };
  }
  if (obviousSpam.some((pattern) => pattern.test(text))) {
    return {
      decision: 'REJECT',
      category: 'spam',
      reason: 'The submission contains high-confidence promotional spam.',
    };
  }
  return { decision: 'PASS', category: 'report', reason: 'No active physical threat pattern was detected.' };
}

export class LocalModerationAdapter implements ModerationPort {
  async classify(text: string): Promise<ModerationDecision> {
    return moderateReport(text);
  }
}
