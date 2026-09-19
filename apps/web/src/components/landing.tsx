import { BadgeCheck, EyeOff, Send, ShieldCheck } from 'lucide-react';
import { pick, type Language } from '../i18n';

type HomeHeroProps = {
  language: Language;
  onStart: () => void;
};

export function HomeHero({ language, onStart }: HomeHeroProps) {
  return (
    <section className="hero home-hero">
      <div className="hero-copy">
        <h1>
          {pick(language, '제보할 일이 있다면,', 'If something needs reporting,')}
          <br />
          <em>{pick(language, '안전하게 알려주세요.', 'speak up safely.')}</em>
        </h1>
        <p>
          {pick(
            language,
            '신원 공개 없이 제보할 수 있으며, 회사 인증 제보는 감사실에 더 신뢰 있게 전달됩니다.',
            'Report without disclosing your identity, or verify your company affiliation to give the audit team stronger context.',
          )}
        </p>
        <button className="hero-cta" type="button" onClick={onStart}>
          {pick(language, '제보 시작하기', 'Start a report')}
        </button>
        <div className="hero-trust">
          <span>
            <EyeOff size={15} /> {pick(language, '신원 비공개', 'Identity withheld')}
          </span>
          <span>
            <BadgeCheck size={15} /> {pick(language, '회사 인증 선택', 'Optional verification')}
          </span>
          <span>
            <Send size={15} /> {pick(language, '감사실 전달', 'Audit delivery')}
          </span>
        </div>
      </div>

      <ol
        className="hero-process"
        aria-label={pick(language, 'GhostWhistle 보호 전달 과정', 'How GhostWhistle works')}
      >
        <li>
          <span>01</span>
          <div>
            <strong>{pick(language, '제보 유형을 고릅니다', 'Choose a report type')}</strong>
            <p>
              {pick(
                language,
                '사내 제보는 소속을 확인하고, 보안·공익 제보는 소속 확인 없이 진행합니다.',
                'Internal reports verify affiliation. Security and public-interest reports need no affiliation check.',
              )}
            </p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>{pick(language, '사실을 작성합니다', 'Write down the facts')}</strong>
            <p>
              {pick(
                language,
                '제목, 내용, 증거 파일을 브라우저에서 준비합니다.',
                'Prepare the title, details, and evidence in your browser.',
              )}
            </p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>{pick(language, '공식 접수처로 보냅니다', 'Send it to the official destination')}</strong>
            <p>
              {pick(
                language,
                '제보 내용만 공식 접수처에 전달하고 신원 정보는 함께 보내지 않습니다.',
                'Only the report is delivered; identity details are not included.',
              )}
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}

export function MidnightExplainer({ language }: { language: Language }) {
  return (
    <section className="midnight-section" id="midnight">
      <div className="midnight-copy">
        <span>Midnight · Zero-knowledge</span>
        <h2>
          {pick(language, '신원을 공개하지 않고도', 'Prove eligibility')}
          <br />
          {pick(language, '제출 자격을 증명합니다.', 'without revealing identity.')}
        </h2>
        <p>
          {pick(
            language,
            'Compact 회로는 숨겨진 입력을 공개하지 않은 채 자격, 목적지, 중복 제출 여부를 검증합니다.',
            'The Compact circuit verifies eligibility, destination, and replay protection without exposing hidden inputs.',
          )}
        </p>
      </div>

      <div
        className="zk-proof-card"
        aria-label={pick(language, 'Midnight 영지식 증명 구조', 'Midnight zero-knowledge proof structure')}
      >
        <div className="zk-proof-boundary">
          <div className="zk-proof-side private-inputs">
            <small>PRIVATE INPUTS</small>
            <strong>{pick(language, '숨겨진 입력', 'Hidden inputs')}</strong>
            <p>
              {pick(
                language,
                '선택한 인증 정보 · 자격 비밀 · 제보 원문',
                'Selected credential · eligibility secret · report text',
              )}
            </p>
          </div>
          <div className="zk-proof-core">
            <span>
              <ShieldCheck size={22} />
            </span>
            <small>ZK PROOF</small>
            <strong>{pick(language, '조건만 검증', 'Verify conditions only')}</strong>
          </div>
          <div className="zk-proof-side public-output">
            <small>PUBLIC OUTPUT</small>
            <strong>{pick(language, '공개 증명', 'Public proof')}</strong>
            <p>
              {pick(
                language,
                '자격 충족 · 목적지 일치 · 1회 제출',
                'Eligibility · destination match · one-time submission',
              )}
            </p>
          </div>
        </div>
        <div className="zk-proof-footer">
          <EyeOff size={15} />{' '}
          {pick(
            language,
            '원문과 신원은 블록체인에 기록되지 않습니다.',
            'Report text and identity are never stored on-chain.',
          )}
        </div>
      </div>
    </section>
  );
}
