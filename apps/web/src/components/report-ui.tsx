import { BadgeCheck, Check, Copy, EyeOff, Inbox, Link2, Send, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { shortHash } from '@ghostwhistle/core';
import { pick, reportSteps, type Language } from '../i18n';
import type { LiveConnectionState } from '../lib/midnight';
import type { AppStep, DisclosureMode, ProofReceipt, ReportDraft } from '../types';

export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-arc brand-arc-one" />
      <span className="brand-arc brand-arc-two" />
      <span className="brand-dot" />
    </div>
  );
}

export function WalletMark({ state }: { state: LiveConnectionState }) {
  return (
    <span className={`wallet-mark ${state}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M6.5 8.25V7.5A2.5 2.5 0 0 1 9 5h7.25" />
        <path d="M6.5 8.25h10.75A2.25 2.25 0 0 1 19.5 10.5v6A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5V10.25a2 2 0 0 1 2-2Z" />
        <path d="M15.5 12.25h4v3.5h-4a1.75 1.75 0 1 1 0-3.5Z" />
        <circle cx="15.75" cy="14" r="0.75" />
      </svg>
    </span>
  );
}

export function CopyButton({ value, language }: { value: string; language: Language }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      className="icon-button"
      onClick={copy}
      aria-label={pick(language, '값 복사', 'Copy value')}
      title={pick(language, '복사', 'Copy')}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function StepRail({ step, language }: { step: AppStep; language: Language }) {
  const activeIndex = reportSteps.indexOf(step);
  const labels = pick(
    language,
    ['정보 확인', '내용 작성', '안전하게 전송', '접수 완료'],
    ['Verification', 'Write report', 'Secure delivery', 'Complete'],
  );

  return (
    <ol className="step-rail" aria-label={pick(language, '제보 진행 단계', 'Report progress')}>
      {labels.map((label, index) => {
        const state = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'future';
        return (
          <li className={`step-item ${state}`} key={label}>
            <span className="step-index">{state === 'complete' ? <Check size={13} /> : index + 1}</span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function PrivacyBoundary({ mode, language }: { mode: DisclosureMode; language: Language }) {
  return (
    <div className="boundary-card">
      <div className="boundary-heading">
        <EyeOff size={17} />
        <div>
          <strong>{pick(language, '개인정보 보호 안내', 'Privacy protection')}</strong>
          <span>
            {pick(language, '제보자 정보는 공개되지 않습니다', 'Reporter details are not disclosed')}
          </span>
        </div>
      </div>
      <div className="boundary-grid">
        <div>
          <span className="boundary-label private">{pick(language, '보호되는 정보', 'Protected')}</span>
          <p>
            {mode === 'internal'
              ? pick(language, '이메일 주소', 'Email address')
              : pick(language, '제보자 신원', 'Reporter identity')}
          </p>
          <p>{pick(language, '제보 내용 · 첨부 파일', 'Report · attachments')}</p>
        </div>
        <div>
          <span className="boundary-label public">{pick(language, '확인되는 정보', 'Verified')}</span>
          <p>{pick(language, '공식 접수처', 'Official destination')}</p>
          <p>{pick(language, '전달 확인 정보', 'Delivery receipt')}</p>
        </div>
      </div>
      <p className="boundary-limit">
        {pick(
          language,
          '이 서비스는 제보 내용과 신원을 분리하지만, 일반 브라우저의 IP·브라우저·사내 네트워크를 숨기는 Tor는 아닙니다.',
          'This separates the report from identity details, but it is not Tor and does not hide a normal browser IP, fingerprint, or corporate network.',
        )}
      </p>
    </div>
  );
}

type AuditInboxProps = {
  receipt: ProofReceipt | null;
  draft: ReportDraft;
  destination: string;
  live: boolean;
  demoMode: boolean;
  language: Language;
};

export function AuditInbox({ receipt, draft, destination, live, demoMode, language }: AuditInboxProps) {
  return (
    <aside className="inbox-panel" aria-label={pick(language, '전달 미리보기', 'Delivery preview')}>
      <div className="inbox-chrome">
        <span>
          <Inbox size={14} /> {pick(language, '전달 미리보기', 'Delivery preview')}
        </span>
        <span className="inbox-address">
          {destination || pick(language, '접수처 선택 후 표시', 'Shown after destination check')}
        </span>
      </div>

      {!receipt ? (
        <div className="inbox-empty">
          <Send size={24} aria-hidden="true" />
          <p>{pick(language, '제출 전 전달 범위를 확인하세요', 'Review what will be delivered')}</p>
          <span>
            {pick(
              language,
              '제보 내용만 전달되고, 신원 정보는 함께 보내지지 않습니다.',
              'Only the report is delivered. Your identity is not included.',
            )}
          </span>
          {demoMode && (
            <small>
              {pick(
                language,
                '데모에서는 실제 이메일이 전송되지 않습니다.',
                'No email is sent in demo mode.',
              )}
            </small>
          )}
        </div>
      ) : live ? (
        <div className="inbox-empty live-inbox-result">
          <div className="success-mark small-success">
            <Check size={22} />
          </div>
          <p>
            {receipt.delivery === 'email'
              ? pick(language, '제보 전달이 완료됐습니다', 'Report delivered')
              : receipt.delivery === 'verified-local'
                ? pick(language, '제보 확인과 전달이 완료됐습니다', 'Report verified and delivered')
                : pick(language, '제보 확인이 완료됐습니다', 'Report verified')}
          </p>
          <span>
            {receipt.delivery === 'email'
              ? pick(
                  language,
                  `${destination} 공식 접수처로 제보를 전달했습니다.`,
                  `The report was delivered to ${destination}.`,
                )
              : receipt.delivery === 'verified-local'
                ? pick(
                    language,
                    '공식 접수처와 내용을 확인했습니다.',
                    'The destination and report were verified.',
                  )
                : pick(
                    language,
                    `전달은 실패했지만 접수 확인 정보는 안전합니다. ${receipt.deliveryError ?? ''}`,
                    `Delivery failed, but the receipt remains valid. ${receipt.deliveryError ?? ''}`,
                  )}
          </span>
          <code>{shortHash(receipt.ticket, 14, 10)}</code>
        </div>
      ) : (
        <div className="mail-preview">
          <div className="mail-header">
            <span className="verified-pill">
              <BadgeCheck size={14} /> {pick(language, '검증 완료', 'Verified')}
            </span>
            <span className="mail-time">{pick(language, '방금 전', 'Just now')}</span>
            <h2>{draft.title}</h2>
            <p>{pick(language, 'GhostWhistle 안전 전달', 'GhostWhistle secure delivery')}</p>
          </div>
          <div className="mail-proof-note">
            <ShieldCheck size={18} />
            <div>
              <strong>
                {pick(
                  language,
                  '제보 내용은 확인됐고, 신원은 전달되지 않았습니다.',
                  'The report was verified without revealing the reporter.',
                )}
              </strong>
              <span>
                {pick(language, '접수 확인 코드', 'Receipt')} {shortHash(receipt.ticket)} ·{' '}
                {pick(language, '공식 접수처 확인 완료', 'destination verified')}
              </span>
            </div>
          </div>
          <div className="mail-body">
            <label>{pick(language, '발생 부서', 'Department / service')}</label>
            <p>{draft.department || pick(language, '미기재', 'Not provided')}</p>
            <label>{pick(language, '제보 요약', 'Summary')}</label>
            <p>{draft.summary}</p>
            <label>{pick(language, '상세 내용', 'Details')}</label>
            <p>{draft.details}</p>
          </div>
          <div className="mail-footer">
            <Link2 size={14} />{' '}
            {pick(
              language,
              '전달된 내용이 바뀌지 않았는지 확인할 수 있습니다.',
              'The receipt can be used to verify that the report was not altered.',
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
