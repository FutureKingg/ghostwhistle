import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  EyeOff,
  FileCheck2,
  Fingerprint,
  Inbox,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  Network,
  Paperclip,
  Radar,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  commitment as createLocalCommitment,
  canonicalReport,
  evidenceLimits,
  finalizeInternalQualification,
  moderateReport as moderateReportLocally,
  shortHash,
  solvePow,
  type InternalEnrollment,
  type PublicOtpChallenge,
  type Qualification,
  type RelayAttachment,
} from '@ghostwhistle/core';
import {
  connectLiveContract,
  createLiveInternalEnrollment,
  isWalletConnectionExpired,
  ModerationRejectedError,
  network,
  retryLiveReportDelivery,
  type LiveConnectionState,
  type LiveReportReceipt,
  submitLiveReport,
} from './lib/midnight';
import { qualifyWhitehat, requestInternalOtp, verifyInternalOtp } from './lib/issuer-api';
import {
  evidenceAccept,
  formatEvidenceSize,
  prepareEvidenceFile,
  validateEvidenceSelection,
} from './lib/evidence';
import { clearPublicReceipt, loadPublicReceipt, savePublicReceipt } from './lib/receipt-storage';
import type { AppStep, DisclosureMode, ProofReceipt, ReportDraft } from './types';

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const whitehatExampleDomain = 'tailscale.com';

const emptyReceipt: ProofReceipt | null = null;
const restoredReceipt = loadPublicReceipt();

type ModerationToast = {
  title: string;
  message: string;
};

const moderationCategoryLabel: Record<string, string> = {
  abuse: '악성 비방·욕설',
  spam: '스팸·도배',
  'active-threat': '테러·협박성 메시지',
  unclear: '악성 메시지',
  report: '정책 위반 메시지',
};

const defaultDraft: ReportDraft = {
  department: '재무운영팀',
  title: '2026년 2분기 외부 계좌 분할 이체 정황',
  summary: '승인되지 않은 외부 계좌로 반복적인 분할 이체가 발생한 정황을 제보합니다.',
  details:
    '지난 6월부터 동일 거래처 코드 아래 서로 다른 수취 계좌가 등록되었습니다. 내부 승인 문서의 계좌와 실제 송금 계좌가 일치하지 않으며, 첨부 증빙의 전표 번호를 기준으로 독립 감사를 요청합니다.',
};

const proofPhases = [
  '브라우저에서 리포트 커밋 생성',
  '자격 증명 membership 검증',
  '도메인 락 constraint 확인',
  'Midnight ticket 트랜잭션 구성',
];

const stepOrder: AppStep[] = ['qualify', 'compose', 'prove', 'receipt'];

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-arc brand-arc-one" />
      <span className="brand-arc brand-arc-two" />
      <span className="brand-dot" />
    </div>
  );
}

function WalletMark({ state }: { state: LiveConnectionState }) {
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button className="icon-button" onClick={copy} aria-label="값 복사" title="복사">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function StepRail({ step }: { step: AppStep }) {
  const activeIndex = stepOrder.indexOf(step);
  const labels = ['정보 확인', '내용 작성', '안전하게 전송', '접수 완료'];

  return (
    <ol className="step-rail" aria-label="제보 진행 단계">
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

function PrivacyBoundary({ mode }: { mode: DisclosureMode }) {
  return (
    <div className="boundary-card">
      <div className="boundary-heading">
        <EyeOff size={17} />
        <div>
          <strong>개인정보 보호 안내</strong>
          <span>제보자 정보는 공개되지 않습니다</span>
        </div>
      </div>
      <div className="boundary-grid">
        <div>
          <span className="boundary-label private">보호되는 정보</span>
          <p>{mode === 'internal' ? '이메일 주소' : '제보자 신원'}</p>
          <p>제보 내용 · 첨부 파일</p>
        </div>
        <div>
          <span className="boundary-label public">확인되는 정보</span>
          <p>공식 접수처</p>
          <p>전달 확인 정보</p>
        </div>
      </div>
    </div>
  );
}

function AuditInbox({
  receipt,
  draft,
  destination,
  live,
  demoMode,
}: {
  receipt: ProofReceipt | null;
  draft: ReportDraft;
  destination: string;
  live: boolean;
  demoMode: boolean;
}) {
  return (
    <aside className="inbox-panel">
      <div className="inbox-chrome">
        <div className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span>
          <Inbox size={14} /> {demoMode ? '수신 화면 예시' : '공식 접수처'}
        </span>
        <span className="inbox-address">{destination || 'audit@company.com'}</span>
      </div>

      {!receipt ? (
        <div className="inbox-empty">
          <div className="radar-wrap">
            <Radar size={34} />
            <span />
          </div>
          <p>{demoMode ? '제출 후 수신 예시를 확인할 수 있습니다' : '제보가 도착하면 여기에 표시됩니다'}</p>
          <span>
            {demoMode
              ? '데모에서는 실제 이메일이나 온체인 거래가 발생하지 않습니다.'
              : '제출이 완료되면 공식 접수처로 안전하게 전달됩니다.'}
          </span>
        </div>
      ) : live ? (
        <div className="inbox-empty live-inbox-result">
          <div className="success-mark small-success">
            <Check size={22} />
          </div>
          <p>
            {receipt.delivery === 'email'
              ? '제보 전달이 완료됐습니다'
              : receipt.delivery === 'verified-local'
                ? '제보 확인과 전달이 완료됐습니다'
                : '제보 확인이 완료됐습니다'}
          </p>
          <span>
            {receipt.delivery === 'email'
              ? `${destination} 공식 접수처로 제보를 전달했습니다.`
              : receipt.delivery === 'verified-local'
                ? '공식 접수처와 내용을 확인했습니다.'
                : `전달은 실패했지만 접수 확인 정보는 안전합니다. ${receipt.deliveryError ?? ''}`}
          </span>
          <code>{shortHash(receipt.ticket, 14, 10)}</code>
        </div>
      ) : (
        <div className="mail-preview">
          <div className="mail-header">
            <span className="verified-pill">
              <BadgeCheck size={14} /> 검증 완료
            </span>
            <span className="mail-time">방금 전</span>
            <h2>{draft.title}</h2>
            <p>GhostWhistle 안전 전달</p>
          </div>
          <div className="mail-proof-note">
            <ShieldCheck size={18} />
            <div>
              <strong>제보 내용은 확인됐고, 신원은 전달되지 않았습니다.</strong>
              <span>접수 확인 코드 {shortHash(receipt.ticket)} · 공식 접수처 확인 완료</span>
            </div>
          </div>
          <div className="mail-body">
            <label>발생 부서</label>
            <p>{draft.department || '미기재'}</p>
            <label>제보 요약</label>
            <p>{draft.summary}</p>
            <label>상세 내용</label>
            <p>{draft.details}</p>
          </div>
          <div className="mail-footer">
            <Link2 size={14} /> 전달된 내용이 바뀌지 않았는지 확인할 수 있습니다.
          </div>
        </div>
      )}
    </aside>
  );
}

export default function App() {
  const [showReport, setShowReport] = useState(Boolean(restoredReceipt));
  const [mode, setMode] = useState<DisclosureMode>('internal');
  const [step, setStep] = useState<AppStep>(restoredReceipt ? 'receipt' : 'qualify');
  const [identityInput, setIdentityInput] = useState('hana@acme.co.kr');
  const [destination, setDestination] = useState('');
  const [draft, setDraft] = useState<ReportDraft>(defaultDraft);
  const [receipt, setReceipt] = useState<ProofReceipt | null>(restoredReceipt ?? emptyReceipt);
  const [proofPhase, setProofPhase] = useState(-1);
  const [error, setError] = useState('');
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>('idle');
  const [liveStatus, setLiveStatus] = useState('');
  const [internalEnrollment, setInternalEnrollment] = useState<InternalEnrollment | null>(null);
  const [otpChallenge, setOtpChallenge] = useState<PublicOtpChallenge | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [liveQualification, setLiveQualification] = useState<Qualification | null>(null);
  const [qualifying, setQualifying] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<RelayAttachment[]>([]);
  const [preparingEvidence, setPreparingEvidence] = useState(false);
  const [liveDeliveryReceipt, setLiveDeliveryReceipt] = useState<LiveReportReceipt | null>(null);
  const [retryingDelivery, setRetryingDelivery] = useState(false);
  const [moderationToast, setModerationToast] = useState<ModerationToast | null>(null);

  useEffect(() => {
    if (!moderationToast) return;
    const timeout = window.setTimeout(() => setModerationToast(null), 8_000);
    return () => window.clearTimeout(timeout);
  }, [moderationToast]);

  const domain = useMemo(() => {
    if (mode === 'internal') return identityInput.trim().split('@')[1]?.toLowerCase() ?? '';
    return identityInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0];
  }, [identityInput, mode]);

  function changeMode(nextMode: DisclosureMode) {
    clearPublicReceipt();
    setMode(nextMode);
    setStep('qualify');
    setReceipt(null);
    setError('');
    setDestination('');
    setInternalEnrollment(null);
    setOtpChallenge(null);
    setOtpCode('');
    setLiveQualification(null);
    setEvidenceFiles([]);
    setLiveDeliveryReceipt(null);
    setIdentityInput(nextMode === 'internal' ? 'hana@acme.co.kr' : whitehatExampleDomain);
    setDraft(
      nextMode === 'internal'
        ? defaultDraft
        : {
            department: 'Web application / API',
            title: 'Broken access control in invoice export endpoint',
            summary:
              'A low-privilege account can enumerate invoice exports belonging to other organizations.',
            details:
              'The numeric export identifier is accepted without an organization ownership check. I reproduced the issue only against my own test tenants. Suggested fix: authorize export ownership before object retrieval.',
          },
    );
  }

  function openReport() {
    setShowReport(true);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  function openHome() {
    setShowReport(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  async function qualify() {
    setError('');
    if (mode === 'internal' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identityInput)) {
      setError('업무 이메일 형식을 확인해 주세요.');
      return;
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      setError('유효한 조직 도메인을 입력해 주세요.');
      return;
    }

    if (!network.demoMode) {
      setQualifying(true);
      try {
        if (liveConnection !== 'connected' && !(await connectDeployment())) return;
        if (mode === 'internal') {
          const enrollment = await createLiveInternalEnrollment(identityInput);
          const challenge = await requestInternalOtp(enrollment);
          if (challenge.developmentCode) {
            const issuance = await verifyInternalOtp(challenge.id, challenge.developmentCode);
            const qualification = finalizeInternalQualification(enrollment, issuance);
            setLiveQualification(qualification);
            setDestination(qualification.destinationEmail);
            setInternalEnrollment(null);
            setOtpChallenge(null);
            setOtpCode('');
            setStep('compose');
          } else {
            setInternalEnrollment(enrollment);
            setOtpChallenge(challenge);
            setOtpCode('');
          }
        } else {
          const qualification = await qualifyWhitehat(domain);
          setLiveQualification(qualification);
          setDestination(qualification.destinationEmail);
          setStep('compose');
        }
      } catch (qualificationError) {
        const message = qualificationError instanceof Error ? qualificationError.message : '';
        setError(
          mode === 'whitehat' && /^Unable to fetch security\.txt \(\d{3}\)\.$/.test(message)
            ? `해당 도메인에서 유효한 security.txt를 직접 가져오지 못했습니다 (${message.match(/\d{3}/)?.[0]}). 리디렉션 없이 공개된 도메인을 입력해 주세요.`
            : message ||
                (mode === 'internal' ? 'OTP 자격 요청에 실패했습니다.' : 'security.txt 확인에 실패했습니다.'),
        );
      } finally {
        setQualifying(false);
      }
      return;
    }

    await sleep(320);
    setDestination(mode === 'internal' ? `audit@${domain}` : `security@${domain}`);
    setStep('compose');
  }

  async function verifyOtpAndIssueCredential() {
    if (!internalEnrollment || !otpChallenge) return;
    if (!/^\d{6}$/.test(otpCode)) {
      setError('6자리 OTP 코드를 입력해 주세요.');
      return;
    }
    setError('');
    setQualifying(true);
    try {
      const issuance = await verifyInternalOtp(otpChallenge.id, otpCode);
      const qualification = finalizeInternalQualification(internalEnrollment, issuance);
      setLiveQualification(qualification);
      setDestination(qualification.destinationEmail);
      setOtpChallenge(null);
      setOtpCode('');
      setStep('compose');
    } catch (qualificationError) {
      setError(
        qualificationError instanceof Error
          ? qualificationError.message
          : 'OTP 확인 또는 온체인 credential 발급에 실패했습니다.',
      );
    } finally {
      setQualifying(false);
    }
  }

  function updateDraft(field: keyof ReportDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function completeReceipt(nextReceipt: ProofReceipt) {
    setReceipt(nextReceipt);
    savePublicReceipt(nextReceipt);
  }

  async function handleEvidenceFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selected.length) return;
    setError('');
    setPreparingEvidence(true);
    try {
      if (evidenceFiles.length + selected.length > evidenceLimits.maxFiles) {
        throw new Error(`파일은 최대 ${evidenceLimits.maxFiles}개까지 첨부할 수 있습니다.`);
      }
      if (
        evidenceFiles.reduce((sum, file) => sum + file.size, 0) +
          selected.reduce((sum, file) => sum + file.size, 0) >
        evidenceLimits.maxTotalBytes
      ) {
        throw new Error('첨부파일 전체 크기는 10MB 이하여야 합니다.');
      }
      const prepared = await Promise.all(selected.map(prepareEvidenceFile));
      const combined = [...evidenceFiles, ...prepared];
      validateEvidenceSelection(combined);
      setEvidenceFiles(combined);
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : '첨부파일을 읽지 못했습니다.');
    } finally {
      setPreparingEvidence(false);
    }
  }

  async function connectDeployment(): Promise<boolean> {
    setLiveConnection('connecting');
    setLiveStatus(
      'Lace 승인을 기다리는 중입니다… 첫 연결과 지갑 동기화에는 1~2분이 걸릴 수 있습니다. Authorize는 한 번만 눌러 주세요.',
    );
    try {
      const connection = await connectLiveContract();
      setLiveConnection('connected');
      setLiveStatus(
        `계약 ${shortHash(connection.address, 10, 8)} · 온체인 접수 ${connection.acceptedCount.toString()}건`,
      );
      return true;
    } catch (connectionError) {
      const message =
        connectionError instanceof Error ? connectionError.message : 'Midnight 계약 연결에 실패했습니다.';
      setLiveConnection('error');
      setLiveStatus(message);
      setError(message);
      return false;
    }
  }

  async function submitReport() {
    if (!draft.title.trim() || !draft.summary.trim() || !draft.details.trim()) {
      setError('제목, 요약, 상세 내용을 모두 입력해 주세요.');
      return;
    }
    if (!network.demoMode && !liveQualification) {
      setError('실제 자격 발급을 먼저 완료해 주세요.');
      return;
    }
    if (preparingEvidence) {
      setError('첨부파일 무결성 해시를 계산하는 중입니다. 잠시만 기다려 주세요.');
      return;
    }

    const report = {
      departmentOrAsset: draft.department,
      title: draft.title,
      summary: draft.summary,
      details: draft.details,
      attachments: evidenceFiles.map(({ name, mediaType, size, sha256 }) => ({
        name,
        mediaType,
        size,
        sha256,
      })),
    };

    setModerationToast(null);
    setError('');
    setInternalEnrollment(null);
    setOtpChallenge(null);
    setOtpCode('');
    setStep('prove');
    setProofPhase(0);

    try {
      if (network.demoMode) {
        const moderation = moderateReportLocally(`${report.title}\n${report.summary}\n${report.details}`);
        if (moderation.decision === 'REJECT') {
          throw new ModerationRejectedError(moderation.category, moderation.reason);
        }
      }
      if (!network.demoMode && liveQualification) {
        const liveReceipt = await submitLiveReport(liveQualification, report, evidenceFiles);
        setLiveDeliveryReceipt(liveReceipt);
        setProofPhase(3);
        completeReceipt({
          ticket: liveReceipt.ticket,
          reportCommitment: liveReceipt.reportCommitment,
          destinationCommitment: liveReceipt.destinationCommitment,
          powNonce: liveReceipt.powNonce,
          nullifier: liveReceipt.nullifier,
          transactionId: liveReceipt.transactionId,
          source: 'live',
          delivery: liveReceipt.delivery,
          deliveryError: liveReceipt.deliveryError,
          attachmentCount: evidenceFiles.length,
          attachmentBytes: evidenceFiles.reduce((sum, file) => sum + file.size, 0),
          createdAt: new Intl.DateTimeFormat('ko-KR', {
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(new Date()),
        });
      } else {
        const salt = crypto.randomUUID();
        const reportCommitment = await createLocalCommitment(canonicalReport(report), salt);
        await sleep(520);
        setProofPhase(1);
        const destinationCommitment = await createLocalCommitment(domain);
        await sleep(520);
        setProofPhase(2);
        const powNonce = await solvePow(reportCommitment);
        setProofPhase(3);
        const ticket = await createLocalCommitment(
          mode,
          destinationCommitment,
          reportCommitment,
          salt,
          String(powNonce),
        );
        await sleep(650);

        completeReceipt({
          ticket,
          reportCommitment,
          destinationCommitment,
          powNonce,
          source: 'demo',
          attachmentCount: evidenceFiles.length,
          attachmentBytes: evidenceFiles.reduce((sum, file) => sum + file.size, 0),
          createdAt: new Intl.DateTimeFormat('ko-KR', {
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(new Date()),
        });
      }
      setStep('receipt');
    } catch (submissionError) {
      if (submissionError instanceof ModerationRejectedError) {
        const category = moderationCategoryLabel[submissionError.category] ?? '악성 메시지';
        setStep('compose');
        setProofPhase(-1);
        setError('내용을 수정한 뒤 다시 제출해 주세요. 피해 사실을 인용했다면 상황을 명확히 적어 주세요.');
        setModerationToast({
          title: '제출되지 않았습니다',
          message: `${category}로 감지되어 제보가 차단되었습니다.`,
        });
        return;
      }
      if (isWalletConnectionExpired(submissionError)) {
        setLiveConnection('error');
        setLiveStatus('Lace 연결이 종료되었습니다. 다시 연결한 뒤 제출해 주세요.');
      }
      setStep('compose');
      setError(submissionError instanceof Error ? submissionError.message : '리포트 제출에 실패했습니다.');
    }
  }

  function startAgain() {
    clearPublicReceipt();
    setStep('qualify');
    setDestination('');
    setReceipt(null);
    setProofPhase(-1);
    setError('');
    setInternalEnrollment(null);
    setOtpChallenge(null);
    setOtpCode('');
    setLiveQualification(null);
    setEvidenceFiles([]);
    setLiveDeliveryReceipt(null);
  }

  async function retryDelivery() {
    if (!liveDeliveryReceipt) return;
    setRetryingDelivery(true);
    setError('');
    try {
      const report = {
        departmentOrAsset: draft.department,
        title: draft.title,
        summary: draft.summary,
        details: draft.details,
        attachments: evidenceFiles.map(({ name, mediaType, size, sha256 }) => ({
          name,
          mediaType,
          size,
          sha256,
        })),
      };
      const result = await retryLiveReportDelivery(liveDeliveryReceipt, report, evidenceFiles);
      setLiveDeliveryReceipt((current) => (current ? { ...current, delivery: result.delivery } : current));
      setReceipt((current) => {
        if (!current) return current;
        const next = { ...current, delivery: result.delivery, deliveryError: undefined };
        savePublicReceipt(next);
        return next;
      });
    } catch (deliveryError) {
      const message =
        deliveryError instanceof Error ? deliveryError.message : '리포트 전달 재시도에 실패했습니다.';
      setReceipt((current) => {
        if (!current) return current;
        const next = { ...current, delivery: 'failed' as const, deliveryError: message };
        savePublicReceipt(next);
        return next;
      });
    } finally {
      setRetryingDelivery(false);
    }
  }

  const activeIndex = stepOrder.indexOf(step);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      {moderationToast && (
        <div className="moderation-toast" role="alert" aria-live="assertive">
          <ShieldAlert size={22} />
          <div>
            <strong>{moderationToast.title}</strong>
            <p>{moderationToast.message}</p>
            <small>명백한 악용만 자동 차단하며, 실제 피해·위법 사실에 대한 제보는 제출할 수 있습니다.</small>
          </div>
          <button
            type="button"
            aria-label="알림 닫기"
            title="알림 닫기"
            onClick={() => setModerationToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <header className="topbar">
        <a
          className="brand"
          href="#main-content"
          aria-label="GhostWhistle 홈"
          onClick={(event) => {
            event.preventDefault();
            openHome();
          }}
        >
          <BrandMark />
          <span>GhostWhistle</span>
        </a>
        <nav>
          {!showReport && <a href="#privacy">Privacy model</a>}
          {!showReport && <a href="#midnight">Midnight</a>}
          {showReport && (
            <button className="nav-home-button" type="button" onClick={openHome}>
              홈으로 돌아가기
            </button>
          )}
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        {!showReport ? (
          <section className="hero home-hero">
            <div className="hero-copy">
              <div className="eyebrow">PRIVATE REPORTING</div>
              <h1>
                Speak up safely.
                <br />
                <em>Stay protected.</em>
              </h1>
              <p>
                신원을 드러내지 않고, 믿을 수 있는 조직과 보안팀에
                <br />
                중요한 사실을 전달하세요.
              </p>
              <button className="hero-cta" type="button" onClick={openReport}>
                제보 시작하기
              </button>
              <div className="hero-trust">
                <span>
                  <LockKeyhole size={15} /> 신원 보호
                </span>
                <span>
                  <Fingerprint size={15} /> 내용 위조 방지
                </span>
                <span>
                  <Mail size={15} /> 공식 접수처 전달
                </span>
              </div>
            </div>
            <div className="hero-art" aria-label="GhostWhistle 보호 전달 경로">
              <div className="hero-art-topline">
                <span>
                  <i /> PROTECTED ROUTE
                </span>
                <span>LOCAL / PRIVATE</span>
              </div>
              <div className="hero-art-heading">
                <div className="hero-art-seal">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <strong>진실은 전달하고</strong>
                  <span>신원은 남기지 않습니다.</span>
                </div>
              </div>
              <div className="hero-art-flow">
                <div className="hero-art-line" aria-hidden="true" />
                <div className="hero-art-node">
                  <b>01</b>
                  <strong>작성</strong>
                  <span>브라우저 안에서 준비</span>
                </div>
                <div className="hero-art-node">
                  <b>02</b>
                  <strong>보호</strong>
                  <span>신원과 내용을 분리</span>
                </div>
                <div className="hero-art-node active">
                  <b>03</b>
                  <strong>전달</strong>
                  <span>공식 접수처로 도착</span>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="hero report-hero">
            <button className="back-home" type="button" onClick={openHome}>
              <ChevronRight size={15} /> 홈으로
            </button>
            <h1>
              안전하게
              <br />
              <em>제보하세요.</em>
            </h1>
            <p>신원 정보는 제보 내용과 분리되며, 작성한 내용만 확인된 공식 접수처로 전달됩니다.</p>
          </section>
        )}

        {showReport && (
          <section className="workspace-card" aria-label="GhostWhistle 제보 작성">
            <div className="workspace-top">
              <StepRail step={step} />
              <span className={`runtime-badge ${network.demoMode ? 'demo' : 'live'}`}>
                <i /> {network.demoMode ? 'INTERACTIVE DEMO' : `${network.name.toUpperCase()} · LIVE`}
              </span>
            </div>

            <div className="workspace-grid">
              <div className="form-panel">
                <div className="mode-switch" role="tablist" aria-label="제보 유형">
                  <button
                    className={mode === 'internal' ? 'selected' : ''}
                    onClick={() => changeMode('internal')}
                    role="tab"
                  >
                    사내 공익 제보
                  </button>
                  <button
                    className={mode === 'whitehat' ? 'selected' : ''}
                    onClick={() => changeMode('whitehat')}
                    role="tab"
                  >
                    보안 취약점 제보
                  </button>
                </div>

                {step === 'qualify' && (
                  <div className="stage enter-stage">
                    {network.contractAddress && (
                      <div className={`live-connection ${liveConnection}`}>
                        <div>
                          <span>
                            <strong>
                              <WalletMark state={liveConnection} />
                              지갑 연결
                            </strong>
                            <small>
                              {liveConnection === 'connected'
                                ? '제보를 전송할 준비가 되었습니다.'
                                : liveStatus || '제보 전송 전에 한 번만 연결합니다.'}
                            </small>
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void connectDeployment()}
                          disabled={liveConnection === 'connecting' || liveConnection === 'connected'}
                        >
                          {liveConnection === 'connecting'
                            ? '연결 중…'
                            : liveConnection === 'connected'
                              ? '연결됨'
                              : liveConnection === 'error'
                                ? '다시 연결'
                                : '연결하기'}
                        </button>
                      </div>
                    )}
                    {otpChallenge && internalEnrollment ? (
                      <div className="otp-stage">
                        <span className="section-kicker">01 · 이메일 확인</span>
                        <h2>업무 이메일을 확인해 주세요</h2>
                        <p className="stage-description">
                          {internalEnrollment.email}로 보낸 6자리 코드를 입력하면 소속 확인이 완료됩니다.
                        </p>
                        <label className="field-label" htmlFor="otp-code">
                          인증 코드
                        </label>
                        <div className="input-wrap otp-input">
                          <KeyRound size={18} />
                          <input
                            id="otp-code"
                            name="otp-code"
                            aria-describedby="otp-expiry"
                            value={otpCode}
                            onChange={(event) =>
                              setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                            }
                            placeholder="000000"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                          />
                        </div>
                        <div className="microcopy" id="otp-expiry">
                          <Clock3 size={13} /> 코드는{' '}
                          {new Date(otpChallenge.expiresAt).toLocaleTimeString('ko-KR')}까지 유효합니다.
                        </div>
                        {error && (
                          <p className="form-error" role="alert">
                            {error}
                          </p>
                        )}
                        <button
                          className="primary-button"
                          onClick={verifyOtpAndIssueCredential}
                          disabled={qualifying}
                        >
                          {qualifying ? '확인 중…' : '계속하기'} <ArrowRight size={17} />
                        </button>
                        <button
                          className="secondary-button otp-reset"
                          type="button"
                          onClick={() => {
                            setOtpChallenge(null);
                            setInternalEnrollment(null);
                            setOtpCode('');
                            setError('');
                          }}
                        >
                          이메일 다시 입력
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="section-kicker">01 · 정보 확인</span>
                        <h2>{mode === 'internal' ? '소속을 확인해요' : '공식 보안팀을 찾아요'}</h2>
                        <p className="stage-description">
                          {mode === 'internal'
                            ? '업무 이메일은 소속 확인에만 사용되며, 제보 내용과 연결되지 않습니다.'
                            : '입력한 사이트가 공개한 공식 보안 접수처만 확인합니다.'}
                        </p>

                        <label className="field-label" htmlFor="identity-input">
                          {mode === 'internal' ? '업무 이메일' : '취약점을 발견한 도메인'}
                        </label>
                        <div className="input-wrap">
                          {mode === 'internal' ? <Mail size={18} /> : <Network size={18} />}
                          <input
                            id="identity-input"
                            name={mode === 'internal' ? 'work-email' : 'target-domain'}
                            type={mode === 'internal' ? 'email' : 'text'}
                            inputMode={mode === 'internal' ? 'email' : 'url'}
                            spellCheck={false}
                            aria-describedby="identity-help"
                            value={identityInput}
                            onChange={(event) => setIdentityInput(event.target.value)}
                            placeholder={mode === 'internal' ? 'name@company.com' : 'example.com'}
                            autoComplete="off"
                          />
                        </div>
                        <div className="microcopy" id="identity-help">
                          <KeyRound size={13} />{' '}
                          {mode === 'whitehat'
                            ? `예시: ${whitehatExampleDomain}`
                            : network.demoMode
                              ? '데모에서는 실제 이메일을 보내지 않습니다.'
                              : '입력한 이메일은 소속 확인 뒤 보관하지 않습니다.'}
                        </div>
                        {error && (
                          <p className="form-error" role="alert">
                            {error}
                          </p>
                        )}
                        <button className="primary-button" onClick={qualify} disabled={qualifying}>
                          {qualifying
                            ? '확인 중…'
                            : mode === 'internal'
                              ? '제보 시작하기'
                              : '공식 접수처 확인'}{' '}
                          <ArrowRight size={17} />
                        </button>
                        <PrivacyBoundary mode={mode} />
                      </>
                    )}
                  </div>
                )}

                {step === 'compose' && (
                  <div className="stage enter-stage">
                    <div className="qualification-banner">
                      <CircleCheck size={18} />
                      <div>
                        <strong>
                          {mode === 'internal' ? '소속 확인 완료' : '공식 보안 접수처 확인 완료'}
                        </strong>
                        <span>공식 접수처 · {destination}</span>
                      </div>
                    </div>
                    <span className="section-kicker">02 · 제보 내용</span>
                    <h2>무슨 일이 있었는지 알려주세요</h2>
                    <div className="form-grid">
                      <div className="full-field">
                        <label className="field-label" htmlFor="department">
                          {mode === 'internal' ? '발생 부서' : '영향받는 자산'}
                        </label>
                        <input
                          id="department"
                          name="department-or-asset"
                          autoComplete="off"
                          value={draft.department}
                          onChange={(event) => updateDraft('department', event.target.value)}
                        />
                      </div>
                      <div className="full-field">
                        <label className="field-label" htmlFor="title">
                          제목
                        </label>
                        <input
                          id="title"
                          name="report-title"
                          autoComplete="off"
                          value={draft.title}
                          onChange={(event) => updateDraft('title', event.target.value)}
                        />
                      </div>
                      <div className="full-field">
                        <label className="field-label" htmlFor="summary">
                          한 줄 요약
                        </label>
                        <input
                          id="summary"
                          name="report-summary"
                          autoComplete="off"
                          value={draft.summary}
                          onChange={(event) => updateDraft('summary', event.target.value)}
                        />
                      </div>
                      <div className="full-field">
                        <label className="field-label" htmlFor="details">
                          상세 내용
                        </label>
                        <textarea
                          id="details"
                          name="report-details"
                          autoComplete="off"
                          rows={6}
                          value={draft.details}
                          onChange={(event) => updateDraft('details', event.target.value)}
                        />
                      </div>
                      <div className="full-field evidence-field">
                        <label className="field-label" htmlFor="evidence-files">
                          증거 파일 <span>선택 사항</span>
                        </label>
                        <label
                          className={`evidence-picker ${preparingEvidence ? 'busy' : ''}`}
                          htmlFor="evidence-files"
                        >
                          <Paperclip size={18} />
                          <span>
                            <strong>
                              {preparingEvidence ? '파일 무결성 확인 중…' : '이미지 또는 문서 추가'}
                            </strong>
                            <small>JPG, PNG, WEBP, GIF, PDF, TXT, CSV, JSON · 최대 5개 / 전체 10MB</small>
                          </span>
                          <input
                            id="evidence-files"
                            type="file"
                            multiple
                            accept={evidenceAccept}
                            disabled={preparingEvidence}
                            onChange={(event) => void handleEvidenceFiles(event)}
                          />
                        </label>
                        {evidenceFiles.length > 0 && (
                          <ul className="evidence-list" aria-label="선택한 증거 파일">
                            {evidenceFiles.map((file, index) => (
                              <li key={`${file.sha256}-${index}`}>
                                <FileCheck2 size={16} />
                                <span>
                                  <strong>{file.name}</strong>
                                  <small>
                                    {formatEvidenceSize(file.size)} · SHA-256 {shortHash(file.sha256, 8, 6)}
                                  </small>
                                </span>
                                <button
                                  type="button"
                                  aria-label={`${file.name} 삭제`}
                                  title="첨부파일 삭제"
                                  onClick={() =>
                                    setEvidenceFiles((current) =>
                                      current.filter((_, itemIndex) => itemIndex !== index),
                                    )
                                  }
                                >
                                  <Trash2 size={15} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                    <div className="destination-lock">
                      <LockKeyhole size={16} />
                      <span>공식 접수처</span>
                      <strong>{destination}</strong>
                    </div>
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="primary-button" onClick={submitReport} disabled={preparingEvidence}>
                      {preparingEvidence ? '파일 확인 중…' : '안전하게 제보하기'} <Send size={17} />
                    </button>
                    <p className="wallet-note">
                      <ShieldCheck size={13} /> 제출 수수료는 서비스가 부담합니다.
                    </p>
                  </div>
                )}

                {step === 'prove' && (
                  <div className="stage proving-stage enter-stage">
                    <div className="proof-orbit">
                      <BrandMark />
                      <span />
                      <span />
                    </div>
                    <span className="section-kicker">03 · 안전한 전송</span>
                    <h2>제보를 안전하게 전달하는 중</h2>
                    <p className="stage-description">
                      {network.demoMode
                        ? '실제 데이터를 전송하지 않고 보호 절차를 브라우저에서 재현합니다.'
                        : '작성한 내용과 신원은 공개되지 않고, 공식 접수처로 전달됩니다.'}
                    </p>
                    <div className="proof-list">
                      {proofPhases.map((phase, index) => (
                        <div
                          className={index < proofPhase ? 'done' : index === proofPhase ? 'running' : ''}
                          key={phase}
                        >
                          <span>
                            {index < proofPhase ? (
                              <Check size={14} />
                            ) : index === proofPhase ? (
                              <RefreshCw size={14} />
                            ) : (
                              index + 1
                            )}
                          </span>
                          <p>{phase}</p>
                          <small>
                            {index < proofPhase ? '완료' : index === proofPhase ? '처리 중' : '대기'}
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {step === 'receipt' && receipt && (
                  <div className="stage receipt-stage enter-stage">
                    <div className="success-mark">
                      <Check size={30} />
                    </div>
                    <span className="section-kicker">
                      {receipt.source === 'live' ? '04 · 접수 완료' : '04 · 데모 완료'}
                    </span>
                    <h2>
                      {receipt.source === 'live' ? '제보가 안전하게 접수됐습니다' : '접수증이 생성됐습니다'}
                    </h2>
                    <p className="stage-description">
                      {receipt.source === 'live'
                        ? receipt.delivery === 'failed'
                          ? '온체인 접수는 완료됐지만 공식 접수처 전달은 실패했습니다. 아래에서 전달만 다시 시도할 수 있습니다.'
                          : '공식 접수처로 전달됐습니다. 아래 접수증으로 전송 사실을 확인할 수 있습니다.'
                        : '브라우저에서 보호 절차를 재현한 데모 접수증입니다. 실제 이메일이나 온체인 거래는 발생하지 않았습니다.'}
                    </p>

                    <div className="receipt-box">
                      <div>
                        <span>Ticket commitment</span>
                        <code>{shortHash(receipt.ticket, 14, 10)}</code>
                        <CopyButton value={receipt.ticket} />
                      </div>
                      <div>
                        <span>Report commitment</span>
                        <code>{shortHash(receipt.reportCommitment, 14, 10)}</code>
                        <CopyButton value={receipt.reportCommitment} />
                      </div>
                      <div>
                        <span>Destination hash</span>
                        <code>{shortHash(receipt.destinationCommitment, 14, 10)}</code>
                        <CopyButton value={receipt.destinationCommitment} />
                      </div>
                      <div>
                        <span>Client PoW nonce</span>
                        <code>{receipt.powNonce.toLocaleString()}</code>
                        <span />
                      </div>
                      {receipt.nullifier && (
                        <div>
                          <span>Nullifier</span>
                          <code>{shortHash(receipt.nullifier, 14, 10)}</code>
                          <CopyButton value={receipt.nullifier} />
                        </div>
                      )}
                      {receipt.transactionId && (
                        <div>
                          <span>Midnight transaction</span>
                          <code>{shortHash(receipt.transactionId, 14, 10)}</code>
                          <CopyButton value={receipt.transactionId} />
                        </div>
                      )}
                    </div>
                    <div className="receipt-meta">
                      <Clock3 size={14} /> {receipt.createdAt} ·{' '}
                      {receipt.source === 'live' ? network.name : 'local demo'}
                      {receipt.attachmentCount
                        ? ` · 증거 파일 ${receipt.attachmentCount}개 (${formatEvidenceSize(receipt.attachmentBytes ?? 0)})`
                        : ''}
                    </div>
                    {receipt.source === 'live' && receipt.delivery === 'failed' && liveDeliveryReceipt && (
                      <div className="delivery-recovery">
                        <p>온체인 접수증은 안전합니다. 새 트랜잭션 없이 전달만 다시 시도할 수 있습니다.</p>
                        <button
                          type="button"
                          onClick={() => void retryDelivery()}
                          disabled={retryingDelivery}
                        >
                          <RefreshCw size={15} />{' '}
                          {retryingDelivery ? '전달 재시도 중…' : '보고서 전달만 재시도'}
                        </button>
                      </div>
                    )}
                    <button className="secondary-button" onClick={startAgain}>
                      <RefreshCw size={16} /> 새 제보 시작
                    </button>
                  </div>
                )}
              </div>

              <AuditInbox
                receipt={receipt}
                draft={draft}
                destination={destination}
                live={receipt?.source === 'live'}
                demoMode={network.demoMode}
              />
            </div>
          </section>
        )}

        {!showReport && (
          <section className="explanation" id="privacy">
            <div className="section-intro">
              <span className="section-kicker">DESIGNED FOR HONEST PRIVACY</span>
              <h2>
                “아무것도 수집하지 않는다”가 아니라,
                <br />각 주체가 <em>꼭 필요한 것만</em> 보게 합니다.
              </h2>
            </div>
            <div className="principle-grid">
              <article>
                <span>01</span>
                <KeyRound size={23} />
                <h3>Issuer sees eligibility</h3>
                <p>
                  OTP 발급자는 업무 이메일을 확인하지만 리포트 본문은 보지 않습니다. 사용자가 만든 credential
                  commitment만 발급합니다.
                </p>
              </article>
              <article>
                <span>02</span>
                <ShieldCheck size={23} />
                <h3>Midnight sees proof</h3>
                <p>
                  Compact 회로는 자격 커밋의 소유와 도메인 일치만 검증합니다. 이메일 주소와 원문은 온체인에
                  올라가지 않습니다.
                </p>
              </article>
              <article>
                <span>03</span>
                <Inbox size={23} />
                <h3>Auditor sees report</h3>
                <p>
                  감사팀은 평소 메일함에서 리포트와 검증 ticket을 받습니다. 개인 이메일이나 지갑 주소는
                  전달되지 않습니다.
                </p>
              </article>
            </div>
          </section>
        )}

        {!showReport && (
          <section className="midnight-section" id="midnight">
            <div>
              <span className="section-kicker">WHY MIDNIGHT</span>
              <h2>
                신원은 숨기고,
                <br />
                필요한 사실만 증명합니다.
              </h2>
            </div>
            <div className="zk-proof-card" aria-label="Midnight 영지식 증명 구조">
              <div className="zk-proof-topline">
                <span>
                  <i /> MIDNIGHT ZERO-KNOWLEDGE PROOF
                </span>
                <span>COMPACT</span>
              </div>
              <div className="zk-proof-boundary">
                <div className="zk-proof-side private-inputs">
                  <small>PRIVATE INPUTS</small>
                  <strong>숨겨진 입력</strong>
                  <p>업무 이메일 · 자격 비밀 · 제보 원문</p>
                </div>
                <div className="zk-proof-core">
                  <span>
                    <ShieldCheck size={22} />
                  </span>
                  <small>ZK PROOF</small>
                  <strong>조건만 검증</strong>
                </div>
                <div className="zk-proof-side public-output">
                  <small>PUBLIC OUTPUT</small>
                  <strong>공개 증명</strong>
                  <p>자격 충족 · 목적지 일치 · 1회 제출</p>
                </div>
              </div>
              <div className="zk-proof-footer">
                <EyeOff size={15} /> 원문과 신원은 블록체인에 기록되지 않습니다.
              </div>
            </div>
          </section>
        )}
      </main>

      <footer>
        <div className="brand">
          <BrandMark />
          <span>GhostWhistle</span>
        </div>
        <p>Verified truth. Shielded identity.</p>
        <span>Midnight Korea Hackathon 2026</span>
      </footer>

      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      {showReport && (
        <div
          className="progress-line"
          style={{ width: `${((activeIndex + 1) / stepOrder.length) * 100}%` }}
        />
      )}
    </div>
  );
}
