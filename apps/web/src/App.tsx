import {
  Check,
  CircleCheck,
  Clock3,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  Mail,
  Network,
  Paperclip,
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
  type PublicDestination,
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
import {
  listPublicDestinations,
  qualifyPublicDestination,
  qualifyWhitehat,
  requestInternalOtp,
  verifyInternalOtp,
} from './lib/issuer-api';
import {
  evidenceAccept,
  formatEvidenceSize,
  prepareEvidenceFile,
  validateEvidenceSelection,
} from './lib/evidence';
import { clearPublicReceipt, loadPublicReceipt, savePublicReceipt } from './lib/receipt-storage';
import {
  defaultDrafts,
  loadLanguage,
  moderationCategoryLabels,
  pick,
  proofPhases,
  reportSteps,
  saveLanguage,
  type Language,
} from './i18n';
import { AuditInbox, BrandMark, CopyButton, PrivacyBoundary, StepRail } from './components/report-ui';
import { AppHeader, WalletGate } from './components/app-chrome';
import { HomeHero, MidnightExplainer } from './components/landing';
import type { AppStep, DisclosureMode, ProofReceipt, ReportDraft } from './types';
import { demoPublicDestinations } from './public-destinations';

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const whitehatExampleDomain = 'tailscale.com';

const initialLanguage = loadLanguage();

const emptyReceipt: ProofReceipt | null = null;
const restoredReceipt = loadPublicReceipt();

type ModerationToast = {
  title: string;
  message: string;
};

type WhitehatChannel = 'security' | 'public';

const publicDestinationCategoryLabels: Record<Language, Record<PublicDestination['category'], string>> = {
  ko: { broadcaster: '방송사', regulator: '감독기관', journalist: '기자·공익매체' },
  en: {
    broadcaster: 'Broadcaster',
    regulator: 'Regulator',
    journalist: 'Journalist / public-interest media',
  },
};

export default function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [walletGateOpen, setWalletGateOpen] = useState(false);
  const [showReport, setShowReport] = useState(Boolean(restoredReceipt));
  const [mode, setMode] = useState<DisclosureMode>('internal');
  const [step, setStep] = useState<AppStep>(restoredReceipt ? 'receipt' : 'qualify');
  const [identityInput, setIdentityInput] = useState('hana@acme.co.kr');
  const [whitehatChannel, setWhitehatChannel] = useState<WhitehatChannel>('security');
  const [publicDestinationId, setPublicDestinationId] = useState(demoPublicDestinations[0]?.id ?? '');
  const [publicDestinations, setPublicDestinations] = useState<PublicDestination[]>(
    network.demoMode ? demoPublicDestinations : [],
  );
  const [publicDestinationsLoading, setPublicDestinationsLoading] = useState(false);
  const [destination, setDestination] = useState('');
  const [draft, setDraft] = useState<ReportDraft>(defaultDrafts[initialLanguage].internal);
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

  useEffect(() => {
    document.documentElement.lang = language;
    saveLanguage(language);
  }, [language]);

  useEffect(() => {
    if (!showReport || mode !== 'whitehat' || whitehatChannel !== 'public' || network.demoMode) return;
    let cancelled = false;
    setPublicDestinationsLoading(true);
    void listPublicDestinations()
      .then((destinations) => {
        if (cancelled) return;
        setPublicDestinations(destinations);
        setPublicDestinationId((current) =>
          destinations.some((destination) => destination.id === current)
            ? current
            : (destinations[0]?.id ?? ''),
        );
        if (destinations.length === 0) {
          setError(
            pick(
              language,
              '현재 연결된 공식 공익 접수처가 없습니다. 운영자가 검증한 접수처를 먼저 등록해야 합니다.',
              'No verified public-interest destination is configured yet. An operator must register one first.',
            ),
          );
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : pick(
                  language,
                  '공식 접수처 목록을 불러오지 못했습니다.',
                  'Could not load the public destination directory.',
                ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPublicDestinationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language, mode, showReport, whitehatChannel]);

  useEffect(() => {
    if (!languageMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanguageMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [languageMenuOpen]);

  useEffect(() => {
    if (!walletGateOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && liveConnection !== 'connecting') setWalletGateOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [liveConnection, walletGateOpen]);

  const domain = useMemo(() => {
    if (mode === 'internal') return identityInput.trim().split('@')[1]?.toLowerCase() ?? '';
    if (whitehatChannel === 'public') {
      return (
        publicDestinations
          .find((candidate) => candidate.id === publicDestinationId)
          ?.email.split('@')[1]
          ?.toLowerCase() ?? ''
      );
    }
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
    setWhitehatChannel('security');
    setPublicDestinationId(demoPublicDestinations[0]?.id ?? '');
    setPublicDestinations(network.demoMode ? demoPublicDestinations : []);
    setEvidenceFiles([]);
    setLiveDeliveryReceipt(null);
    setIdentityInput(nextMode === 'internal' ? 'hana@acme.co.kr' : whitehatExampleDomain);
    setDraft(defaultDrafts[language][nextMode]);
  }

  function changeLanguage(nextLanguage: Language) {
    if (nextLanguage === language) {
      setLanguageMenuOpen(false);
      return;
    }
    if (step === 'qualify') setDraft(defaultDrafts[nextLanguage][mode]);
    setLanguage(nextLanguage);
    setLanguageMenuOpen(false);
  }

  function openReport() {
    setWalletGateOpen(false);
    setShowReport(true);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  function requestReportAccess() {
    setError('');
    if (!network.demoMode && network.contractAddress && liveConnection !== 'connected') {
      setWalletGateOpen(true);
      return;
    }
    openReport();
  }

  async function connectFromWalletGate() {
    if (await connectDeployment()) openReport();
  }

  function openHome() {
    setWalletGateOpen(false);
    setShowReport(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  async function qualify() {
    setError('');
    if (mode === 'whitehat' && whitehatChannel === 'public') {
      const selected = publicDestinations.find((candidate) => candidate.id === publicDestinationId);
      if (!selected) {
        setError(
          pick(
            language,
            '먼저 검증된 공식 접수처를 선택해 주세요.',
            'Choose a verified public destination first.',
          ),
        );
        return;
      }
      if (!network.demoMode) {
        setQualifying(true);
        try {
          if (liveConnection !== 'connected' && !(await connectDeployment())) return;
          const qualification = await qualifyPublicDestination(selected.id);
          setLiveQualification(qualification);
          setDestination(qualification.destinationEmail);
          setStep('compose');
        } catch (qualificationError) {
          setError(
            qualificationError instanceof Error
              ? qualificationError.message
              : pick(language, '공식 접수처 확인에 실패했습니다.', 'The public destination check failed.'),
          );
        } finally {
          setQualifying(false);
        }
        return;
      }
      await sleep(320);
      setDestination(selected.email);
      setStep('compose');
      return;
    }
    if (mode === 'internal' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identityInput)) {
      setError(pick(language, '업무 이메일 형식을 확인해 주세요.', 'Check the work email format.'));
      return;
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      setError(pick(language, '유효한 조직 도메인을 입력해 주세요.', 'Enter a valid organization domain.'));
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
          mode === 'whitehat' &&
            whitehatChannel === 'security' &&
            /^Unable to fetch security\.txt \(\d{3}\)\.$/.test(message)
            ? pick(
                language,
                `해당 도메인에서 유효한 security.txt를 직접 가져오지 못했습니다 (${message.match(/\d{3}/)?.[0]}). 리디렉션 없이 공개된 도메인을 입력해 주세요.`,
                `A valid security.txt could not be fetched directly from this domain (${message.match(/\d{3}/)?.[0]}). Enter a domain that publishes it without a redirect.`,
              )
            : message ||
                (mode === 'internal'
                  ? pick(language, 'OTP 자격 요청에 실패했습니다.', 'The OTP eligibility request failed.')
                  : pick(language, 'security.txt 확인에 실패했습니다.', 'The security.txt check failed.')),
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
      setError(pick(language, '6자리 OTP 코드를 입력해 주세요.', 'Enter the six-digit OTP code.'));
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
          : pick(
              language,
              'OTP 확인 또는 온체인 credential 발급에 실패했습니다.',
              'OTP verification or on-chain credential issuance failed.',
            ),
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
        throw new Error(
          pick(
            language,
            `파일은 최대 ${evidenceLimits.maxFiles}개까지 첨부할 수 있습니다.`,
            `You can attach up to ${evidenceLimits.maxFiles} files.`,
          ),
        );
      }
      if (
        evidenceFiles.reduce((sum, file) => sum + file.size, 0) +
          selected.reduce((sum, file) => sum + file.size, 0) >
        evidenceLimits.maxTotalBytes
      ) {
        throw new Error(
          pick(
            language,
            '첨부파일 전체 크기는 10MB 이하여야 합니다.',
            'Attachments must total 10 MB or less.',
          ),
        );
      }
      const prepared = await Promise.all(selected.map(prepareEvidenceFile));
      const combined = [...evidenceFiles, ...prepared];
      validateEvidenceSelection(combined);
      setEvidenceFiles(combined);
    } catch (attachmentError) {
      setError(
        attachmentError instanceof Error
          ? attachmentError.message
          : pick(language, '첨부파일을 읽지 못했습니다.', 'The attachment could not be read.'),
      );
    } finally {
      setPreparingEvidence(false);
    }
  }

  async function connectDeployment(): Promise<boolean> {
    setError('');
    setLiveConnection('connecting');
    setLiveStatus(
      pick(
        language,
        'Lace 승인을 기다리는 중입니다… 첫 연결과 지갑 동기화에는 1~2분이 걸릴 수 있습니다. Authorize는 한 번만 눌러 주세요.',
        'Waiting for Lace approval… The first connection and wallet sync can take 1–2 minutes. Select Authorize only once.',
      ),
    );
    try {
      const connection = await connectLiveContract();
      setLiveConnection('connected');
      setLiveStatus(
        pick(
          language,
          `계약 ${shortHash(connection.address, 10, 8)} · 온체인 접수 ${connection.acceptedCount.toString()}건`,
          `Contract ${shortHash(connection.address, 10, 8)} · ${connection.acceptedCount.toString()} on-chain reports`,
        ),
      );
      return true;
    } catch (connectionError) {
      const message =
        connectionError instanceof Error
          ? connectionError.message
          : pick(
              language,
              'Midnight 계약 연결에 실패했습니다.',
              'Could not connect to the Midnight contract.',
            );
      setLiveConnection('error');
      setLiveStatus(message);
      setError(message);
      return false;
    }
  }

  async function submitReport() {
    if (!draft.title.trim() || !draft.summary.trim() || !draft.details.trim()) {
      setError(
        pick(
          language,
          '제목, 요약, 상세 내용을 모두 입력해 주세요.',
          'Enter a title, summary, and detailed description.',
        ),
      );
      return;
    }
    if (!network.demoMode && !liveQualification) {
      setError(
        pick(
          language,
          '실제 자격 발급을 먼저 완료해 주세요.',
          'Complete live eligibility verification first.',
        ),
      );
      return;
    }
    if (preparingEvidence) {
      setError(
        pick(
          language,
          '첨부파일 무결성 해시를 계산하는 중입니다. 잠시만 기다려 주세요.',
          'Attachment integrity hashes are still being calculated. Please wait.',
        ),
      );
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
          createdAt: new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(new Date()),
        });
      } else {
        const salt = crypto.randomUUID();
        const reportCommitment = await createLocalCommitment(canonicalReport(report), salt);
        await sleep(520);
        setProofPhase(1);
        const destinationCommitment = await createLocalCommitment(destination);
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
          createdAt: new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(new Date()),
        });
      }
      setStep('receipt');
    } catch (submissionError) {
      if (submissionError instanceof ModerationRejectedError) {
        const category =
          moderationCategoryLabels[language][submissionError.category] ??
          pick(language, '악성 메시지', 'harmful content');
        setStep('compose');
        setProofPhase(-1);
        setError(
          pick(
            language,
            '내용을 수정한 뒤 다시 제출해 주세요. 피해 사실을 인용했다면 상황을 명확히 적어 주세요.',
            'Revise the report and submit it again. If you quoted harmful content as evidence, explain the context clearly.',
          ),
        );
        setModerationToast({
          title: pick(language, '제출되지 않았습니다', 'Report not submitted'),
          message: pick(
            language,
            `${category}로 감지되어 제보가 차단되었습니다.`,
            `The report was blocked because it was classified as ${category}.`,
          ),
        });
        return;
      }
      if (isWalletConnectionExpired(submissionError)) {
        setLiveConnection('error');
        setLiveStatus(
          pick(
            language,
            'Lace 연결이 종료되었습니다. 다시 연결한 뒤 제출해 주세요.',
            'The Lace session ended. Reconnect before submitting.',
          ),
        );
      }
      setStep('compose');
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : pick(language, '리포트 제출에 실패했습니다.', 'The report could not be submitted.'),
      );
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
        deliveryError instanceof Error
          ? deliveryError.message
          : pick(language, '리포트 전달 재시도에 실패했습니다.', 'The delivery retry failed.');
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

  const activeIndex = reportSteps.indexOf(step);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {pick(language, '본문으로 바로가기', 'Skip to main content')}
      </a>
      {moderationToast && (
        <div className="moderation-toast" role="alert" aria-live="assertive">
          <ShieldAlert size={22} />
          <div>
            <strong>{moderationToast.title}</strong>
            <p>{moderationToast.message}</p>
            <small>
              {pick(
                language,
                '명백한 악용만 자동 차단하며, 실제 피해·위법 사실에 대한 제보는 제출할 수 있습니다.',
                'Only clear abuse is blocked. Reports of real harm or misconduct can still be submitted.',
              )}
            </small>
          </div>
          <button
            type="button"
            aria-label={pick(language, '알림 닫기', 'Dismiss notification')}
            title={pick(language, '알림 닫기', 'Dismiss notification')}
            onClick={() => setModerationToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {walletGateOpen && (
        <WalletGate
          language={language}
          state={liveConnection}
          status={liveStatus}
          onClose={() => setWalletGateOpen(false)}
          onConnect={() => void connectFromWalletGate()}
        />
      )}
      <AppHeader
        language={language}
        open={languageMenuOpen}
        showReport={showReport}
        onToggle={() => setLanguageMenuOpen((current) => !current)}
        onChange={changeLanguage}
        onHome={openHome}
        onReport={requestReportAccess}
      />

      <main id="main-content" tabIndex={-1}>
        {!showReport ? (
          <HomeHero language={language} onStart={requestReportAccess} />
        ) : (
          <section className="hero report-hero">
            <button className="back-home" type="button" onClick={openHome}>
              {pick(language, '홈으로', 'Home')}
            </button>
            <h1>{pick(language, '안전하게 제보하세요.', 'Report safely.')}</h1>
            <p>
              {pick(
                language,
                '필요한 확인은 앞에서 처리합니다. 제보 내용과 신원은 서로 연결되지 않습니다.',
                'Required checks happen first. Your report and identity are never linked.',
              )}
            </p>
          </section>
        )}

        {showReport && (
          <section
            className="workspace-card"
            aria-label={pick(language, 'GhostWhistle 제보 작성', 'GhostWhistle report form')}
          >
            <div className="workspace-top">
              <StepRail step={step} language={language} />
              <span className={`runtime-badge ${network.demoMode ? 'demo' : 'live'}`}>
                <i /> {network.demoMode ? 'INTERACTIVE DEMO' : `${network.name.toUpperCase()} · LIVE`}
              </span>
            </div>

            <div className="workspace-grid">
              <div className="form-panel">
                <div
                  className="mode-switch"
                  role="tablist"
                  aria-label={pick(language, '제보 유형', 'Report type')}
                >
                  <button
                    className={mode === 'internal' ? 'selected' : ''}
                    onClick={() => changeMode('internal')}
                    role="tab"
                  >
                    <span>{pick(language, '사내 공익 제보', 'Internal report')}</span>
                    <small>{pick(language, '소속 확인 필수', 'Affiliation required')}</small>
                  </button>
                  <button
                    className={mode === 'whitehat' ? 'selected' : ''}
                    onClick={() => changeMode('whitehat')}
                    role="tab"
                  >
                    <span>{pick(language, '보안·공익 제보', 'Security & public-interest')}</span>
                    <small>{pick(language, '소속 확인 없음', 'No affiliation check')}</small>
                  </button>
                </div>

                {step === 'qualify' && (
                  <div className="stage enter-stage">
                    {otpChallenge && internalEnrollment ? (
                      <div className="otp-stage">
                        <span className="section-kicker">
                          {pick(language, '01 · 이메일 확인', '01 · Email verification')}
                        </span>
                        <h2>{pick(language, '업무 이메일을 확인해 주세요', 'Check your work email')}</h2>
                        <p className="stage-description">
                          {pick(
                            language,
                            `${internalEnrollment.email}로 보낸 6자리 코드를 입력하면 소속 확인이 완료됩니다.`,
                            `Enter the six-digit code sent to ${internalEnrollment.email} to verify your affiliation.`,
                          )}
                        </p>
                        <label className="field-label" htmlFor="otp-code">
                          {pick(language, '인증 코드', 'Verification code')}
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
                          <Clock3 size={13} />{' '}
                          {pick(
                            language,
                            `코드는 ${new Date(otpChallenge.expiresAt).toLocaleTimeString('ko-KR')}까지 유효합니다.`,
                            `Code valid until ${new Date(otpChallenge.expiresAt).toLocaleTimeString('en-US')}.`,
                          )}
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
                          {qualifying
                            ? pick(language, '확인 중…', 'Verifying…')
                            : pick(language, '계속하기', 'Continue')}
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
                          {pick(language, '이메일 다시 입력', 'Use a different email')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="section-kicker">
                          {pick(language, '01 · 정보 확인', '01 · Initial check')}
                        </span>
                        {mode === 'whitehat' && (
                          <div
                            className="destination-channel-switch"
                            role="tablist"
                            aria-label={pick(language, '접수 경로', 'Destination channel')}
                          >
                            <button
                              type="button"
                              className={whitehatChannel === 'security' ? 'selected' : ''}
                              role="tab"
                              aria-selected={whitehatChannel === 'security'}
                              onClick={() => {
                                setWhitehatChannel('security');
                                setError('');
                              }}
                            >
                              {pick(language, '보안 취약점', 'Security issue')}
                            </button>
                            <button
                              type="button"
                              className={whitehatChannel === 'public' ? 'selected' : ''}
                              role="tab"
                              aria-selected={whitehatChannel === 'public'}
                              onClick={() => {
                                setWhitehatChannel('public');
                                setError('');
                              }}
                            >
                              {pick(language, '공익 제보처', 'Public-interest channel')}
                            </button>
                          </div>
                        )}
                        <h2>
                          {mode === 'internal'
                            ? pick(language, '소속을 확인해요', 'Verify your affiliation')
                            : whitehatChannel === 'public'
                              ? pick(language, '공식 접수처를 선택해요', 'Choose an official destination')
                              : pick(
                                  language,
                                  '소속 확인 없이 시작해요',
                                  'Start without affiliation verification',
                                )}
                        </h2>
                        <p className="stage-description">
                          {mode === 'internal'
                            ? pick(
                                language,
                                '업무 이메일은 소속 확인에만 사용됩니다. 이름과 이메일은 감사실에 전달되지 않습니다.',
                                'Your work email is used only to verify affiliation. Your name and email are not shared with the audit team.',
                              )
                            : whitehatChannel === 'public'
                              ? pick(
                                  language,
                                  '회사 이메일 없이, 운영자가 확인한 방송사·감독기관·기자 접수처 중 하나를 선택합니다.',
                                  'Choose a verified broadcaster, regulator, or journalist destination without sharing a company email.',
                                )
                              : pick(
                                  language,
                                  '회사 이메일 없이 기관이나 사이트가 공개한 공식 보안 접수처만 확인합니다.',
                                  'No company email is needed. We verify only the official security contact published by the organization or website.',
                                )}
                        </p>

                        {mode === 'whitehat' && whitehatChannel === 'public' ? (
                          <div className="public-destination-list" aria-describedby="public-destination-help">
                            {publicDestinationsLoading ? (
                              <div className="destination-directory-empty">
                                {pick(
                                  language,
                                  '공식 접수처 목록을 불러오는 중…',
                                  'Loading official destinations…',
                                )}
                              </div>
                            ) : publicDestinations.length > 0 ? (
                              publicDestinations.map((candidate) => (
                                <button
                                  type="button"
                                  className={`public-destination-card ${
                                    candidate.id === publicDestinationId ? 'selected' : ''
                                  }`}
                                  key={candidate.id}
                                  aria-pressed={candidate.id === publicDestinationId}
                                  onClick={() => {
                                    setPublicDestinationId(candidate.id);
                                    setError('');
                                  }}
                                >
                                  <span className="destination-card-category">
                                    {publicDestinationCategoryLabels[language][candidate.category]}
                                  </span>
                                  <strong>{candidate.organization}</strong>
                                  <span>{candidate.label}</span>
                                  <small>{candidate.email}</small>
                                  <p>{candidate.description}</p>
                                </button>
                              ))
                            ) : (
                              <div className="destination-directory-empty">
                                {pick(
                                  language,
                                  '현재 선택할 수 있는 공식 접수처가 없습니다.',
                                  'No official destination is available to choose yet.',
                                )}
                              </div>
                            )}
                            <div className="microcopy" id="public-destination-help">
                              <KeyRound size={13} />{' '}
                              {pick(
                                language,
                                '임의의 이메일 주소는 입력할 수 없으며, 등록된 접수처만 온체인 목적지로 승인됩니다.',
                                'Arbitrary email addresses are not accepted. Only registered destinations can be approved on-chain.',
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <label className="field-label" htmlFor="identity-input">
                              {mode === 'internal'
                                ? pick(language, '업무 이메일', 'Work email')
                                : pick(language, '기관 또는 사이트', 'Organization or website')}
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
                                ? pick(
                                    language,
                                    `예시: ${whitehatExampleDomain} · 소속 확인 없이 진행`,
                                    `Example: ${whitehatExampleDomain} · no affiliation check`,
                                  )
                                : network.demoMode
                                  ? pick(
                                      language,
                                      '데모에서는 실제 이메일을 보내지 않습니다.',
                                      'No email is sent in demo mode.',
                                    )
                                  : pick(
                                      language,
                                      '입력한 이메일은 소속 확인 뒤 보관하지 않습니다.',
                                      'Your email is not retained after verification.',
                                    )}
                            </div>
                          </>
                        )}
                        {error && (
                          <p className="form-error" role="alert">
                            {error}
                          </p>
                        )}
                        <button
                          className="primary-button"
                          onClick={qualify}
                          disabled={
                            qualifying ||
                            (mode === 'whitehat' &&
                              whitehatChannel === 'public' &&
                              (publicDestinationsLoading || !publicDestinationId))
                          }
                        >
                          {qualifying
                            ? pick(language, '확인 중…', 'Checking…')
                            : mode === 'internal'
                              ? pick(language, '제보 시작하기', 'Start report')
                              : whitehatChannel === 'public'
                                ? pick(language, '선택한 접수처 확인하기', 'Verify selected destination')
                                : pick(language, '접수처 확인하기', 'Check destination')}
                        </button>
                        <PrivacyBoundary mode={mode} language={language} />
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
                          {mode === 'internal'
                            ? pick(language, '소속 확인 완료', 'Affiliation verified')
                            : pick(language, '공식 접수처 확인 완료', 'Official destination verified')}
                        </strong>
                        <span>
                          {pick(language, '공식 접수처', 'Official destination')} · {destination}
                        </span>
                      </div>
                    </div>
                    <span className="section-kicker">
                      {pick(language, '02 · 제보 내용', '02 · Report details')}
                    </span>
                    <h2>{pick(language, '무슨 일이 있었는지 알려주세요', 'Tell us what happened')}</h2>
                    <div className="form-grid">
                      <div className="full-field">
                        <label className="field-label" htmlFor="department">
                          {mode === 'internal'
                            ? pick(language, '발생 부서', 'Department')
                            : pick(language, '관련 기관·서비스', 'Organization or service')}
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
                          {pick(language, '제목', 'Title')}
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
                          {pick(language, '한 줄 요약', 'One-line summary')}
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
                          {pick(language, '상세 내용', 'Detailed description')}
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
                          {pick(language, '증거 파일', 'Evidence files')}{' '}
                          <span>{pick(language, '선택 사항', 'Optional')}</span>
                        </label>
                        <label
                          className={`evidence-picker ${preparingEvidence ? 'busy' : ''}`}
                          htmlFor="evidence-files"
                        >
                          <Paperclip size={18} />
                          <span>
                            <strong>
                              {preparingEvidence
                                ? pick(language, '파일 무결성 확인 중…', 'Checking file integrity…')
                                : pick(language, '이미지 또는 문서 추가', 'Add an image or document')}
                            </strong>
                            <small>
                              {pick(
                                language,
                                'JPG, PNG, WEBP, GIF, PDF, TXT, CSV, JSON · 최대 5개 / 전체 10MB',
                                'JPG, PNG, WEBP, GIF, PDF, TXT, CSV, JSON · up to 5 files / 10 MB total',
                              )}
                            </small>
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
                          <ul
                            className="evidence-list"
                            aria-label={pick(language, '선택한 증거 파일', 'Selected evidence files')}
                          >
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
                                  aria-label={pick(language, `${file.name} 삭제`, `Remove ${file.name}`)}
                                  title={pick(language, '첨부파일 삭제', 'Remove attachment')}
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
                      <span>{pick(language, '공식 접수처', 'Official destination')}</span>
                      <strong>{destination}</strong>
                    </div>
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="primary-button" onClick={submitReport} disabled={preparingEvidence}>
                      {preparingEvidence
                        ? pick(language, '파일 확인 중…', 'Checking files…')
                        : pick(language, '안전하게 제보하기', 'Submit securely')}{' '}
                      <Send size={17} />
                    </button>
                    <p className="wallet-note">
                      <ShieldCheck size={13} />{' '}
                      {pick(
                        language,
                        '제출 수수료는 서비스가 부담합니다.',
                        'The service covers the submission fee.',
                      )}
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
                    <span className="section-kicker">
                      {pick(language, '03 · 안전한 전송', '03 · Secure delivery')}
                    </span>
                    <h2>
                      {pick(language, '제보를 안전하게 전달하는 중', 'Delivering your report securely')}
                    </h2>
                    <p className="stage-description">
                      {network.demoMode
                        ? pick(
                            language,
                            '실제 데이터를 전송하지 않고 보호 절차를 브라우저에서 재현합니다.',
                            'The browser reproduces the privacy flow without sending real data.',
                          )
                        : pick(
                            language,
                            '신원을 공개하지 않은 채 제보 내용을 공식 접수처로 전달합니다.',
                            'Your report is delivered to the official destination without disclosing your identity.',
                          )}
                    </p>
                    <div className="proof-list">
                      {proofPhases[language].map((phase, index) => (
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
                            {index < proofPhase
                              ? pick(language, '완료', 'Done')
                              : index === proofPhase
                                ? pick(language, '처리 중', 'Processing')
                                : pick(language, '대기', 'Waiting')}
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
                      {receipt.source === 'live'
                        ? pick(language, '04 · 접수 완료', '04 · Submission complete')
                        : pick(language, '04 · 데모 완료', '04 · Demo complete')}
                    </span>
                    <h2>
                      {receipt.source === 'live'
                        ? pick(language, '제보가 안전하게 접수됐습니다', 'Your report was submitted securely')
                        : pick(language, '접수증이 생성됐습니다', 'Your demo receipt is ready')}
                    </h2>
                    <p className="stage-description">
                      {receipt.source === 'live'
                        ? receipt.delivery === 'failed'
                          ? pick(
                              language,
                              '온체인 접수는 완료됐지만 공식 접수처 전달은 실패했습니다. 아래에서 전달만 다시 시도할 수 있습니다.',
                              'The on-chain submission succeeded, but delivery failed. You can retry delivery below without another transaction.',
                            )
                          : pick(
                              language,
                              '공식 접수처로 전달됐습니다. 아래 접수증으로 전송 사실을 확인할 수 있습니다.',
                              'Delivered to the official destination. Use the receipt below to verify submission.',
                            )
                        : pick(
                            language,
                            '브라우저에서 보호 절차를 재현한 데모 접수증입니다. 실제 이메일이나 온체인 거래는 발생하지 않았습니다.',
                            'This demo receipt reproduces the privacy flow in your browser. No email or on-chain transaction occurred.',
                          )}
                    </p>

                    <div className="receipt-box">
                      <div>
                        <span>Ticket commitment</span>
                        <code>{shortHash(receipt.ticket, 14, 10)}</code>
                        <CopyButton value={receipt.ticket} language={language} />
                      </div>
                      <div>
                        <span>Report commitment</span>
                        <code>{shortHash(receipt.reportCommitment, 14, 10)}</code>
                        <CopyButton value={receipt.reportCommitment} language={language} />
                      </div>
                      <div>
                        <span>Destination hash</span>
                        <code>{shortHash(receipt.destinationCommitment, 14, 10)}</code>
                        <CopyButton value={receipt.destinationCommitment} language={language} />
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
                          <CopyButton value={receipt.nullifier} language={language} />
                        </div>
                      )}
                      {receipt.transactionId && (
                        <div>
                          <span>Midnight transaction</span>
                          <code>{shortHash(receipt.transactionId, 14, 10)}</code>
                          <CopyButton value={receipt.transactionId} language={language} />
                        </div>
                      )}
                    </div>
                    <div className="receipt-meta">
                      <Clock3 size={14} /> {receipt.createdAt} ·{' '}
                      {receipt.source === 'live' ? network.name : 'local demo'}
                      {receipt.attachmentCount
                        ? pick(
                            language,
                            ` · 증거 파일 ${receipt.attachmentCount}개 (${formatEvidenceSize(receipt.attachmentBytes ?? 0)})`,
                            ` · ${receipt.attachmentCount} evidence file${receipt.attachmentCount === 1 ? '' : 's'} (${formatEvidenceSize(receipt.attachmentBytes ?? 0)})`,
                          )
                        : ''}
                    </div>
                    {receipt.source === 'live' && receipt.delivery === 'failed' && liveDeliveryReceipt && (
                      <div className="delivery-recovery">
                        <p>
                          {pick(
                            language,
                            '온체인 접수증은 안전합니다. 새 트랜잭션 없이 전달만 다시 시도할 수 있습니다.',
                            'Your on-chain receipt is safe. Delivery can be retried without a new transaction.',
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={() => void retryDelivery()}
                          disabled={retryingDelivery}
                        >
                          <RefreshCw size={15} />{' '}
                          {retryingDelivery
                            ? pick(language, '전달 재시도 중…', 'Retrying delivery…')
                            : pick(language, '보고서 전달만 재시도', 'Retry report delivery')}
                        </button>
                      </div>
                    )}
                    <button className="secondary-button" onClick={startAgain}>
                      <RefreshCw size={16} /> {pick(language, '새 제보 시작', 'Start a new report')}
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
                language={language}
              />
            </div>
          </section>
        )}

        {!showReport && <MidnightExplainer language={language} />}
      </main>

      <footer>
        <div className="brand">
          <BrandMark />
          <span>GhostWhistle</span>
        </div>
        <p>{pick(language, '신원은 보호하고, 사실은 전달합니다.', 'Protect identity. Deliver the truth.')}</p>
        <span>Midnight Korea Hackathon · 2026</span>
      </footer>
      {showReport && (
        <div
          className="progress-line"
          style={{ width: `${((activeIndex + 1) / reportSteps.length) * 100}%` }}
        />
      )}
    </div>
  );
}
