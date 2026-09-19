import { Check, ChevronDown, Globe2, ShieldCheck, X } from 'lucide-react';
import { pick, type Language } from '../i18n';
import type { LiveConnectionState } from '../lib/midnight';
import { BrandMark, WalletMark } from './report-ui';

type LanguagePickerProps = {
  language: Language;
  open: boolean;
  onToggle: () => void;
  onChange: (language: Language) => void;
};

export function LanguagePicker({ language, open, onToggle, onChange }: LanguagePickerProps) {
  return (
    <div className="language-picker">
      <button
        className="language-trigger"
        type="button"
        aria-label={pick(language, '언어 선택', 'Select language')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Globe2 size={17} />
        <span>{language === 'ko' ? 'KR' : 'EN'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="language-menu" role="menu">
          <LanguageOption current={language} value="ko" label="한국어" onChange={onChange} />
          <LanguageOption current={language} value="en" label="English" onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function LanguageOption({
  current,
  value,
  label,
  onChange,
}: {
  current: Language;
  value: Language;
  label: string;
  onChange: (language: Language) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={current === value ? 'selected' : ''}
      onClick={() => onChange(value)}
    >
      <span>{label}</span>
      {current === value && <Check size={14} />}
    </button>
  );
}

type AppHeaderProps = LanguagePickerProps & {
  showReport: boolean;
  onHome: () => void;
  onReport: () => void;
};

export function AppHeader({
  language,
  open,
  showReport,
  onToggle,
  onChange,
  onHome,
  onReport,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <a
        className="brand"
        href="#main-content"
        aria-label={pick(language, 'GhostWhistle 홈', 'GhostWhistle home')}
        onClick={(event) => {
          event.preventDefault();
          onHome();
        }}
      >
        <BrandMark />
        <span>GhostWhistle</span>
      </a>
      <nav>
        <LanguagePicker language={language} open={open} onToggle={onToggle} onChange={onChange} />
        {showReport ? (
          <button className="nav-home-button" type="button" onClick={onHome}>
            {pick(language, '홈으로 돌아가기', 'Back to home')}
          </button>
        ) : (
          <button className="nav-report-button" type="button" onClick={onReport}>
            {pick(language, '제보 시작', 'Start report')}
          </button>
        )}
      </nav>
    </header>
  );
}

type WalletGateProps = {
  language: Language;
  state: LiveConnectionState;
  status: string;
  onClose: () => void;
  onConnect: () => void;
};

export function WalletGate({ language, state, status, onClose, onConnect }: WalletGateProps) {
  const connecting = state === 'connecting';

  return (
    <div className="wallet-gate-backdrop">
      <section
        className={`wallet-gate-dialog ${state}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-gate-title"
        aria-describedby="wallet-gate-description"
      >
        <button
          className="wallet-gate-close"
          type="button"
          aria-label={pick(language, '닫기', 'Close')}
          title={pick(language, '닫기', 'Close')}
          disabled={connecting}
          onClick={onClose}
        >
          <X size={17} />
        </button>
        <div className="wallet-gate-icon">
          <WalletMark state={state} />
        </div>
        <span className="wallet-gate-kicker">{pick(language, '보호된 연결', 'Protected connection')}</span>
        <h2 id="wallet-gate-title">
          {pick(
            language,
            '안전한 제보를 위해 지갑을 연결해 주세요',
            'Connect your wallet to report securely',
          )}
        </h2>
        <p id="wallet-gate-description">
          {pick(
            language,
            'Midnight가 제출 자격을 보호된 방식으로 확인하고 제보 수수료를 대신 처리하려면 Lace 연결이 필요합니다.',
            'Lace is required so Midnight can verify eligibility privately and cover the submission fee.',
          )}
        </p>
        <div className="wallet-gate-privacy">
          <ShieldCheck size={16} />
          <span>
            {pick(
              language,
              '지갑 주소와 제보 내용은 공식 접수처에 함께 전달되지 않습니다.',
              'Your wallet address is not delivered to the official destination with your report.',
            )}
          </span>
        </div>
        {status && state !== 'idle' && (
          <p className="wallet-gate-status" aria-live="polite">
            {status}
          </p>
        )}
        <button className="wallet-gate-connect" type="button" disabled={connecting} onClick={onConnect}>
          <WalletMark state={state} />
          {connecting
            ? pick(language, 'Lace 연결 중…', 'Connecting to Lace…')
            : state === 'error'
              ? pick(language, 'Lace 다시 연결', 'Reconnect Lace')
              : pick(language, 'Lace 지갑 연결', 'Connect Lace wallet')}
        </button>
      </section>
    </div>
  );
}
