import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { AppView, Exam, StudentResult, isCustomExam, isSaeExam, isSaevExam, isHerbyExam, isSimuladoExam, templateLabel } from '../types';
import { saeBubbleCenter, SAE_BUBBLE_RADIUS } from '../utils/sae-template';
import { getExams, saveResult, applyRemoteExams } from '../utils/storage';
import {
  deleteExam as deleteLocalExam,
  getDeletedExamIds, markExamDeleted, unmarkExamDeleted,
} from '../utils/storage';
import {
  processImage as apiProcessImage, processMulti, ProcessResult,
  lookupCodigo, saveGabaritoResultado, AlreadyGradedError, postAvulsoResultado,
  fetchExamStudents, ExamStudent, AmbiguousNameError, NameCandidate,
  getExamsFromDB, getExamFromDB, getDeletedExamsFromDB, deleteExamFromDB, getApiBase,
  checkHealth, loadAdaptiveFlag, saveAdaptiveFlag, getTurma, listAlunos,
} from '../utils/api';
import { calculateGrade } from '../utils/grade';
import { computeSubjectStats, getSubjectName, getSubjectIds, getSubjectRange, scoreAnswers } from '../utils/exam';
import { useAutoCapture } from '../hooks/useAutoCapture';
import { measureSharpness, DEFAULT_THRESHOLDS } from '../utils/frame-guides';
import {
  guideRectFor, guideRectForAspect, anchorTargetsFor, anchorTargetsForBox, customAnchorBox,
  thresholdsFor, fallbackGuide, tapToFocusPoint,
} from '../utils/capture-guide';
import type { AnchorBox } from '../utils/anchors';
import { CARD_WIDTH, CARD_HEIGHT } from '../utils/card-template';
import { overlayRowFor, overlayBubbleFor, overlaySaevRowFor, overlaySaevBubbleFor, overlayHerbyRowFor, overlayHerbyBubbleFor, overlaySimuladoRowFor, overlaySimuladoBubbleFor, customBubbleShape } from '../utils/overlay-bubbles';
import { getCustomTemplate, expandBlock, ExpandedBubble } from '../utils/custom-template-api';
import { mergePageAnswers, missingPages } from '../utils/custom-pages';
import { classifyOmrFailure, failureMessage, type OmrFailure } from '../utils/omr-errors';
import { logOmrTelemetry } from '../utils/telemetry';
import {
  addPendingRead, loadPendingReads, removePendingRead, removePendingReads, updatePendingRead,
  type PendingRead,
} from '../utils/pending-reads';
import {
  getAiStatus, isAiAssistEnabled, readSheetWithAi, suggestCorrection,
  type AiSheetResult, type AiStatus, type AiSuggestion,
} from '../utils/ai-assist';
import { compressSheet, cropRegions, type NormBox } from '../utils/ai-crop';
import { questionBubbleBoxes } from '../utils/ai-bubbles';
import { herbyRowsFor } from '../utils/herby-template';
import { SIMULADO_MAX_QUESTIONS } from '../utils/simulado-template';
import { gabaritoCropBox } from '../utils/gabarito-crop';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, ArrowRight, Bot, Camera, CheckCircle2, CloudOff, Eye, Flashlight, FlashlightOff, Focus,
  ImagePlus, ImageUp, Info, PenLine, Play, RefreshCw, RotateCcw, Save,
  SlidersHorizontal, Sun, SwitchCamera, Trash2, X, ZoomIn,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import CornerEditor from '../components/CornerEditor';
import Field from '../components/ui/Field';
import Select from '../components/ui/Select';
import Input from '../components/ui/Input';
import Autocomplete, { AutocompleteOption } from '../components/ui/Autocomplete';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import ReadStages from '../components/omr/ReadStages';
import { anchorLabelFor } from '../utils/read-stages';
import { findStudentMatches, mergeStudentOptions, StudentOption } from '../utils/alunos';

interface Props {
  examId: string | null;
  onNavigate: (view: AppView, examId?: string) => void;
}

type Identification =
  | { kind: 'ok'; name: string; cardId: string; examTitle?: string }
  | { kind: 'wrong_exam'; name: string; cardId: string; examTitle: string }
  | { kind: 'unknown'; cardId: string }
  | null;

// ─── Correção em lote ───

type BatchStatus =
  | 'pending' | 'processing' | 'saved'
  | 'pending_id' | 'unknown_code' | 'wrong_exam'
  | 'conflict' | 'error';

interface BatchItem {
  file: File;
  fileName: string;
  dataUrl: string;
  status: BatchStatus;
  cardId?: string;
  studentName?: string;
  correct?: number;
  incorrect?: number;
  blank?: number;
  grade?: number;
  answers?: Record<number, string>;
  dupQuestions?: number[];
  dupMarks?: Record<number, string[]>;
  lowConfidence?: number[];
  detail?: string;
  previousNota?: number | null;
}

function countResults(
  exam: Exam,
  answers: Record<number, string>,
  dupList: number[],
): { correct: number; incorrect: number; blank: number } {
  // Regra única em utils/exam.ts (não duplicar a política aqui)
  return scoreAnswers(exam, answers, dupList);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Nitidez de um dataUrl (mesma escala do analisador: 320px de largura)
function scoreSharpness(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = 320;
        const H = Math.max(1, Math.round((img.height / Math.max(1, img.width)) * W));
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) { resolve(0); return; }
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const gray = new Uint8Array(W * H);
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          gray[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
        }
        resolve(measureSharpness(gray, W, H));
      } catch {
        resolve(0);
      }
    };
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
}

export default function CorrectCardPage({ examId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const userKey = userId != null ? String(userId) : undefined;
  const [exams, setExams] = useState<Exam[]>(() => getExams(userId));
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Traz provas/gabaritos do servidor (fonte oficial). Servidor vence conflitos.
  const refreshExamsFromServer = async (silent: boolean) => {
    if (!userId || syncing) return;
    if (!(await checkHealth())) {
      if (!silent) setSyncMsg('Backend inalcançável — confira se está rodando.');
      return;
    }
    setSyncing(true);
    try {
      // Lápides: empurra exclusões pendentes e remove cópias locais de provas
      // apagadas em outro aparelho (sem re-empurrar — anti-ressurreição).
      for (const goneId of getDeletedExamIds(userId)) {
        try {
          await deleteExamFromDB(goneId);
          unmarkExamDeleted(goneId, userId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/404/.test(msg)) unmarkExamDeleted(goneId, userId);
        }
      }
      try {
        const gone = await getDeletedExamsFromDB();
        for (const t of gone) {
          markExamDeleted(t.external_id, userId);
          deleteLocalExam(t.external_id, userId);
        }
      } catch {
        // segue sem as lápides desta vez
      }
      const remote = await getExamsFromDB();
      const stats = applyRemoteExams(remote, userId);
      setExams(getExams(userId));
      const total = stats.added + stats.updated;
      setSyncMsg(total > 0
        ? `Provas atualizadas do servidor (+${stats.added} novas, ${stats.updated} atualizadas).`
        : (silent ? null : 'Provas já atualizadas.'));
    } catch {
      if (!silent) setSyncMsg('Falha ao buscar provas do servidor.');
    } finally {
      setSyncing(false);
    }
  };
  const [selectedExamId, setSelectedExamId] = useState(examId || '');
  const [studentName, setStudentName] = useState('');
  const [step, setStep] = useState<'form' | 'capture' | 'processing' | 'review' | 'saved'>('form');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [omrResult, setOmrResult] = useState<ProcessResult | null>(null);
  /** Geometria do Gabarito Personalizado (bolhas normalizadas + âncoras + página). */
  const [customGeom, setCustomGeom] = useState<{ pageW: number; pageH: number; nPages: number; pages: { bubbles: ExpandedBubble[]; anchorBox: AnchorBox; pageW: number; pageH: number }[] } | null>(null);
  // Multi-página (mesma folha): página do modelo que o usuário está lendo.
  const [customPage, setCustomPage] = useState(0);
  // Página do resultado exibido na revisão (pode diferir da página selecionada
  // para a próxima captura — ex.: captura da página 2 cancelada).
  const [resultPage, setResultPage] = useState(0);
  // Multi-página: quais páginas já foram lidas para o cartão atual.
  const [readPages, setReadPages] = useState<Set<number>>(new Set());
  // Capturas que falharam por rede/servidor e ficaram guardadas para reprocessar.
  const [pendingReads, setPendingReads] = useState<PendingRead[]>(() => loadPendingReads(userKey));
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  // Assistente IA local (opt-in): sugestões por questão, nunca aplicadas sozinhas.
  const [aiEnabled] = useState(() => isAiAssistEnabled());
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Record<number, AiSuggestion>>({});
  const [aiLoading, setAiLoading] = useState<number | null>(null);
  const [aiReading, setAiReading] = useState(false);
  const [aiSheet, setAiSheet] = useState<AiSheetResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const reprocessingRef = useRef(false);
  const reprocessPendingIdRef = useRef<string | null>(null);
  const onlineRetryRef = useRef<() => void>(() => {});
  // Configurações globais de detecção (item 5 da Fase 2)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[][]>([]);
  const [batchResults, setBatchResults] = useState<{ idx: number; answers: Record<string, string>; error?: string }[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<Record<string, unknown>>(() => {
    try {
      const raw = localStorage.getItem('omr_global_settings');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [manualAnswers, setManualAnswers] = useState<Record<number, string>>({});
  // Leitura automática indisponível: o usuário digita as respostas do cartão.
  const [manualEntry, setManualEntry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Etapas concluídas da leitura (0–8): marcos reais, nunca temporizador. */
  const [stageDone, setStageDone] = useState(0);
  const [identified, setIdentified] = useState<Identification>(null);
  // Pareamento manual por nome (sem QR): alunos da prova + homônimos
  const [examStudents, setExamStudents] = useState<ExamStudent[]>([]);
  const [candidates, setCandidates] = useState<NameCandidate[] | null>(null);
  const [manualInfo, setManualInfo] = useState<string | null>(null);
  // Autocomplete de nome: aluno travado (atribuição direta) + fallback do catálogo
  const [selectedAlunoId, setSelectedAlunoId] = useState<number | null>(null);
  const [selectedFromCatalog, setSelectedFromCatalog] = useState(false);
  const [turmaOnlyOptions, setTurmaOnlyOptions] = useState<StudentOption[]>([]);
  const [catalogOptions, setCatalogOptions] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  // Captura automática por enquadramento
  const [autoMode, setAutoMode] = useState(true);
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  // Custom: editor de cantos manuais (fallback p/ foto torta). `fromCamera`
  // distingue a prévia travada da câmera de uma releitura após falha.
  const [cornerEdit, setCornerEdit] = useState<{ src: string; fromCamera: boolean } | null>(null);
  // Custom: imagem da última leitura que falhou — permite tentar de novo
  // marcando os cantos à mão (vale p/ câmera e para upload da galeria).
  const [retryUrl, setRetryUrl] = useState<string | null>(null);
  // Layout de captura: grade de terços + painel "Ajustes" (lateral/inline)
  const [showThirds, setShowThirds] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  // Modo contínuo: após salvar, volta direto à câmera (correção em série)
  const [continuous, setContinuous] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  // Limiar adaptativo por foto (experimental, default OFF até evidência)
  const [adaptive, setAdaptive] = useState(() => loadAdaptiveFlag());
  const handleAdaptiveToggle = () => {
    setAdaptive(prev => {
      const next = !prev;
      saveAdaptiveFlag(next);
      return next;
    });
  };
  // Heatmap de diagnóstico (default OFF — só quando pedido)
  const [debugMode, setDebugMode] = useState(() => {
    try { return localStorage.getItem('omr-debug') === '1'; } catch { return false; }
  });
  const handleDebugToggle = () => {
    setDebugMode(prev => {
      const next = !prev;
      try { localStorage.setItem('omr-debug', next ? '1' : '0'); } catch { /* privado */ }
      return next;
    });
  };
  // Visor imersivo: flash do obturador, tempo de busca e portão de nitidez
  const [flashOn, setFlashOn] = useState(false);
  const [searchSecs, setSearchSecs] = useState(0);
  const [sharpRetry, setSharpRetry] = useState<string | null>(null);
  const flashTimerRef = useRef(0);
  const sharpFailsRef = useRef(0);

  // Lote
  const [mode, setMode] = useState<'individual' | 'lote'>('individual');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // De onde a câmera foi aberta: voltar do capture deve devolver à revisão
  // quando a captura foi iniciada pelo botão "Capturar página 2".
  const captureReturnStepRef = useRef<'form' | 'review'>('form');

  // Auto-merge ao abrir a correção: gabarito preenchido no PC chega ao celular.
  // (Servidor vence conflitos; provas só-locais são preservadas.)
  useEffect(() => {
    refreshExamsFromServer(true).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  // Fila local de leituras pendentes (escopo por usuário do aparelho).
  useEffect(() => { setPendingReads(loadPendingReads(userKey)); }, [userKey]);
  // Trocar de prova invalida a seleção em lote.
  useEffect(() => { setSelectedPendingIds(new Set()); }, [selectedExamId]);
  // IA local: checa o Ollama ao entrar na revisão (só se o usuário ligou).
  useEffect(() => {
    if (!aiEnabled || step !== 'review') return;
    let alive = true;
    getAiStatus()
      .then((s) => { if (alive) setAiStatus(s); })
      .catch(() => { if (alive) setAiStatus(null); });
    return () => { alive = false; };
  }, [aiEnabled, step]);
  // Nova leitura invalida sugestões da leitura anterior.
  useEffect(() => { setAiSuggestions({}); setAiSheet(null); setAiError(null); }, [omrResult]);
  // Cleanup: libera a câmera ao desmontar (navegação pela Sidebar/logout)
  useEffect(() => () => {
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
    window.clearTimeout(flashTimerRef.current);
  }, []);
  // Alunos p/ pareamento manual (só quando o QR não identificou).
  // Fonte 1: alunos já materializados na prova (inclui quem veio de turma).
  // Fonte 2: catálogo da turma vinculada — completa nomes ainda não importados.
  // Fonte 3: catálogo global — usado só quando a prova não tem alunos nem turma
  //          (ex.: prova de teste), para o campo não ficar sem sugestões.
  // As fontes 2 e 3 só preenchem o nome; o resultado é criado por nome.
  useEffect(() => {
    if (step !== 'review') return;
    if (identified?.kind === 'ok' || identified?.kind === 'wrong_exam') return;
    const exam = exams.find(e => e.id === selectedExamId);
    if (!exam) return;
    let alive = true;
    setExamStudents([]);
    setTurmaOnlyOptions([]);
    setCatalogOptions([]);
    setStudentsLoading(true);

    (async () => {
      let examList: ExamStudent[] = [];
      try {
        const list = await fetchExamStudents(exam.id);
        examList = Array.isArray(list) ? list : [];
      } catch { /* silencioso: mantém o fluxo avulso */ }
      if (!alive) return;
      setExamStudents(examList);

      let turmaList: StudentOption[] = [];
      if (exam.turmaId != null) {
        try {
          const detail = await getTurma(exam.turmaId);
          turmaList = (detail.alunos ?? []).map(a => ({
            key: `turma:${a.id}`,
            nome: a.nome,
            matricula: a.matricula,
            alunoId: null,
            fromTurmaOnly: true,
            origemLabel: 'turma',
          }));
        } catch { /* silencioso: mantém o fluxo avulso */ }
        if (!alive) return;
        setTurmaOnlyOptions(turmaList);
      }

      // Só busca o catálogo global quando não há nenhuma outra fonte.
      if (examList.length === 0 && turmaList.length === 0) {
        try {
          const catalog = await listAlunos();
          if (!alive) return;
          setCatalogOptions(catalog.map(a => ({
            key: `catalogo:${a.id}`,
            nome: a.nome,
            matricula: a.matricula,
            alunoId: null,
            fromTurmaOnly: true,
            origemLabel: a.turma_nome ? `catálogo · ${a.turma_nome}` : 'catálogo',
          })));
        } catch { /* silencioso: mantém o fluxo avulso */ }
      }
    })().finally(() => { if (alive) setStudentsLoading(false); });

    return () => { alive = false; };
  }, [step, identified, selectedExamId, exams]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Câmeras do aparelho (p/ botão de troca frontal/traseira)
  const [videoDevices, setVideoDevices] = useState<string[]>([]);
  const [deviceIdx, setDeviceIdx] = useState(0);

  const activeExam = selectedExamId ? exams.find(e => e.id === selectedExamId) : null;

  // Pareamento manual: sugere os nomes da prova quando não há QR válido
  const canMatchByName = identified === null || identified?.kind === 'unknown';
  const examOptions: StudentOption[] = useMemo(
    () => examStudents.map(s => ({
      key: String(s.aluno_id),
      nome: s.nome,
      matricula: s.matricula,
      alunoId: s.aluno_id,
      temGabarito: s.tem_gabarito,
      codigoUnico: s.codigo_unico,
    })),
    [examStudents],
  );
  // Completa a lista da prova com o catálogo da turma; se não houver turma,
  // usa o catálogo global. O catálogo nunca fornece alunoId (só o nome).
  const fallbackOptions = useMemo(
    () => (turmaOnlyOptions.length > 0 ? turmaOnlyOptions : catalogOptions),
    [turmaOnlyOptions, catalogOptions],
  );
  const nameSource: StudentOption[] = useMemo(
    () => mergeStudentOptions(examOptions, fallbackOptions),
    [examOptions, fallbackOptions],
  );
  const fallbackLabel = turmaOnlyOptions.length > 0 ? 'da turma' : 'do catálogo';
  const sourceLabel = examOptions.length > 0
    ? (fallbackOptions.length > 0 ? `da prova e ${fallbackLabel}` : 'da prova')
    : fallbackLabel;
  const autoOptions: AutocompleteOption[] = useMemo(
    () => findStudentMatches(nameSource, studentName).map(s => ({
      id: s.key,
      label: s.nome,
      sublabel: s.matricula ?? undefined,
      badge: s.origemLabel ?? (s.temGabarito === false ? 'sem cartão gerado' : undefined),
    })),
    [nameSource, studentName],
  );
  const nameHelper = identified?.kind === 'ok'
    ? 'Identificado pelo banco de dados.'
    : canMatchByName && studentsLoading
      ? 'Carregando lista de alunos...'
      : canMatchByName && nameSource.length > 0
        ? `Digite para buscar entre os ${nameSource.length} alunos ${sourceLabel} — toque num nome para atribuir o resultado direto a ele. Nomes marcados "turma", "catálogo" ou "sem cartão gerado" são vinculados pelo nome.`
        : (!studentName.trim()
          ? 'Informe o nome para salvar — necessário apenas quando o cartão não tem QR Code de lista importada.'
          : undefined);

  const handleStudentNameChange = (v: string) => {
    setStudentName(v);
    setSelectedAlunoId(null);
    setSelectedFromCatalog(false);
  };
  const handlePickStudent = (o: AutocompleteOption) => {
    const found = nameSource.find(s => s.key === String(o.id));
    setStudentName(o.label);
    setSelectedAlunoId(found?.alunoId ?? null);
    setSelectedFromCatalog(!!found?.fromTurmaOnly);
  };

  // ─── Guia de captura adaptado ao gabarito da prova ───
  // SAEV usa adaptativo sempre (evidência: fotos reais 43-44/44 vs 18/41 no fixo)
  const useAdaptive = adaptive || isSaevExam(activeExam) || isHerbyExam(activeExam) || isSimuladoExam(activeExam);
  // Gabarito Personalizado: prova vinculada a um cartão importado (lido pelo
  // motor custom, não pelos modelos nativos).
  const isCustom = isCustomExam(activeExam);
  // Rótulo do modelo considerando o personalizado (chips/avisos).
  const examModelLabel = isCustom ? templateLabel('custom') : templateLabel(activeExam?.templateType);
  const captureTemplate = isCustom ? 'padrao' : activeExam?.templateType === 'colar'
    ? 'colar'
    : isSaevExam(activeExam) ? 'saev' : isSaeExam(activeExam) ? 'sae' : isHerbyExam(activeExam) ? 'herby'
    : isSimuladoExam(activeExam) ? 'simulado' : 'padrao';
  const guideThresholds = useMemo(() => thresholdsFor(captureTemplate), [captureTemplate]);
  // Mede o visor para desenhar o maior A4 sem distorção
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (step !== 'capture') return;
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setViewSize(prev => {
        const w = Math.round(r.width), h = Math.round(r.height);
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);
  // Gabarito Personalizado: o quadro do guia usa a proporção da página do
  // modelo importado e os alvos ficam nas âncoras do próprio modelo.
  const curPageGeom = customGeom?.pages?.[Math.min(customPage, (customGeom?.nPages ?? 1) - 1)];
  // Multi-página: páginas do cartão ainda não lidas (alvo do CTA na revisão).
  const missingCustomPages = isCustom && (customGeom?.nPages ?? 1) > 1
    ? missingPages(readPages, customGeom?.nPages ?? 1)
    : [];
  const nextMissingPage = missingCustomPages[0];
  const customAspect = isCustom && curPageGeom && curPageGeom.pageH > 0
    ? curPageGeom.pageW / curPageGeom.pageH : null;
  const guide = useMemo(
    () => (viewSize.w > 0 && viewSize.h > 0
      ? (customAspect
        ? guideRectForAspect(viewSize.w, viewSize.h, customAspect)
        : guideRectFor(viewSize.w, viewSize.h))
      : fallbackGuide()),
    [viewSize, customAspect],
  );
  const anchorTargets = useMemo(
    () => (isCustom
      ? anchorTargetsForBox(
          (customGeom?.pages?.[Math.min(customPage, (customGeom?.nPages ?? 1) - 1)]?.anchorBox)
            ?? customGeom?.pages?.[0]?.anchorBox
            ?? { x0: 0, y0: 0, x1: 1, y1: 1 },
          guide)
      : anchorTargetsFor(captureTemplate, guide)),
    [guide, captureTemplate, isCustom, customGeom, customPage],
  );

  // Geometria do overlay: prefere o modelo DETECTADO pelo backend (fallback
  // cruzado) e avisa se divergir do modelo da prova selecionada.
  // SAE e Colar têm a mesma geometria — são a mesma "família" no overlay;
  // SAEV tem família própria (quadrados). Mapeia para o modelo canônico.
  const canonicalModel = (t?: string): 'sae' | 'saev' | 'herby' | 'simulado' | 'custom' | 'padrao' =>
    t === 'sae' || t === 'colar' ? 'sae' : t === 'saev' ? 'saev' : t === 'herby' ? 'herby'
      : t === 'simulado' ? 'simulado' : t === 'custom' ? 'custom' : 'padrao';
  const overlayModel = omrResult?.templateUsed
    ? canonicalModel(omrResult.templateUsed)
    : isCustom ? 'custom' : canonicalModel(activeExam?.templateType);
  const examCanonicalModel = isCustom ? 'custom' as const : canonicalModel(activeExam?.templateType);
  const overlaySae = overlayModel === 'sae';
  const overlaySaev = overlayModel === 'saev';
  const overlayHerby = overlayModel === 'herby';
  const overlaySimulado = overlayModel === 'simulado';
  const overlayCustom = overlayModel === 'custom';
  // Overlay do cartão personalizado: usa a página do resultado exibido, não a
  // página armada para a próxima captura.
  const overlayPageGeom = customGeom?.pages?.[Math.min(resultPage, (customGeom?.nPages ?? 1) - 1)];
  const templateMismatch = !!omrResult?.templateUsed && !!activeExam
    && canonicalModel(omrResult.templateUsed) !== examCanonicalModel;

  // Recorte do gabarito: mesma decisão de modelo do overlay (detectado
  // vence) — a visualização mostra só a grade de bolhas, não a folha toda.
  const cropBox = useMemo(() => {
    if (!activeExam) return null;
    return gabaritoCropBox({
      questionsPerSubject: activeExam.questionsPerSubject,
      layoutMode: activeExam.layoutMode,
      totalQuestions: activeExam.totalQuestions,
      templateType: overlayModel === 'sae'
        ? (activeExam.templateType === 'colar' ? 'colar' : 'sae')
        : overlayModel === 'saev' ? 'saev' : overlayModel === 'herby' ? 'herby'
        : overlayModel === 'simulado' ? 'simulado' : 'padrao',
    });
  }, [activeExam, overlayModel]);

  // Geometria do Gabarito Personalizado para o overlay: carrega a config do
  // modelo e expande as bolhas (coordenadas normalizadas 0..1).
  useEffect(() => {
    if (!isCustom || activeExam?.customTemplateId == null) { setCustomGeom(null); return; }
    setCustomPage(0);
    setResultPage(0);
    let alive = true;
    getCustomTemplate(activeExam.customTemplateId)
      .then(detail => {
        if (!alive) return;
        const cfg = detail.config;
        const nPages = Math.max(1, cfg.n_pages ?? 1);
        const pages = Array.from({ length: nPages }, (_, i) => {
          const pageCfg = cfg.questions.filter((b) => (b.page ?? 0) === i);
          const pageAnchors = (cfg.anchors ?? []).filter((a) => (a.page ?? 0) === i);
          // Cada página pode ter a própria imagem (e o próprio aspecto).
          const meta = detail.page_images?.find((p) => p.page === i);
          return {
            bubbles: pageCfg.flatMap(expandBlock),
            anchorBox: customAnchorBox(pageAnchors),
            pageW: meta?.image_w || cfg.page_w || 1,
            pageH: meta?.image_h || cfg.page_h || 1,
          };
        });
        // Fallback: se a página 0 não tiver âncoras (modelo antigo), usa todas.
        if (pages[0].anchorBox.x0 === 0 && pages[0].anchorBox.x1 === 1
            && (cfg.anchors ?? []).length) {
          pages[0].anchorBox = customAnchorBox(cfg.anchors ?? []);
        }
        setCustomGeom({
          pageW: cfg.page_w || 1,
          pageH: cfg.page_h || 1,
          nPages,
          pages,
        });
      })
      .catch(() => { if (alive) setCustomGeom(null); });
    return () => { alive = false; };
  }, [isCustom, activeExam?.customTemplateId]);

  const startCamera = async (
    preferredDeviceId?: string | null,
    allowFileFallback = true,
    returnTo: 'form' | 'review' = 'form',
  ) => {
    captureReturnStepRef.current = returnTo;
    setPendingNotice(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    try {
      setError(null);
      const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      // Dispositivo pedido (troca manual) ou traseira detectada pelo nome
      let rearId: string | null = preferredDeviceId ?? null;
      if (!rearId) {
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const videos = devs.filter(d => d.kind === 'videoinput');
          const rear = videos.find(d => {
            const l = (d.label || '').toLowerCase();
            return /back|rear|traseira|environment|tras/.test(l) && !/front/.test(l);
          });
          rearId = rear?.deviceId || null;
          if (videos.length > 0) {
            setVideoDevices(videos.map(v => v.deviceId).filter(Boolean));
          }
        } catch {
          /* sem permissão p/ nomes — segue p/ facingMode */
        }
      }
      const tryGet = (video: MediaTrackConstraints) =>
        navigator.mediaDevices.getUserMedia({ video });
      let stream: MediaStream;
      try {
        stream = rearId
          ? await tryGet({ deviceId: { exact: rearId }, ...size })
          : await tryGet({ facingMode: { exact: 'environment' }, ...size });
      } catch {
        try {
          stream = await tryGet({ facingMode: { ideal: 'environment' }, ...size });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
      streamRef.current = stream;
      setStep('capture');
      // Aguarda o <video> ser montado após mudar para 'capture'
      await new Promise<void>((r) => setTimeout(r, 80));
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.onloadedmetadata = () => v.play().catch(() => undefined);
        await v.play().catch(() => undefined);
      }
    } catch (err) {
      if (allowFileFallback) fileInputRef.current?.click();
      const e = err as DOMException;
      let msg = allowFileFallback
        ? 'Câmera direta indisponível — abrindo câmera do sistema.'
        : 'Não foi possível trocar de câmera.';
      if (e?.name === 'NotAllowedError') msg = 'Permissão negada — use a câmera do sistema ou libere nas configurações.';
      setError(msg);
    }
  };

  // Alterna entre as câmeras do aparelho (resolve frontal aberta por padrão)
  const switchCamera = async () => {
    if (videoDevices.length < 2) return;
    const next = (deviceIdx + 1) % videoDevices.length;
    setDeviceIdx(next);
    stopCamera();
    resetAuto();
    setConfirmUrl(null);
    setSharpRetry(null);
    await startCamera(videoDevices[next], false, captureReturnStepRef.current);
  };

  // Toque-para-focar no visor (só onde o aparelho expõe pointsOfInterest)
  const handleViewTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!focusPointSupported || !autoMode || confirmUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = tapToFocusPoint(
      rect.width, rect.height,
      e.clientX - rect.left, e.clientY - rect.top,
    );
    void setFocusPoint(p.x, p.y);
  };

  const captureDataUrl = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      setError('Câmera ainda inicializando — aguarde 1 segundo e tente novamente.');
      return null;
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      if (!dataUrl || dataUrl.length < 200) {
        setError('Imagem de captura vazia. Aguarde a câmera estabilizar e tente novamente, ou use “Enviar Imagem”.');
        return null;
      }
      return dataUrl;
    } catch {
      setError('Falha ao gerar imagem da captura. Tente “Enviar Imagem” com a câmera do sistema.');
      return null;
    }
  };

  const captureFrame = () => {
    const dataUrl = captureDataUrl();
    if (!dataUrl) return;
    setCapturedImage(dataUrl);
    burstFramesRef.current = [];
    stopCamera();
    processOMR(dataUrl, [], undefined, isCustom ? customPage : undefined);
  };

  // Captura silenciosa (sem setError): usada pelo multi-shot do portão de nitidez
  const grabFrameSilent = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) return null;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      return dataUrl && dataUrl.length >= 200 ? dataUrl : null;
    } catch {
      return null;
    }
  };

  // Travou o enquadramento → multi-shot com portão de nitidez:
  // captura até 3 frames e confirma o mais nítido; se todos saírem
  // tremidos, descarta e continua tentando (sem travar o fluxo).
  // Os frames ficam guardados p/ a votação multi-frame (A4).
  const burstFramesRef = useRef<string[]>([]);
  const handleAutoLocked = async () => {
    if (confirmUrl) return;
    const shots: { url: string; score: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const shot = grabFrameSilent();
      if (shot) {
        const s = await scoreSharpness(shot);
        shots.push({ url: shot, score: s });
        if (s >= DEFAULT_THRESHOLDS.minSharpness * 2) break;
      }
      if (i < 2) await sleep(150);
    }
    const best = shots.length ? shots.reduce((a, b) => (b.score > a.score ? b : a)) : null;
    if (best && (best.score >= DEFAULT_THRESHOLDS.minSharpness || sharpFailsRef.current >= 2)) {
      sharpFailsRef.current = 0;
      setSharpRetry(null);
      // mais nítido primeiro: empate da votação e QR/retificada vêm dele
      burstFramesRef.current = shots.sort((a, b) => b.score - a.score).map(s => s.url);
      setConfirmUrl(best.url);
      setFlashOn(true);
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlashOn(false), 220);
    } else {
      sharpFailsRef.current += 1;
      burstFramesRef.current = [];
      setSharpRetry('Imagem tremida — segure firme, tentando de novo…');
      resetAuto();
    }
  };

  const { analysis: frameAnalysis, lockProgress, torchOn, torchSupported, toggleTorch,
    zoomSupported, zoom, maxZoom, setZoomLevel,
    exposureSupported, exposureMin, exposureMax, exposureStep, exposure, setExposureLevel,
    focusSupported, focusPointSupported, focusAuto, toggleFocusAuto, setFocusPoint,
    reset: resetAuto } =
    useAutoCapture(videoRef, {
      enabled: step === 'capture' && autoMode && !confirmUrl,
      onLocked: handleAutoLocked,
      thresholds: guideThresholds,
    });

  // Cronômetro da busca: após ~8s sem trava, sugere a captura manual
  useEffect(() => {
    if (step !== 'capture' || !autoMode || confirmUrl) {
      setSearchSecs(0);
      return;
    }
    setSearchSecs(0);
    sharpFailsRef.current = 0;
    const id = window.setInterval(() => setSearchSecs(s => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [step, autoMode, confirmUrl]);

  const confirmAutoCapture = () => {
    if (!confirmUrl) return;
    setCapturedImage(confirmUrl);
    setConfirmUrl(null);
    stopCamera();
    const frames = burstFramesRef.current;
    burstFramesRef.current = [];
    processOMR(confirmUrl, frames, undefined, isCustom ? customPage : undefined);
  };

  // Custom: lê a prévia travada usando os 4 cantos marcados à mão
  const confirmManualCorners = (corners: [number, number][]) => {
    const edit = cornerEdit;
    if (!edit) return;
    setCornerEdit(null);
    if (edit.fromCamera) {
      setCapturedImage(edit.src);
      setConfirmUrl(null);
      stopCamera();
      burstFramesRef.current = [];
    }
    setRetryUrl(null);
    processOMR(edit.src, [], corners, customPage);
  };

  const retryAutoCapture = () => {
    setConfirmUrl(null);
    setSharpRetry(null);
    resetAuto();
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  // Volta da tela de captura em tela cheia para o formulário — ou para a
  // revisão, quando a captura foi aberta pelo CTA "Capturar página N".
  const goBackFromCapture = () => {
    stopCamera();
    setConfirmUrl(null);
    setSharpRetry(null);
    setStep(captureReturnStepRef.current);
  };

  // Inicia a captura de uma página específica do Gabarito Personalizado
  // (usado pelo CTA da revisão para ler a página 2 sem perder as respostas
  // já acumuladas da página 1).
  const startPageCapture = (page: number, source: 'camera' | 'file') => {
    setCustomPage(page);
    setError(null);
    setRetryUrl(null);
    setPendingNotice(null);
    if (source === 'file' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    void startCamera(null, true, 'review');
  };

  // Tela de captura em tela cheia: trava o scroll do fundo + Escape volta
  useEffect(() => {
    if (step !== 'capture') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goBackFromCapture();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingNotice(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCapturedImage(dataUrl);
      setStep('processing');
      processOMR(dataUrl, [], undefined, isCustom ? customPage : undefined);
    };
    reader.onerror = () => setError('Falha ao ler o arquivo de imagem. Tente outra foto.');
    reader.readAsDataURL(file);
  };

  // ─── Fila local de leituras pendentes (rede/servidor fora) ───
  const refreshPending = () => {
    const next = loadPendingReads(userKey);
    setPendingReads(next);
    setSelectedPendingIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(next.map((i) => i.id));
      const kept = [...prev].filter((id) => alive.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  };

  const togglePendingSelection = (id: string) => {
    setSelectedPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPending = () => {
    setSelectedPendingIds((prev) => (
      prev.size === pendingReads.length ? new Set() : new Set(pendingReads.map((p) => p.id))
    ));
  };

  const queuePendingRead = (dataUrl: string, page: number | undefined, failure: OmrFailure) => {
    if (!activeExam || !dataUrl.startsWith('data:image')) return;
    const existingId = reprocessPendingIdRef.current;
    reprocessPendingIdRef.current = null;
    if (!failure.retryable) {
      // Erro da foto/modelo: reprocessar não ajuda; descarta a pendência.
      if (existingId) {
        removePendingRead(existingId);
        refreshPending();
      }
      return;
    }
    if (existingId) {
      updatePendingRead(existingId, { error: failure.title, errorKind: failure.kind });
      refreshPending();
      setPendingNotice('A leitura continua guardada para reprocessar.');
      return;
    }
    const r = addPendingRead({
      userId: userKey,
      examId: activeExam.id,
      examName: activeExam.name,
      page,
      dataUrl,
      error: failure.title,
      errorKind: failure.kind,
    });
    if (r.ok) {
      refreshPending();
      setPendingNotice(r.evicted > 0
        ? 'Captura guardada para reprocessar (a mais antiga foi descartada).'
        : 'Captura guardada para reprocessar quando a conexão voltar.');
    } else {
      setPendingNotice('Não foi possível guardar a captura: armazenamento cheio. Libere leituras pendentes.');
    }
  };

  const discardPending = (id: string) => {
    removePendingRead(id);
    refreshPending();
  };

  const discardSelectedPending = () => {
    if (!selectedPendingIds.size) return;
    removePendingReads([...selectedPendingIds]);
    setSelectedPendingIds(new Set());
    refreshPending();
  };

  const processOMR = async (dataUrl: string, frames: string[] = [], corners?: [number, number][], page?: number): Promise<boolean> => {
    // Página que está sendo lida: o parâmetro vence o estado (evita corrida
    // quando a captura foi disparada logo após trocar de página).
    const readPage = isCustom ? (page ?? customPage) : 0;
    const startedAt = Date.now();
    const reprocessed = reprocessPendingIdRef.current != null;
    // Leitura de página seguinte (página 1 já conferida): mantém o resultado
    // anterior montado para que uma falha volte à revisão, e não ao formulário.
    const isFollowUpPage = isCustom && (customGeom?.nPages ?? 1) > 1 && readPages.size > 0;
    setStep('processing');
    setError(null);
    setManualEntry(false);
    if (!isFollowUpPage) setOmrResult(null);
    setStageDone(1); // 1. imagem recebida

    try {
      const qpsUsado = activeExam?.questionsPerSubject ?? 22;
      const modoUsado = activeExam?.layoutMode ?? 'dual';
      const templateUsado = activeExam?.templateType === 'colar' ? 'colar' : isSaevExam(activeExam) ? 'saev' : isSaeExam(activeExam) ? 'sae' : activeExam?.templateType === 'herby' ? 'herby' : isSimuladoExam(activeExam) ? 'simulado' : 'padrao';

      let result: ProcessResult;
      if (frames.length > 1 && !isCustom) {
        // Votação multi-frame: N frames da rajada → 1 resultado (divergência vira low_conf)
        const files = await Promise.all(frames.map(async (url) => {
          const res = await fetch(url);
          const blob = await res.blob();
          return new File([blob], 'frame.jpg', { type: 'image/jpeg' });
        }));
        result = await processMulti(files, qpsUsado, modoUsado, templateUsado, useAdaptive, debugMode);
      } else {
        // Converter dataUrl para File para enviar à API Python
        // (Gabarito Personalizado usa sempre 1 frame: o motor custom não vota múltiplos frames)
        const source = isCustom && frames.length > 1 ? frames[0] : dataUrl;
        const res = await fetch(source);
        const blob = await res.blob();
        const file = new File([blob], 'card.jpg', { type: 'image/jpeg' });
        result = await apiProcessImage(file, qpsUsado, modoUsado,
                                       isCustom ? 'custom' : templateUsado,
                                       useAdaptive, debugMode, activeExam?.customTemplateId,
                                       corners ?? null,
                                        isCustom ? (page ?? customPage) : undefined,
                                        isCustom ? globalSettings : null);
      }
      // 2–5. concluíram no servidor (âncoras, perspectiva, regiões, marcações)
      setStageDone(5);

      // Multi-página: todas as páginas do cartão têm de ser do MESMO aluno.
      // Sem esta trava, a página 2 de outro cartão misturaria as respostas e o
      // salvamento iria para o último QR lido.
      if (isCustom && (customGeom?.nPages ?? 1) > 1 && result.cardId
          && identified?.cardId && result.cardId !== identified.cardId) {
        const dono = identified.kind === 'ok' || identified.kind === 'wrong_exam'
          ? ` (${identified.name})` : '';
        setError(
          `Esta página pertence ao cartão ${result.cardId}, mas a leitura aberta é do cartão `
          + `${identified.cardId}${dono}. Use "Nova leitura" para corrigir o outro cartão.`
        );
        setCapturedImage(null);
        setRetryUrl(dataUrl);
        setStep(isFollowUpPage ? 'review' : 'form');
        logOmrTelemetry({
          userId: userKey,
          examId: activeExam?.id,
          template: 'custom',
          customTemplateId: activeExam?.customTemplateId,
          page: readPage,
          success: false,
          errorKind: 'processing',
          error: 'cartao_divergente',
          durationMs: Date.now() - startedAt,
          reprocessed,
        });
        return false;
      }

      setOmrResult(result);

      if (result.success && result.answers) {
        // Multi-página: acumula respostas por página, substituindo as questões
        // da página lida (evita respostas velhas em releituras).
        const pageAnswers = result.answers;
        const pageQuestionIds = customGeom?.pages?.[readPage]?.bubbles.map((b) => b.question) ?? [];
        const multiPage = isCustom && (customGeom?.nPages ?? 1) > 1;
        setManualAnswers((prev) => (multiPage
          ? mergePageAnswers(prev, pageAnswers, pageQuestionIds)
          : { ...pageAnswers }));
        if (multiPage) {
          setReadPages((s) => new Set(s).add(readPage));
        }
        setResultPage(readPage);

        // ─── Identificação: QR → codigo_unico → banco → aluno (§12-13) ───
        let identification: Identification = null;
        if (result.cardId) {
          try {
            const lk = await lookupCodigo(result.cardId);
            if (lk.found) {
              const mesmaProva = !selectedExamId || selectedExamId === lk.avaliacao.external_id;
              if (mesmaProva) {
                if (lk.avaliacao.external_id !== selectedExamId) {
                  setSelectedExamId(lk.avaliacao.external_id);
                  // A prova do QR pode não existir neste aparelho (criada no PC):
                  // baixa do servidor e incorpora à lista local para o salvamento funcionar.
                  try {
                    const dbExam = await getExamFromDB(lk.avaliacao.external_id);
                    applyRemoteExams([dbExam], userId);
                    setExams(getExams(userId));
                  } catch {
                    // segue sem a prova local — o guard do salvamento avisará
                  }
                  const qpsIdent = lk.avaliacao.questions_per_subject ?? 22;
                  if (qpsIdent !== qpsUsado) {
                    alert(
                      `Atenção: este cartão pertence à prova "${lk.avaliacao.titulo}", com `
                      + `${qpsIdent} questões por disciplina — a leitura usou ${qpsUsado}. `
                      + 'Capture novamente com a prova correta selecionada.'
                    );
                  }
                }
                setStudentName(lk.aluno.nome);
                identification = {
                  kind: 'ok', name: lk.aluno.nome, cardId: lk.codigo_unico,
                  examTitle: lk.avaliacao.titulo,
                };
              } else {
                // §18 — QR de outra avaliação: não corrigir automaticamente
                identification = {
                  kind: 'wrong_exam', name: lk.aluno.nome, cardId: lk.codigo_unico,
                  examTitle: lk.avaliacao.titulo,
                };
              }
            } else {
              // §17 — código lido mas inexistente no banco
              identification = { kind: 'unknown', cardId: result.cardId };
            }
          } catch {
            identification = { kind: 'unknown', cardId: result.cardId };
          }
        }
        // Página de um cartão multi-página sem QR (ex.: só a página 1 tem o
        // cabeçalho): mantém a identificação já feita em vez de apagá-la e
        // cair no salvamento por nome.
        const semQrNaPagina = isCustom && (customGeom?.nPages ?? 1) > 1 && !result.cardId;
        if (!(semQrNaPagina && identified)) {
          setIdentified(identification);
          setCandidates(null);
          setManualInfo(null);
        }
        // 6. comparação com o gabarito oficial (identificação resolvida)
        setStageDone(6);
        setRetryUrl(null);
        setStep('review');
        logOmrTelemetry({
          userId: userKey,
          examId: activeExam?.id,
          template: isCustom ? 'custom' : activeExam?.templateType,
          customTemplateId: activeExam?.customTemplateId,
          page: isCustom ? readPage : undefined,
          success: true,
          cardId: result.cardId,
          readCount: Object.keys(result.answers ?? {}).length,
          blankCount: result.blankQuestions?.length ?? 0,
          dupCount: result.duplicateQuestions?.length ?? 0,
          lowCount: result.lowConfidence?.length ?? 0,
          durationMs: Date.now() - startedAt,
          reprocessed,
        });
        if (reprocessed && reprocessPendingIdRef.current) {
          removePendingRead(reprocessPendingIdRef.current);
          reprocessPendingIdRef.current = null;
          refreshPending();
          setPendingNotice('Leitura pendente reprocessada com sucesso.');
        }
        return true;
      } else {
        const failure = classifyOmrFailure(result.error || 'Falha na leitura do cartão.');
        setError(failureMessage(failure));
        queuePendingRead(dataUrl, isCustom ? readPage : undefined, failure);
        logOmrTelemetry({
          userId: userKey,
          examId: activeExam?.id,
          template: isCustom ? 'custom' : activeExam?.templateType,
          customTemplateId: activeExam?.customTemplateId,
          page: isCustom ? readPage : undefined,
          success: false,
          errorKind: failure.kind,
          error: result.error ?? failure.title,
          durationMs: Date.now() - startedAt,
          reprocessed,
        });
        setCapturedImage(null);
        setRetryUrl(dataUrl); // custom: permite tentar de novo marcando os cantos
        setStep(isFollowUpPage ? 'review' : 'form');
        return false;
      }
    } catch (err) {
      const failure = classifyOmrFailure(err);
      setError(failureMessage(failure));
      queuePendingRead(dataUrl, isCustom ? readPage : undefined, failure);
      logOmrTelemetry({
        userId: userKey,
        examId: activeExam?.id,
        template: isCustom ? 'custom' : activeExam?.templateType,
        customTemplateId: activeExam?.customTemplateId,
        page: isCustom ? readPage : undefined,
        success: false,
        errorKind: failure.kind,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        reprocessed,
      });
      setCapturedImage(null);
      setRetryUrl(dataUrl);
      setStep(isFollowUpPage ? 'review' : 'form');
      return false;
    }
  };

  // Reprocessa uma captura guardada. Devolve true quando a leitura concluiu.
  const reprocessPending = async (item: PendingRead): Promise<boolean> => {
    if (reprocessingRef.current) return false;
    if (!activeExam || item.examId !== activeExam.id) {
      setError(`A leitura pendente é da prova "${item.examName ?? item.examId}". Abra essa prova para reprocessar.`);
      return false;
    }
    reprocessingRef.current = true;
    setReprocessing(true);
    reprocessPendingIdRef.current = item.id;
    setPendingNotice(item.page != null
      ? `Reprocessando a página ${item.page + 1}…`
      : 'Reprocessando a captura…');
    if (isCustom && item.page != null) setCustomPage(item.page);
    try {
      return await processOMR(item.dataUrl, [], undefined, item.page);
    } finally {
      reprocessingRef.current = false;
      setReprocessing(false);
      reprocessPendingIdRef.current = null;
      refreshPending();
    }
  };

  const reprocessAllPending = async () => {
    if (!activeExam) return;
    const items = loadPendingReads(userKey).filter((i) => i.examId === activeExam.id);
    for (const item of items) {
      const ok = await reprocessPending(item);
      if (!ok) break;
    }
  };

  const reprocessSelectedPending = async () => {
    if (!activeExam || !selectedPendingIds.size) return;
    const items = loadPendingReads(userKey)
      .filter((i) => selectedPendingIds.has(i.id) && i.examId === activeExam.id);
    if (!items.length) return;
    setSelectedPendingIds(new Set());
    for (const item of items) {
      const ok = await reprocessPending(item);
      if (!ok) break;
    }
  };

  // Ao voltar a conexão, tenta reprocessar a primeira pendência da prova aberta
  // (somente no formulário, para não interromper uma revisão em andamento).
  useEffect(() => {
    onlineRetryRef.current = () => {
      if (!activeExam || step !== 'form' || reprocessingRef.current) return;
      const item = loadPendingReads(userKey).find((i) => i.examId === activeExam.id);
      if (!item) return;
      setPendingNotice('Conexão restabelecida — reprocessando a leitura pendente…');
      void reprocessPending(item);
    };
  });
  useEffect(() => {
    const onOnline = () => onlineRetryRef.current();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // Fallback quando o cartão não é lido/detectado: abre a conferência com as
  // respostas em branco para o usuário digitar o gabarito do aluno. O cartão
  // físico (ou a foto enviada) serve de referência. Exige gabarito da prova.
  const startManualEntry = () => {
    if (!activeExam) {
      setError(
        'Prova não encontrada neste aparelho. Volte à seleção, toque em "⟳ Atualizar do servidor" '
        + 'e tente novamente.'
      );
      return;
    }
    if (!activeExam.answerKey) {
      alert('Esta prova ainda não tem gabarito cadastrado. Vá em "Cadastrar gabarito" e informe as respostas corretas antes de corrigir.');
      return;
    }
    setOmrResult({
      success: true,
      answers: {},
      blankQuestions: [],
      duplicateQuestions: [],
      duplicateMarks: {},
      lowConfidence: [],
      cardId: omrResult?.cardId,
    });
    setManualAnswers({});
    if (retryUrl) setCapturedImage(retryUrl);
    setIdentified(null);
    setSelectedAlunoId(null);
    setSelectedFromCatalog(false);
    setCandidates(null);
    setManualInfo(null);
    setError(null);
    setStageDone(6);
    setManualEntry(true);
    setStep('review');
  };

  const handleManualAnswer = (question: number, answer: string) => {
    setManualAnswers(prev => {
      const next = { ...prev };
      if (next[question] === answer) {
        delete next[question];
      } else {
        next[question] = answer;
      }
      return next;
    });
  };

  // ─── Assistente IA local (Ollama) ───
  // Caixas normalizadas das bolhas A–D da questão na imagem retificada.
  const bubbleBoxesForQuestion = (q: number): NormBox[] => {
    if (!activeExam) return [];
    if (overlayCustom) {
      return questionBubbleBoxes('custom', null, q, overlayPageGeom);
    }
    const model = overlaySae ? 'sae'
      : overlaySaev ? 'saev'
      : overlayHerby ? 'herby'
      : overlaySimulado ? 'simulado'
      : 'padrao';
    return questionBubbleBoxes(model, activeExam, q);
  };

  // Questões que merecem ajuda: baixa confiança, duplicadas ou em branco,
  // ainda sem resposta manual. Depois de aplicar/editar, saem da lista.
  // No Gabarito Personalizado multi-página só entram as questões da página
  // exibida: a imagem retificada é a da última página lida.
  const doubtfulQuestions = useMemo(() => {
    if (!omrResult) return [] as number[];
    const set = new Set<number>();
    for (const q of omrResult.lowConfidence ?? []) set.add(q);
    for (const q of omrResult.duplicateQuestions ?? []) set.add(q);
    for (const q of omrResult.blankQuestions ?? []) set.add(q);
    const pageQuestions = overlayCustom && (customGeom?.nPages ?? 1) > 1 && overlayPageGeom
      ? new Set(overlayPageGeom.bubbles.map((b) => b.question))
      : null;
    return [...set]
      .filter((q) => !manualAnswers[q])
      .filter((q) => !pageQuestions || pageQuestions.has(q))
      .sort((a, b) => a - b);
  }, [omrResult, manualAnswers, overlayCustom, customGeom, overlayPageGeom]);

  // Questões que existem na imagem exibida — a leitura por IA vê só esta folha.
  const pageQuestionList = useMemo(() => {
    if (!omrResult) return [] as number[];
    const qs = overlayCustom && (customGeom?.nPages ?? 1) > 1 && overlayPageGeom
      ? overlayPageGeom.bubbles.map((b) => b.question)
      : Object.keys(omrResult.allRatios ?? {}).map(Number);
    return [...new Set(qs)].filter((q) => Number.isFinite(q) && q > 0).sort((a, b) => a - b);
  }, [omrResult, overlayCustom, customGeom, overlayPageGeom]);

  // Divergências IA × OMR — só informativo; nada é aplicado sozinho.
  const aiDivergences = useMemo(() => {
    if (!aiSheet) return [] as { q: number; omr: string; ai: string }[];
    return Object.entries(aiSheet.answers)
      .filter(([, a]) => /^[ABCD]$/.test(a))
      .map(([q, a]) => ({ q: Number(q), omr: omrResult?.answers?.[Number(q)] ?? '', ai: a }))
      .filter((d) => d.omr !== d.ai)
      .sort((x, y) => x.q - y.q);
  }, [aiSheet, omrResult]);

  // Corrige a folha inteira com o modelo local. Só preenche a conferência:
  // aplicar continua sendo decisão do usuário, e salvar também.
  const runAiReadAll = async () => {
    if (!omrResult) return;
    const image = omrResult.rectifiedImage;
    if (!image) {
      setAiError('A imagem retificada não está disponível para esta leitura.');
      return;
    }
    if (!pageQuestionList.length) {
      setAiError('Não há questões para ler nesta folha.');
      return;
    }
    setAiReading(true);
    setAiError(null);
    try {
      const compressed = await compressSheet(image);
      setAiSheet(await readSheetWithAi({ image: compressed, questions: pageQuestionList }));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Falha na leitura por IA.');
    } finally {
      setAiReading(false);
    }
  };

  const applyAiSheet = () => {
    if (!aiSheet) return;
    const letters = Object.entries(aiSheet.answers).filter(([, a]) => /^[ABCD]$/.test(a));
    if (!letters.length) return;
    setManualAnswers((prev) => {
      const next = { ...prev };
      for (const [q, a] of letters) next[Number(q)] = a;
      return next;
    });
    setAiSheet(null);
  };

  const runAiSuggestion = async (q: number) => {
    if (!omrResult) return;
    const image = omrResult.rectifiedImage;
    if (!image) {
      setAiError('A imagem retificada não está disponível para esta leitura.');
      return;
    }
    const boxes = bubbleBoxesForQuestion(q);
    if (!boxes.length) {
      setAiError(overlayCustom
        ? 'Esta questão não está na página exibida. Abra a página dela para usar o assistente.'
        : 'Não foi possível localizar as bolhas desta questão neste modelo.');
      return;
    }
    setAiLoading(q);
    setAiError(null);
    try {
      const crop = await cropRegions(image, boxes);
      const marks = omrResult.duplicateMarks?.[q];
      const suggestion = await suggestCorrection({
        image: crop,
        question: q,
        options: ['A', 'B', 'C', 'D'],
        ratios: omrResult.allRatios?.[q] ?? null,
        context: {
          low_confidence: (omrResult.lowConfidence ?? []).includes(q),
          duplicate: (omrResult.duplicateQuestions ?? []).includes(q),
          blank: (omrResult.blankQuestions ?? []).includes(q),
          marks,
        },
      });
      setAiSuggestions((prev) => ({ ...prev, [q]: suggestion }));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Falha ao consultar o assistente local.');
    } finally {
      setAiLoading(null);
    }
  };

  const applyAiSuggestion = (q: number, answer: string) => {
    if (!/^[ABCD]$/.test(answer)) return;
    setManualAnswers((prev) => ({ ...prev, [q]: answer }));
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[q];
      return next;
    });
  };

  const ignoreAiSuggestion = (q: number) => {
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[q];
      return next;
    });
  };

  // Monta o payload da correção a partir da conferência (reuso no salvamento e na escolha de homônimo)
  const buildManualPayload = () => {
    if (!activeExam) {
      setError(
        'Prova não encontrada neste aparelho. Volte à seleção, toque em "⟳ Atualizar do servidor" '
        + 'e corrija novamente — o resultado desta leitura foi descartado para não salvar na prova errada.'
      );
      return null;
    }
    if (!activeExam.answerKey) {
      alert('Esta prova ainda não tem gabarito cadastrado. Vá em "Cadastrar gabarito" e informe as respostas corretas antes de corrigir.');
      return null;
    }
    const dupList = omrResult?.duplicateQuestions ?? [];
    const dupMarks = omrResult?.duplicateMarks ?? {};
    const { correct: correctCount, incorrect: incorrectCount, blank: blankCount } =
      scoreAnswers(activeExam, manualAnswers, dupList);
    const grade = calculateGrade(correctCount, activeExam.totalQuestions, activeExam.gradeScale);
    const observacoes = dupList.length
      ? `Duplicadas (contadas como erro): ${dupList.map((q) => {
          const m = dupMarks[q];
          return `Q${q}${m?.length ? ` (${m.join(', ')})` : ''}`;
        }).join(', ')}`
      : undefined;
    const basePayload = {
      respostas: Object.fromEntries(Object.entries(manualAnswers).map(([q, a]) => [q, a])),
      acertos: correctCount,
      erros: incorrectCount,
      brancos: blankCount,
      nota: grade,
      observacoes,
    };
    return { basePayload, correctCount, incorrectCount, blankCount, grade, dupList, dupMarks, observacoes };
  };

  type ManualPayload = NonNullable<ReturnType<typeof buildManualPayload>>;

  // Persiste sem QR: casa o nome com os alunos da prova. Devolve null quando
  // o fluxo pausa (homônimos aguardando escolha, ou substituição recusada).
  const saveManualByName = async (
    built: ManualPayload,
    opts: { alunoId?: number; overwrite?: boolean } = {},
  ): Promise<{ codigoUnico?: string; finalName: string; matchedByName: boolean } | null> => {
    if (!activeExam) return null;
    const typed = studentName.trim();
    const payload = {
      nome: typed,
      respostas: built.basePayload.respostas,
      acertos: built.correctCount,
      erros: built.incorrectCount,
      brancos: built.blankCount,
      nota: built.grade,
      observacoes: built.observacoes,
    };
    const register = (codigoUnico: string, finalName: string, matchedByName: boolean, novoCartao: boolean) => {
      setStudentName(finalName);
      setManualInfo(novoCartao
        ? `Aluno "${finalName}" ainda não tinha cartão gerado — o resultado foi criado e vinculado a ele.`
        : `Atribuído ao aluno "${finalName}" já cadastrado na prova (cartão ${codigoUnico}).`);
      return { codigoUnico, finalName, matchedByName };
    };
    try {
      const av = await postAvulsoResultado(activeExam.id, payload, opts);
      return register(av.codigo_unico, av.aluno.nome, av.matched, av.novo_cartao);
    } catch (err) {
      if (err instanceof AlreadyGradedError) {
        const prev = err.previous;
        const msg = `O aluno ${prev.nome ?? typed} já possui resultado salvo`
          + `${prev.nota != null ? ` (nota ${prev.nota})` : ''}. Substituir?`;
        if (!confirm(msg)) return null;
        try {
          const av2 = await postAvulsoResultado(activeExam.id, payload, { ...opts, overwrite: true });
          return register(av2.codigo_unico, av2.aluno.nome, av2.matched, av2.novo_cartao);
        } catch {
          alert('Não foi possível atualizar o resultado no servidor. O resultado ficou salvo apenas neste navegador.');
          return null;
        }
      }
      if (err instanceof AmbiguousNameError) {
        setCandidates(err.candidates);
        return null;
      }
      // backend offline — segue apenas local
      return { codigoUnico: undefined, finalName: typed, matchedByName: false };
    }
  };

  const finishSave = async (
    r: { codigoUnico?: string; finalName: string; matchedByName: boolean },
    built: ManualPayload,
    qrOk: boolean,
  ) => {
    if (!activeExam) return;
    const result: StudentResult = {
      id: uuidv4(),
      examId: activeExam.id,
      studentName: r.finalName,
      answers: { ...manualAnswers },
      correctCount: built.correctCount,
      incorrectCount: built.incorrectCount,
      blankCount: built.blankCount,
      duplicateCount: built.dupList.length,
      duplicateQuestions: built.dupList,
      duplicateMarks: built.dupMarks,
      lowConfidence: omrResult?.lowConfidence ?? [],
      qrOk,
      codigoUnico: r.codigoUnico,
      matchedByName: r.matchedByName || undefined,
      grade: built.grade,
      timestamp: new Date().toISOString(),
      manualOverrides: {},
    };
    try {
      saveResult(result, userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o resultado neste aparelho.');
      return;
    }
    setSessionCount(c => c + 1);
    if (continuous) {
      // Modo contínuo: volta direto à câmera com a mesma prova
      setStudentName('');
      setSelectedAlunoId(null);
      setSelectedFromCatalog(false);
      setCapturedImage(null);
      setOmrResult(null);
      setManualAnswers({});
      setManualEntry(false);
      setReadPages(new Set());
      setCustomPage(0);
      setResultPage(0);
      setError(null);
      setStageDone(0);
      setIdentified(null);
      setCandidates(null);
      setManualInfo(null);
      setConfirmUrl(null);
      setSharpRetry(null);
      setRetryUrl(null);
      setPendingNotice(null);
      resetAuto();
      await startCamera();
    } else {
      setStep('saved');
    }
  };

  // Escolha de homônimo: atribui direto ao aluno selecionado
  const chooseNameCandidate = async (c: NameCandidate) => {
    setCandidates(null);
    setError(null);
    if (!activeExam) return;
    const built = buildManualPayload();
    if (!built) return;
    const r = await saveManualByName(built, { alunoId: c.aluno_id });
    if (!r) return;
    await finishSave(r, built, false);
  };

  const handleSaveResult = async () => {
    // Guards com mensagem — jamais retornar silencioso (salvamento "sumido")
    if (!activeExam) {
      setError(
        'Prova não encontrada neste aparelho. Volte à seleção, toque em "⟳ Atualizar do servidor" '
        + 'e corrija novamente — o resultado desta leitura foi descartado para não salvar na prova errada.'
      );
      return;
    }
    if (!studentName.trim()) {
      setError('Informe o nome do aluno para salvar o resultado.');
      return;
    }
    if (!activeExam.answerKey) {
      alert('Esta prova ainda não tem gabarito cadastrado. Vá em "Cadastrar gabarito" e informe as respostas corretas antes de corrigir.');
      return;
    }
    if (manualEntry && Object.keys(manualAnswers).length === 0) {
      if (!confirm('Nenhuma resposta foi preenchida. Salvar mesmo assim, contando todas as questões como em branco?')) {
        return;
      }
    }
    // Multi-página: avisa se faltam páginas lidas antes de salvar.
    if (!manualEntry && isCustom && (customGeom?.nPages ?? 1) > 1
        && readPages.size < (customGeom?.nPages ?? 1)) {
      const faltam = Array.from({ length: customGeom?.nPages ?? 1 }, (_, i) => i)
        .filter((i) => !readPages.has(i))
        .map((i) => i + 1)
        .join(', ');
      if (!confirm(`Faltam as páginas ${faltam} deste cartão. Salvar mesmo assim?`)) {
        return;
      }
    }
    // §18 — gabarito de outra avaliação não pode ser corrigido aqui
    if (identified?.kind === 'wrong_exam') {
      setError(`Este cartão pertence à prova "${identified.examTitle}". Selecione a prova correta para corrigir.`);
      return;
    }
    const built = buildManualPayload();
    if (!built) return;

    // ─── Persistência oficial no banco (todos os casos) ───
    if (identified?.kind === 'ok') {
      try {
        await saveGabaritoResultado(identified.cardId, built.basePayload, false);
      } catch (err) {
        if (err instanceof AlreadyGradedError) {
          const prev = err.previous;
          const msg = `O gabarito ${identified.cardId} já possui resultado salvo`
            + `${prev.nome ? ` para ${prev.nome}` : ''}`
            + `${prev.nota != null ? ` (nota ${prev.nota})` : ''}. Substituir?`;
          if (confirm(msg)) {
            try {
              await saveGabaritoResultado(identified.cardId, built.basePayload, true);
            } catch {
              alert('Não foi possível atualizar o resultado no servidor. O resultado ficou salvo apenas neste navegador.');
            }
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Falha ao gravar no banco: ${msg}. Verifique a conexão com ${getApiBase()} (mesma Wi-Fi no celular) e se está logado.`);
        }
      }
      await finishSave({ codigoUnico: identified.cardId, finalName: studentName.trim(), matchedByName: false }, built, true);
    } else if (studentName.trim() && activeExam) {
      // Sem QR (ou QR desconhecido): nome clicado na lista atribui direto ao aluno
      const r = await saveManualByName(built, selectedAlunoId != null ? { alunoId: selectedAlunoId } : {});
      if (!r) return;
      await finishSave(r, built, false);
    }
  };

  const resetForm = () => {
    setStudentName('');
    setSelectedAlunoId(null);
    setSelectedFromCatalog(false);
    setCapturedImage(null);
    setOmrResult(null);
    setManualAnswers({});
    setManualEntry(false);
    setReadPages(new Set());
    setCustomPage(0);
    setResultPage(0);
    setError(null);
    setStageDone(0);
    setIdentified(null);
    setCandidates(null);
    setManualInfo(null);
    setRetryUrl(null);
    setCornerEdit(null);
    setPendingNotice(null);
    setStep('form');
  };

  // ─── Correção em lote ───

  const handleBatchFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    let loaded = 0;
    const items: BatchItem[] = [];
    files.forEach((file) => {
      const reader = new FileReader();
      const done = () => {
        loaded++;
        if (loaded === files.length) {
          items.sort((a, b) => a.fileName.localeCompare(b.fileName));
          setBatchItems(items);
          if (items.length === 0) setError('Nenhum arquivo pôde ser lido. Tente outras fotos.');
        }
      };
      reader.onload = () => {
        items.push({
          file,
          fileName: file.name,
          dataUrl: reader.result as string,
          status: 'pending',
        });
        done();
      };
      reader.onerror = () => done();
      reader.readAsDataURL(file);
    });
  };

  const patchItem = (fileName: string, patch: Partial<BatchItem>) => {
    setBatchItems(prev => prev.map(it => it.fileName === fileName ? { ...it, ...patch } : it));
  };

  const runBatch = async () => {
    const exam = activeExam;
    if (!exam) {
      setError('Prova não encontrada neste aparelho. Toque em "⟳ Atualizar do servidor" e tente o lote novamente.');
      return;
    }
    if (!exam.answerKey || batchItems.length === 0) return;
    const qps = exam.questionsPerSubject;
    const layoutMode = exam.layoutMode ?? 'dual';
    setBatchRunning(true);
    setError(null);

    for (const item of batchItems) {
      if (!['pending', 'conflict'].includes(item.status)) continue;
      patchItem(item.fileName, { status: 'processing' });

      try {
        // 1. Leitura OMR + QR (usa o modelo da prova; fallback cruzado no backend)
        const tpl = isCustomExam(exam) ? 'custom'
          : exam.templateType === 'saev' ? 'saev' : exam.templateType === 'herby' ? 'herby'
          : exam.templateType === 'simulado' ? 'simulado' : undefined;
        const result = await apiProcessImage(item.file, qps, layoutMode, tpl, adaptive || exam.templateType === 'saev' || exam.templateType === 'herby' || exam.templateType === 'simulado', debugMode, exam.customTemplateId);
        if (!result.success || !result.answers) {
          patchItem(item.fileName, { status: 'error', detail: result.error || 'Falha na leitura' });
          continue;
        }

        const answers = { ...result.answers };
        const dupQuestions = result.duplicateQuestions ?? [];
        const dupMarks = result.duplicateMarks ?? {};
        const base = {
          answers, dupQuestions, dupMarks,
          lowConfidence: result.lowConfidence ?? [],
        };

        // 2. Identificação obrigatória pelo QR (§13)
        if (!result.cardId) {
          patchItem(item.fileName, { ...base, status: 'pending_id', detail: 'QR Code não legível na foto' });
          continue;
        }
        const lk = await lookupCodigo(result.cardId);
        if (!lk.found) {
          patchItem(item.fileName, {
            ...base, status: 'unknown_code',
            cardId: result.cardId,
            detail: `Código ${result.cardId} não pertence a nenhum gabarito registrado`,
          });
          continue;
        }
        if (lk.avaliacao.external_id !== exam.id) {
          patchItem(item.fileName, {
            ...base, status: 'wrong_exam',
            cardId: lk.codigo_unico,
            studentName: lk.aluno.nome,
            detail: `Gabarito de outra avaliação: "${lk.avaliacao.titulo}"`,
          });
          continue;
        }

        // 3. Correção automática
        const { correct, incorrect, blank } = countResults(exam, answers, dupQuestions);
        const grade = calculateGrade(correct, exam.totalQuestions, exam.gradeScale);

        // 4. Persistência no banco (com confirmação para reprocessamento)
        try {
          await saveGabaritoResultado(lk.codigo_unico, {
            respostas: answers,
            acertos: correct,
            erros: incorrect,
            brancos: blank,
            nota: grade,
            observacoes: dupQuestions.length
              ? `Duplicadas (contadas como erro): ${dupQuestions.map(q => {
                  const m = dupMarks[q];
                  return `Q${q}${m?.length ? ` (${m.join(', ')})` : ''}`;
                }).join(', ')}`
              : undefined,
          }, false);
        } catch (err) {
          if (err instanceof AlreadyGradedError) {
            patchItem(item.fileName, {
              ...base, status: 'conflict',
              cardId: lk.codigo_unico,
              studentName: lk.aluno.nome,
              correct, incorrect, blank, grade,
              previousNota: err.previous.nota ?? null,
              detail: 'Já possui resultado salvo — confirme para substituir',
            });
            continue;
          }
          throw err;
        }

        saveResult({
          id: uuidv4(),
          examId: exam.id,
          studentName: lk.aluno.nome,
          answers,
          correctCount: correct,
          incorrectCount: incorrect,
          blankCount: blank,
          duplicateCount: dupQuestions.length,
          duplicateQuestions: dupQuestions,
          duplicateMarks: dupMarks,
          lowConfidence: item.lowConfidence ?? [],
          qrOk: true,
          grade,
          timestamp: new Date().toISOString(),
          manualOverrides: {},
        }, userId);

        patchItem(item.fileName, {
          ...base, status: 'saved',
          cardId: lk.codigo_unico,
          studentName: lk.aluno.nome,
          correct, incorrect, blank, grade,
        });
      } catch (err) {
        patchItem(item.fileName, {
          status: 'error',
          detail: err instanceof Error ? err.message : 'Erro inesperado',
        });
      }
    }

    setBatchRunning(false);
  };

  const resolveConflict = async (item: BatchItem) => {
    if (!activeExam || item.cardId === undefined) return;
    try {
      await saveGabaritoResultado(item.cardId, {
        respostas: item.answers,
        acertos: item.correct,
        erros: item.incorrect,
        brancos: item.blank,
        nota: item.grade,
      }, true);
      saveResult({
        id: uuidv4(),
        examId: activeExam.id,
        studentName: item.studentName || '',
        answers: item.answers ?? {},
        correctCount: item.correct ?? 0,
        incorrectCount: item.incorrect ?? 0,
        blankCount: item.blank ?? 0,
        duplicateCount: item.dupQuestions?.length ?? 0,
        duplicateQuestions: item.dupQuestions,
        duplicateMarks: item.dupMarks,
        lowConfidence: item.lowConfidence ?? [],
        qrOk: true,
        grade: item.grade ?? 0,
        timestamp: new Date().toISOString(),
        manualOverrides: {},
      }, userId);
      patchItem(item.fileName, { status: 'saved', detail: undefined });
    } catch (err) {
      patchItem(item.fileName, {
        status: 'error',
        detail: err instanceof Error ? err.message : 'Falha ao sobrescrever',
      });
    }
  };

  // Envia uma foto problemática para a revisão individual (dados já lidos)
  // ou, quando a leitura falhou, para preenchimento manual das respostas.
  const reviewManually = (item: BatchItem, manual = false) => {
    const hasAnswers = !!item.answers && Object.keys(item.answers).length > 0;
    setMode('individual');
    setCapturedImage(item.dataUrl);
    setOmrResult({
      success: true,
      answers: hasAnswers ? item.answers : {},
      blankQuestions: [],
      duplicateQuestions: item.dupQuestions,
      duplicateMarks: item.dupMarks,
      lowConfidence: item.lowConfidence ?? [],
      cardId: item.cardId,
    });
    setManualAnswers({ ...(item.answers ?? {}) });
    setManualEntry(manual || !hasAnswers);
    setIdentified(manual || !item.cardId ? null : { kind: 'unknown', cardId: item.cardId });
    setStudentName('');
    setCandidates(null);
    setManualInfo(null);
    setError(null);
    setStep('review');
  };

  const getGradeLabel = (gradeScale: string) => {
    if (gradeScale === 'count') return 'acertos';
    return `nota (${gradeScale})`;
  };

  return (
    <div className="animate-fade-in">
      {/* Visor imersivo: sem título/subtítulo no passo da câmera */}
      {step !== 'capture' && (
        <PageHeader
          title="Corrigir cartão-resposta"
          subtitle="Capture ou envie a foto do cartão preenchido pelo aluno"
        />
      )}

      {step === 'form' && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {(['individual', 'lote'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={batchRunning}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === m
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/15 text-brand-800 dark:text-brand-200'
                  : 'border-line dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-surface dark:bg-gray-800/60'
              }`}
            >
              {m === 'individual' ? 'Individual' : 'Em lote (várias fotos)'}
            </button>
          ))}
          <button
            onClick={handleAdaptiveToggle}
            disabled={batchRunning}
            aria-pressed={adaptive}
            title="Calcula o divisor marcado/vazio a partir da própria foto (experimental)"
            className={`ml-auto px-4 py-2 rounded-lg text-sm font-medium border transition-colors min-h-[44px] ${
              adaptive
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-200'
                : 'border-line dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-surface dark:hover:bg-gray-800'
            }`}
          >
            Limiar adaptativo
          </button>
          <button
            onClick={handleDebugToggle}
            disabled={batchRunning}
            aria-pressed={debugMode}
            title="Retorna o heatmap de scores por bolha (diagnóstico)"
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors min-h-[44px] ${
              debugMode
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-200'
                : 'border-line dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-surface dark:hover:bg-gray-800'
            }`}
          >
            Diagnóstico
          </button>
        </div>
      )}

      {mode === 'lote' && step === 'form' && (
        <BatchPanel
          exams={exams}
          selectedExamId={selectedExamId}
          onExamChange={setSelectedExamId}
          items={batchItems}
          running={batchRunning}
          error={error}
          onFiles={handleBatchFiles}
          onStart={runBatch}
          onResolveConflict={resolveConflict}
          onReviewManually={reviewManually}
          onClear={() => setBatchItems([])}
          fileInputRef={batchInputRef}
        />
      )}

      {mode === 'individual' && step === 'form' && (
        <div className="card max-w-2xl space-y-4">
          <div>
              <div className="flex items-center justify-between gap-2">
                <span className="label">Selecione a prova *</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => refreshExamsFromServer(false)}
                  loading={syncing}
                  icon={<RefreshCw size={14} aria-hidden />}
                >
                  Atualizar do servidor
                </Button>
              </div>
              {syncMsg && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{syncMsg}</p>
              )}
              {exams.length === 0 ? (
                <EmptyState
                  title="Nenhuma prova cadastrada neste aparelho"
                  description="No celular, recarregue a página logado com o mesmo usuário do PC — as provas vêm do servidor."
                  action={<><Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Recarregar</Button>{' '}<Button size="sm" onClick={() => onNavigate('new-exam')}>Criar prova</Button></>}
                />
              ) : (
              <Select
                aria-label="Selecione a prova"
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.answerKey ? ' (Gabarito OK)' : ' (Sem gabarito!)'}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {activeExam && (
            <div className="p-3 bg-brand-50 dark:bg-brand-700/15 border border-brand-500/30 dark:border-brand-700 rounded-lg text-brand-800 dark:text-brand-200 text-sm">
              <strong>Identificação automática:</strong> o aluno será reconhecido pelo QR Code impresso no cartão
              (lista da prova, gerada nos cartões por lista de alunos ou vinda de uma turma). Não é preciso digitar o nome.
              Cartões sem QR cadastrado pedirão o nome na conferência.
            </div>
          )}

          {activeExam && !activeExam.answerKey && (
            <div className="p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg text-warning-600 dark:text-warning-100 text-sm">
              Esta prova ainda não possui gabarito.
              <button onClick={() => onNavigate('register-key', activeExam.id)} className="underline ml-1 font-medium">
                Cadastrar gabarito
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-danger-50 dark:bg-danger-700/15 border border-danger-500/30 rounded-lg text-danger-600 dark:text-danger-100 text-sm">{error}</div>
          )}

          {error && isCustom && retryUrl && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setCornerEdit({ src: retryUrl, fromCamera: false })}
              icon={<Focus size={16} aria-hidden />}
            >
              Ajustar cantos manualmente e tentar de novo
            </Button>
          )}

          {error && activeExam && (
            <div className="p-3 bg-surface dark:bg-gray-800/60 border border-line dark:border-gray-700 rounded-lg space-y-2">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                O cartão não foi lido automaticamente? Você pode digitar as respostas
                do aluno questão por questão.
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={startManualEntry}
                disabled={!activeExam.answerKey}
                icon={<PenLine size={16} aria-hidden />}
              >
                Inserir respostas manualmente
              </Button>
              {!activeExam.answerKey && (
                <p className="text-xs text-warning-600 dark:text-warning-100">
                  Cadastre o gabarito da prova para habilitar o preenchimento manual.
                </p>
              )}
            </div>
          )}

          {pendingNotice && (
            <p className="callout-info text-sm" role="status">{pendingNotice}</p>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={continuous}
            onClick={() => setContinuous(c => !c)}
            className="inline-flex items-center gap-3 min-h-[48px] cursor-pointer"
          >
            <span className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${continuous ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${continuous ? 'translate-x-6' : 'translate-x-1'}`} />
            </span>
            <span className="text-sm text-gray-700 dark:text-gray-300 text-left">Correção contínua <span className="text-gray-400 dark:text-gray-500">(vários cartões em sequência)</span></span>
          </button>
          {sessionCount > 0 && (
            <p className="text-xs text-success-600 dark:text-success-100 bg-success-50 dark:bg-success-700/15 border border-success-500/30 rounded-lg px-2 py-1">
              {sessionCount} cartão(ões) corrigido(s) nesta sessão
            </p>
          )}

          {isCustom && (customGeom?.nPages ?? 1) > 1 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">Página do cartão:</span>
                {Array.from({ length: customGeom?.nPages ?? 1 }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCustomPage(i)}
                    className={`btn btn-sm min-h-[40px] px-3 ${i === customPage ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {i + 1}{readPages.has(i) ? ' ✓' : ''}
                  </button>
                ))}
              </div>
              {readPages.size > 0 && readPages.size < (customGeom?.nPages ?? 1) && (
                <p className="text-xs text-brand-600 dark:text-brand-200">
                  {readPages.size} de {customGeom?.nPages ?? 1} página(s) lida(s) — leia as demais para completar o cartão.
                </p>
              )}
            </div>
          )}

          {pendingReads.length > 0 && (
            <div className="card space-y-2 border border-amber-400/40">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CloudOff size={16} className="text-amber-600 dark:text-amber-300 shrink-0" aria-hidden />
                  <h3 className="text-sm font-semibold text-ink dark:text-white truncate">
                    Leituras pendentes ({pendingReads.length})
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void reprocessAllPending()}
                  loading={reprocessing}
                  disabled={!activeExam || !pendingReads.some((p) => p.examId === activeExam.id)}
                >
                  Reprocessar todas
                </Button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Capturas que não chegaram ao servidor. Ficam guardadas neste aparelho até serem reprocessadas.
              </p>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 min-h-[32px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={pendingReads.every((p) => selectedPendingIds.has(p.id))}
                  onChange={toggleSelectAllPending}
                  className="w-4 h-4 accent-brand-500"
                  aria-label="Selecionar todas as leituras pendentes"
                />
                Selecionar todos
                {selectedPendingIds.size > 0 && (
                  <span className="text-gray-400 dark:text-gray-500">({selectedPendingIds.size} selecionada(s))</span>
                )}
              </label>
              <ul className="space-y-2">
                {pendingReads.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-lg bg-surface dark:bg-gray-800/60 p-2">
                    <input
                      type="checkbox"
                      checked={selectedPendingIds.has(p.id)}
                      onChange={() => togglePendingSelection(p.id)}
                      className="w-4 h-4 shrink-0 accent-brand-500"
                      aria-label={`Selecionar leitura pendente de ${p.examName ?? p.examId}${p.page != null ? `, página ${p.page + 1}` : ''}`}
                    />
                    <img
                      src={p.dataUrl}
                      alt=""
                      loading="lazy"
                      className="h-12 w-12 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink dark:text-gray-100 truncate">
                        {p.examName ?? 'Prova'} · {p.page != null ? `página ${p.page + 1}` : 'captura'}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {new Date(p.createdAt).toLocaleString()} · {p.error}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void reprocessPending(p)}
                      disabled={reprocessing || !activeExam || p.examId !== activeExam.id}
                      aria-label="Reprocessar leitura pendente"
                      title="Reprocessar"
                      className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
                    >
                      <RefreshCw size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => discardPending(p.id)}
                      aria-label="Descartar leitura pendente"
                      title="Descartar"
                      className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {selectedPendingIds.size > 0 && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void reprocessSelectedPending()}
                    loading={reprocessing}
                    disabled={!activeExam || !pendingReads.some((p) => selectedPendingIds.has(p.id) && p.examId === activeExam.id)}
                    className="flex-1"
                  >
                    Reprocessar selecionados
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={discardSelectedPending}
                    disabled={reprocessing}
                    className="flex-1"
                  >
                    Descartar selecionados
                  </Button>
                </div>
              )}
              {activeExam && pendingReads.some((p) => p.examId !== activeExam.id) && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Itens de outra prova só podem ser reprocessados com essa prova aberta.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn btn-secondary btn-sm w-full justify-start"
          >
            Configurações de detecção (globais)
          </button>
          {isCustom && (customGeom?.nPages ?? 1) > 1 && (
            <button
              type="button"
              onClick={() => {
                const n = customGeom?.nPages ?? 1;
                setBatchFiles(Array.from({ length: n }, () => []));
                setBatchResults([]);
                setBatchOpen(true);
              }}
              className="btn btn-secondary btn-sm w-full justify-start"
            >
              Lote multi-página (page order)
            </button>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => startCamera()}
              disabled={!selectedExamId}
              icon={<Camera size={16} aria-hidden />}
              className="flex-1"
            >
              Capturar com câmera
            </Button>
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedExamId}
              icon={<ImageUp size={16} aria-hidden />}
              className="flex-1"
            >
              {window.isSecureContext ? 'Enviar imagem' : 'Câmera do sistema'}
            </Button>
          </div>
          {!window.isSecureContext && (
            <p className="text-xs text-brand-600 dark:text-brand-200 bg-brand-50 dark:bg-brand-700/15 border border-brand-500/30 dark:border-brand-700 rounded-lg p-2">
              Acesso via IP — ao clicar em “Capturar com Câmera” ou “Enviar Imagem” o sistema abre a câmera ou a galeria do celular.
            </p>
          )}
        </div>
      )}

      {/* input da galeria fora do form: a barra de captura também usa (modo capture) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {step === 'capture' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Captura do cartão-resposta"
          className="fixed inset-0 z-[80] flex flex-col bg-[#04192E] text-white"
        >
          {/* header: seta + título (como na referência) */}
          <div className="flex shrink-0 items-center gap-2 px-2 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={goBackFromCapture}
              aria-label="Voltar"
              title="Voltar"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
            >
              <ArrowLeft size={22} aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-widest text-sky-200/70 leading-none">correção OMR</p>
              <h2 className="mt-0.5 truncate text-lg font-semibold leading-tight">
                {isCustom && (customGeom?.nPages ?? 1) > 1
                  ? `Página ${customPage + 1} de ${customGeom?.nPages ?? 1}`
                  : 'Nova leitura'}
              </h2>
            </div>
            {sessionCount > 0 && (
              <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-200">
                {sessionCount} corrigido(s)
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowAdjust(a => !a)}
              aria-pressed={showAdjust}
              aria-expanded={showAdjust}
              aria-label="Ajustes da câmera"
              title="Ajustes da câmera"
              className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors ${showAdjust ? 'bg-[#0B6BFB] text-white' : 'text-white/90 hover:bg-white/10'}`}
            >
              <SlidersHorizontal size={18} aria-hidden />
            </button>
          </div>
          {/* barra de instrução (como na referência) */}
          <div className="mx-3 mb-2 flex shrink-0 items-start gap-2 rounded-xl bg-[#182F4A]/90 px-3 py-2">
            <Info size={15} className="mt-0.5 shrink-0 text-sky-200" aria-hidden />
            <p className="text-[13px] leading-snug text-white">
              {confirmUrl
                ? 'Prévia travada — confira e envie para correção.'
                : autoMode
                  ? (isCustom && (customGeom?.nPages ?? 1) > 1
                    ? `Enquadre a página ${customPage + 1} do cartão-resposta na moldura. Mantenha o cartão bem iluminado e plano.`
                    : 'Enquadre o cartão-resposta na moldura. Mantenha o cartão bem iluminado e plano.')
                  : 'Enquadre o cartão-resposta e toque no obturador para capturar.'}
            </p>
          </div>

          {/* visor full-bleed: preenche o espaço entre a instrução e a barra */}
          <div
            ref={viewRef}
            onClick={handleViewTap}
            className="relative min-h-0 w-full flex-1 overflow-hidden bg-black"
          >
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full" style={{ objectFit: 'cover' }} />
            {/* chip do modelo da prova */}
            {autoMode && !confirmUrl && (
              <span className="absolute top-2 left-2 z-10 text-[11px] font-semibold text-white bg-black/55 rounded-full px-2.5 py-1 pointer-events-none">
                {examModelLabel}
              </span>
            )}
            {/* ajustes ficam no header (ícone) e no sheet; visor limpo como na referência */}
            {/* grade regra-dos-terços (composição) */}
            {showThirds && autoMode && !confirmUrl && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
                {[100 / 3, 200 / 3].map(v => (
                  <g key={v} stroke="rgba(255,255,255,0.45)" strokeWidth="0.4">
                    <line x1={v} y1="0" x2={v} y2="100" />
                    <line x1="0" y1={v} x2="100" y2={v} />
                  </g>
                ))}
              </svg>
            )}
            {/* guia A4 calculado para o visor + alvos das âncoras do modelo (0..100) */}
            {autoMode && !confirmUrl && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                {/* scrim: escurece fora do guia para dar contraste em mesa clara */}
                <path
                  d={`M0,0 H100 V100 H0 Z M${guide.x},${guide.y} H${guide.x + guide.w} V${guide.y + guide.h} H${guide.x} Z`}
                  fill="rgba(0,0,0,0.5)"
                  fillRule="evenodd"
                />
                {/* moldura do guia — verde ao travar */}
                <rect
                  x={guide.x} y={guide.y} width={guide.w} height={guide.h} fill="none" rx="1"
                  stroke={frameAnalysis?.locked ? '#22c55e' : 'rgba(255,255,255,0.9)'}
                  strokeWidth="0.8"
                />
                {/* cantoneiras grossas do guia */}
                {(['TL', 'TR', 'BR', 'BL'] as const).map(k => {
                  const gx = k === 'TL' || k === 'BL' ? guide.x : guide.x + guide.w;
                  const gy = k === 'TL' || k === 'TR' ? guide.y : guide.y + guide.h;
                  const sx = k === 'TL' || k === 'BL' ? 1 : -1;
                  const sy = k === 'TL' || k === 'TR' ? 1 : -1;
                  const L = 9;
                  const c = frameAnalysis?.locked ? '#22c55e' : '#ffffff';
                  return (
                    <g key={k} stroke={c} strokeWidth="1.8" strokeLinecap="round">
                      <line x1={gx} y1={gy} x2={gx + sx * L} y2={gy} />
                      <line x1={gx} y1={gy} x2={gx} y2={gy + sy * L} />
                    </g>
                  );
                })}
                {/* 🎯 alvos: onde as 4 âncoras do modelo devem cair */}
                {(['TL', 'TR', 'BR', 'BL'] as const).map(k => {
                  const p = anchorTargets[k];
                  const c = frameAnalysis?.locked ? '#22c55e' : '#fbbf24';
                  return (
                    <g key={`t-${k}`} stroke={c} strokeWidth="0.9" fill="none" opacity="0.95">
                      <circle cx={p.x} cy={p.y} r="2.4" />
                      <circle cx={p.x} cy={p.y} r="0.4" fill={c} stroke="none" />
                    </g>
                  );
                })}
                {/* cantoneiras detectadas nos cantos reais do cartão */}
                {(['TL', 'TR', 'BR', 'BL'] as const).map(k => {
                  const p = frameAnalysis?.corners[k];
                  if (!p) return null;
                  const ok = frameAnalysis?.locked;
                  const x = p.x * 100, y = p.y * 100;
                  const c = ok ? '#22c55e' : '#fbbf24';
                  const L = 6;
                  const sx = k === 'TL' || k === 'BL' ? 1 : -1;
                  const sy = k === 'TL' || k === 'TR' ? 1 : -1;
                  return (
                    <g key={k} stroke={c} strokeWidth="1.2" strokeLinecap="round">
                      <line x1={x} y1={y} x2={x + sx * L} y2={y} />
                      <line x1={x} y1={y} x2={x} y2={y + sy * L} />
                    </g>
                  );
                })}
              </svg>
            )}
            {/* prévia congelada aguardando confirmação */}
            {confirmUrl && (
              <img src={confirmUrl} alt="Prévia travada" className="absolute inset-0 w-full h-full object-cover" />
            )}
            {/* flash do obturador ao travar */}
            {flashOn && (
              <div className="absolute inset-0 bg-white pointer-events-none" />
            )}
            {!autoMode && (
              <div className="absolute inset-4 border-2 border-dashed border-white/60 rounded-lg pointer-events-none" />
            )}
            {/* dica de enquadramento difícil: chip sobre o visor */}
            {autoMode && !confirmUrl && searchSecs >= 8 && !frameAnalysis?.locked && (
              <p className="absolute inset-x-3 bottom-12 z-10 rounded-lg border border-amber-300/40 bg-black/60 px-2 py-1.5 text-center text-[11px] text-amber-100 pointer-events-none">
                Enquadramento difícil? Toque no <strong>obturador</strong> para forçar a captura.
              </p>
            )}
            {/* status da captura automática: overlay fino no rodapé do visor */}
            {autoMode && !confirmUrl && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-2">
                <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
                  <span className={frameAnalysis?.locked ? 'font-medium text-emerald-300' : 'text-white/90'}>
                    {sharpRetry ?? (frameAnalysis ? frameAnalysis.hint : 'Apontando a câmera...')}
                  </span>
                  <span className="shrink-0 tabular-nums text-white/70">{frameAnalysis ? `${frameAnalysis.found}/4 cantos` : ''}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                  <div className="h-1.5 rounded-full bg-emerald-400 transition-all duration-150" style={{ width: `${Math.round(lockProgress * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
          {/* sheet Ajustes: bottom-sheet no celular, painel lateral no desktop (tema escuro) */}
          {showAdjust && !confirmUrl && (
            <>
              <div className="absolute inset-0 z-20 bg-black/50" onClick={() => setShowAdjust(false)} aria-hidden />
              <div className="absolute inset-x-0 bottom-0 z-30 max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-[#0A2540] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:inset-y-0 lg:bottom-0 lg:left-auto lg:right-0 lg:top-0 lg:max-h-none lg:w-80 lg:rounded-none lg:rounded-l-2xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">Ajustes da câmera</span>
                  <button
                    type="button"
                    onClick={() => setShowAdjust(false)}
                    aria-label="Fechar ajustes"
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-widest text-sky-200/60">Captura</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoMode}
                      onClick={() => { setAutoMode(a => !a); setConfirmUrl(null); setSharpRetry(null); }}
                      className="flex min-h-[48px] cursor-pointer items-center gap-3"
                    >
                      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${autoMode ? 'bg-[#0B6BFB]' : 'bg-white/20'}`}>
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${autoMode ? 'translate-x-6' : 'translate-x-1'}`} />
                      </span>
                      <span className="text-left text-xs text-white/90">Captura automática por enquadramento</span>
                    </button>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-widest text-sky-200/60">Composição</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showThirds}
                      onClick={() => setShowThirds(t => !t)}
                      className="flex min-h-[48px] cursor-pointer items-center gap-3"
                    >
                      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${showThirds ? 'bg-[#0B6BFB]' : 'bg-white/20'}`}>
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${showThirds ? 'translate-x-6' : 'translate-x-1'}`} />
                      </span>
                      <span className="text-left text-xs text-white/90">Grade de terços</span>
                    </button>
                  </div>
                  {zoomSupported && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium uppercase tracking-widest text-sky-200/60">Zoom</span>
                      <div className="flex items-center gap-2">
                        <ZoomIn size={15} className="shrink-0 text-sky-200/70" aria-hidden />
                        <input
                          type="range"
                          min={1}
                          max={maxZoom}
                          step={0.1}
                          value={zoom}
                          onChange={(e) => setZoomLevel(Number(e.target.value))}
                          className="flex-1 accent-[#0B6BFB]"
                          aria-label="Zoom da câmera"
                        />
                        <span className="w-9 text-right text-xs tabular-nums text-white/70">{zoom.toFixed(1)}x</span>
                      </div>
                    </div>
                  )}
                  {exposureSupported && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium uppercase tracking-widest text-sky-200/60">Exposição (brilho do sensor)</span>
                      <div className="flex items-center gap-2">
                        <Sun size={15} className="shrink-0 text-sky-200/70" aria-hidden />
                        <input
                          type="range"
                          min={exposureMin}
                          max={exposureMax}
                          step={exposureStep}
                          value={exposure}
                          onChange={(e) => void setExposureLevel(Number(e.target.value))}
                          className="flex-1 accent-[#0B6BFB]"
                          aria-label="Exposição da câmera"
                        />
                        <span className="w-10 text-right text-xs tabular-nums text-white/70">{exposure.toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                  {(focusSupported || focusPointSupported) && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium uppercase tracking-widest text-sky-200/60">Foco</span>
                      {focusSupported && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={focusAuto}
                          onClick={() => void toggleFocusAuto()}
                          className="flex min-h-[48px] cursor-pointer items-center gap-3"
                        >
                          <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${focusAuto ? 'bg-[#0B6BFB]' : 'bg-white/20'}`}>
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${focusAuto ? 'translate-x-6' : 'translate-x-1'}`} />
                          </span>
                          <span className="text-left text-xs text-white/90">Foco automático {focusAuto ? '' : '(toque no visor para focar)'}</span>
                        </button>
                      )}
                      {focusPointSupported && (
                        <p className="flex items-center gap-1 text-[11px] text-white/60">
                          <Focus size={12} aria-hidden /> Toque num ponto do visor para focar ali.
                        </p>
                      )}
                    </div>
                  )}
                  {!exposureSupported && !focusSupported && !zoomSupported && (
                    <p className="text-[11px] text-white/60">
                      Neste aparelho o sistema controla brilho, foco e zoom sozinho — aqui aparecem só captura e composição.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* status, cantos e zoom vivem como overlay no visor e no sheet de Ajustes */}

          <canvas ref={canvasRef} className="hidden" />

          {confirmUrl ? (
            <div className="flex shrink-0 flex-col gap-2 bg-[#051C34] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {isCustom && (
                <button
                  type="button"
                  onClick={() => confirmUrl && setCornerEdit({ src: confirmUrl, fromCamera: true })}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20"
                >
                  <Focus size={16} aria-hidden />
                  Ajustar cantos manualmente
                </button>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={confirmAutoCapture}
                  className="min-h-[52px] flex-1 rounded-xl bg-[#0B6BFB] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0959d6]"
                >
                  Enviar para correção
                </button>
                <button
                  type="button"
                  onClick={retryAutoCapture}
                  className="min-h-[52px] rounded-xl bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20"
                >
                  Repetir
                </button>
              </div>
            </div>
          ) : (
            <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-start bg-[#051C34] px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {/* Galeria (como na referência) */}
              <div className="flex flex-col items-center gap-1 justify-self-start">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Galeria / enviar imagem"
                  aria-label="Abrir galeria"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                >
                  <ImagePlus size={20} aria-hidden />
                </button>
                <span className="text-[11px] text-white/80">Galeria</span>
              </div>
              {/* obturador: disco branco + anel azul (como na referência) */}
              <button
                type="button"
                onClick={captureFrame}
                aria-label={autoMode ? 'Capturar agora' : 'Capturar'}
                title={autoMode ? 'Capturar agora' : 'Capturar'}
                className={`flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-white p-1.5 shadow-lg ring-4 transition-transform active:scale-95 ${
                  autoMode && searchSecs >= 8 && !frameAnalysis?.locked
                    ? 'animate-pulse ring-amber-400'
                    : 'ring-[#0B6BFB]'
                }`}
              >
                <span className="block h-full w-full rounded-full bg-[#0B6BFB]/90" aria-hidden />
              </button>
              {/* controle direito: lanterna; senão, trocar câmera (como na referência) */}
              <div className="flex flex-col items-center gap-1 justify-self-end">
                {autoMode && torchSupported ? (
                  <>
                    <button
                      type="button"
                      onClick={toggleTorch}
                      aria-pressed={torchOn}
                      title="Lanterna"
                      aria-label={torchOn ? 'Apagar lanterna' : 'Acender lanterna'}
                      className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${torchOn ? 'bg-amber-400 text-[#04192E]' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                      {torchOn ? <Flashlight size={20} aria-hidden /> : <FlashlightOff size={20} aria-hidden />}
                    </button>
                    <span className="text-[11px] text-white/80">{torchOn ? 'Ligada' : 'Luz'}</span>
                  </>
                ) : videoDevices.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={switchCamera}
                      title="Trocar câmera (frontal/traseira)"
                      aria-label="Trocar câmera"
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                    >
                      <SwitchCamera size={20} aria-hidden />
                    </button>
                    <span className="text-[11px] text-white/80">Virar</span>
                  </>
                ) : (
                  <span className="h-12 w-12" aria-hidden />
                )}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}

      {cornerEdit && createPortal(
        <CornerEditor
          src={cornerEdit.src}
          onCancel={() => setCornerEdit(null)}
          onConfirm={confirmManualCorners}
        />,
        document.body,
      )}

      {settingsOpen && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-4 space-y-3">
            <h3 className="font-bold text-lg">Configurações de detecção (globais)</h3>
            <p className="text-xs text-gray-500">Valores vazios usam o padrão do modelo.</p>
            {[
              { key: 'floor', label: 'Piso (floor)', step: 0.01 },
              { key: 'margin', label: 'Margem (margin)', step: 0.01 },
              { key: 'low_conf_threshold', label: 'Limiar baixa confiança', step: 0.01 },
              { key: 'clahe_clip', label: 'CLAHE clip', step: 0.1 },
            ].map(({ key, label, step }) => (
              <div key={key} className="flex items-center gap-2">
                <label className="text-sm flex-1">{label}</label>
                <input
                  type="number"
                  step={step}
                  className="border rounded px-2 py-1 w-24 text-sm"
                  value={String(globalSettings[key] ?? '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGlobalSettings((s) => {
                      const next = { ...s };
                      if (v === '') delete next[key];
                      else next[key] = Number(v);
                      return next;
                    });
                  }}
                />
              </div>
            ))}
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSettingsOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  localStorage.setItem('omr_global_settings', JSON.stringify(globalSettings));
                  setSettingsOpen(false);
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {batchOpen && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold text-lg">Lote multi-página (page order)</h3>
            <p className="text-xs text-gray-500">
              Envie, para cada página, a lista de fotos na mesma ordem. As respostas são casadas por posição.
            </p>
            {Array.from({ length: customGeom?.nPages ?? 1 }, (_, p) => (
              <div key={p} className="space-y-1">
                <label className="text-sm font-medium">Página {p + 1}</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setBatchFiles((prev) => {
                      const next = [...prev];
                      next[p] = files;
                      return next;
                    });
                  }}
                  className="block w-full text-sm"
                />
                <span className="text-xs text-gray-500">{(batchFiles[p]?.length ?? 0)} arquivo(s)</span>
              </div>
            ))}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBatchOpen(false)} disabled={batchBusy}>
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={batchBusy || batchFiles.some((f) => !f.length)}
                onClick={async () => {
                  setBatchBusy(true);
                  setBatchResults([]);
                  const nPages = customGeom?.nPages ?? 1;
                  const minLen = Math.min(...batchFiles.map((f) => f.length));
                  const out: { idx: number; answers: Record<string, string>; error?: string }[] = [];
                  for (let i = 0; i < minLen; i++) {
                    const merged: Record<string, string> = {};
                    let err: string | undefined;
                    for (let pg = 0; pg < nPages; pg++) {
                      try {
                        const file = batchFiles[pg][i];
                        const res = await apiProcessImage(
                          file,
                          activeExam?.questionsPerSubject ?? 22,
                          activeExam?.layoutMode ?? 'dual',
                          'custom',
                          useAdaptive,
                          debugMode,
                          activeExam?.customTemplateId,
                          null,
                          pg,
                          globalSettings,
                        );
                        if (res.success && res.answers) {
                          Object.assign(merged, res.answers);
                        } else {
                          err = res.error || 'Falha na leitura';
                        }
                      } catch (e) {
                        err = e instanceof Error ? e.message : 'Erro';
                      }
                    }
                    out.push({ idx: i + 1, answers: merged, error: err });
                  }
                  setBatchResults(out);
                  setBatchBusy(false);
                }}
              >
                {batchBusy ? 'Processando...' : 'Processar lote'}
              </button>
            </div>
            {batchFiles.some((f, i) => i > 0 && f.length !== batchFiles[0].length) && (
              <p className="text-xs text-amber-600">
                Atenção: as páginas têm quantidades diferentes de arquivos. Serão processados os primeiros {Math.min(...batchFiles.map((f) => f.length))} de cada.
              </p>
            )}
            {batchResults.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Resultados ({batchResults.length})</h4>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="border px-2 py-1 text-left">#</th>
                        <th className="border px-2 py-1 text-left">Respostas</th>
                        <th className="border px-2 py-1 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchResults.map((r) => (
                        <tr key={r.idx}>
                          <td className="border px-2 py-1">{r.idx}</td>
                          <td className="border px-2 py-1 font-mono">{Object.entries(r.answers).map(([q, a]) => `${q}:${a}`).join(' ') || '—'}</td>
                          <td className="border px-2 py-1">{r.error ? <span className="text-red-600">{r.error}</span> : 'OK'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {step === 'processing' && (
        <div className="card max-w-2xl">
          <h3 className="text-lg font-semibold text-ink dark:text-white mb-4 text-center">Processando leitura</h3>
          <ReadStages doneCount={stageDone} anchorLabel={anchorLabelFor(activeExam)} />
        </div>
      )}

      {step === 'review' && omrResult && activeExam && (
        <div className="space-y-4 max-w-4xl">
          {error && (
            <div className="p-3 bg-danger-50 dark:bg-danger-700/15 border border-danger-500/30 rounded-lg text-danger-600 dark:text-danger-100 text-sm">
              {error}
            </div>
          )}
          {(() => {
            const dupList = omrResult.duplicateQuestions ?? [];
            const lowList = omrResult.lowConfidence ?? [];
            const score = countResults(activeExam, manualAnswers, dupList);
            const grade = calculateGrade(score.correct, activeExam.totalQuestions, activeExam.gradeScale);
            const answeredCount = Object.keys(manualAnswers).length;
            // Multi-página: o resultado exibido é só da última página lida; as
            // respostas e o progresso vêm do acumulado (manualAnswers).
            const isMultiPage = isCustom && (customGeom?.nPages ?? 1) > 1;
            const readCount = isMultiPage
              ? answeredCount + dupList.length
              : Object.keys(omrResult.answers ?? {}).length
                + (omrResult.blankQuestions?.length ?? 0) + dupList.length;
            const firm = Math.max(0, activeExam.totalQuestions - lowList.length - dupList.length);
            const progressCount = manualEntry || isMultiPage ? answeredCount : firm;
            const alunoNome = identified?.kind === 'ok' || identified?.kind === 'wrong_exam'
              ? identified.name : (studentName.trim() || '(sem identificação)');
            const cartao = omrResult.cardId ?? identified?.cardId ?? '—';
            return (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0 ${manualEntry ? 'bg-brand-500' : 'bg-success-500'}`} aria-hidden>
                    {manualEntry ? <PenLine size={18} strokeWidth={2.2} /> : <CheckCircle2 size={18} strokeWidth={2.2} />}
                  </span>
                  <h3 className="text-lg font-bold text-ink dark:text-white">
                    {manualEntry ? 'Preenchimento manual' : 'Leitura concluída!'}
                  </h3>
                 </div>
                 {manualEntry && (
                   <div className="mb-3 p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg text-warning-600 dark:text-warning-100 text-sm">
                     A leitura automática não detectou as respostas do cartão. Preencha o gabarito do aluno
                     na grade abaixo, questão por questão.
                   </div>
                 )}
                 {isCustom && (customGeom?.nPages ?? 1) > 1
                   && readPages.size < (customGeom?.nPages ?? 1) && (
                   <div className="p-3 bg-amber-50 dark:bg-amber-700/15 border border-amber-400/40 rounded-lg text-amber-800 dark:text-amber-100 text-sm">
                     {manualEntry ? (
                       <>
                         Este cartão tem {customGeom?.nPages ?? 1} páginas. Preencha abaixo as respostas
                         de todas as páginas antes de salvar.
                       </>
                     ) : (
                       <>
                         Atenção: este cartão tem {customGeom?.nPages ?? 1} páginas e apenas {readPages.size} foi/foram lida(s).
                         Faltam as páginas {missingCustomPages.map((i) => i + 1).join(', ')}.
                         As respostas já lidas estão preservadas — leia as demais antes de salvar.
                       </>
                     )}
                   </div>
                 )}
                <dl className="text-sm space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500 dark:text-gray-400">Aluno(a)</dt>
                    <dd className="font-medium text-ink dark:text-gray-100 text-right">{alunoNome}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500 dark:text-gray-400">Cartão</dt>
                    <dd className="font-medium text-ink dark:text-gray-100 text-right font-mono">{cartao}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500 dark:text-gray-400">{manualEntry ? 'Respostas preenchidas' : isMultiPage ? 'Respostas lidas' : 'Questões lidas'}</dt>
                    <dd className="font-medium text-ink dark:text-gray-100 text-right tabular-nums">
                      {manualEntry ? answeredCount : readCount} / {activeExam.totalQuestions}
                    </dd>
                  </div>
                </dl>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
                  <div className="rounded-lg bg-surface dark:bg-gray-800/60 p-2.5">
                    <p className="text-xl font-bold text-success-600 dark:text-success-100 tabular-nums">{score.correct}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Acertos</p>
                  </div>
                  <div className="rounded-lg bg-surface dark:bg-gray-800/60 p-2.5">
                    <p className="text-xl font-bold text-danger-600 dark:text-danger-100 tabular-nums">{score.incorrect}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Erros</p>
                  </div>
                  <div className="rounded-lg bg-surface dark:bg-gray-800/60 p-2.5">
                    <p className="text-xl font-bold text-gray-500 dark:text-gray-300 tabular-nums">{score.blank}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Em branco</p>
                  </div>
                  <div className="rounded-lg bg-brand-50 dark:bg-brand-700/20 p-2.5">
                    <p className="text-xl font-bold text-brand-700 dark:text-brand-200 tabular-nums">{grade}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Nota final</p>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span>
                      {manualEntry
                        ? `${answeredCount} de ${activeExam.totalQuestions} respostas preenchidas`
                        : isMultiPage
                          ? `${answeredCount} de ${activeExam.totalQuestions} respostas · ${readPages.size}/${customGeom?.nPages ?? 1} páginas`
                          : `Leitura firme em ${firm} de ${activeExam.totalQuestions} questões`}
                    </span>
                    <span className="tabular-nums">{Math.round((progressCount / Math.max(1, activeExam.totalQuestions)) * 100)}%</span>
                  </div>
                  <div className="w-full bg-line dark:bg-gray-700 rounded-full h-2 overflow-hidden" aria-hidden>
                    <div
                      className={`${manualEntry ? 'bg-brand-500' : 'bg-success-500'} h-2 rounded-full transition-all duration-300`}
                      style={{ width: `${Math.round((progressCount / Math.max(1, activeExam.totalQuestions)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          {!manualEntry && nextMissingPage != null && (
            <div className="card border-2 border-brand-500/40">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-white bg-brand-500 shrink-0" aria-hidden>
                  <Camera size={18} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-ink dark:text-white">
                    {missingCustomPages.length === 1
                      ? `Falta ler a página ${nextMissingPage + 1}`
                      : `Faltam ${missingCustomPages.length} páginas`}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                    As {readPages.size} página(s) já lida(s) estão guardadas.
                    Leia a página {nextMissingPage + 1} para completar este cartão.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  onClick={() => startPageCapture(nextMissingPage, 'camera')}
                  icon={<Camera size={16} aria-hidden />}
                  className="flex-1"
                >
                  Capturar página {nextMissingPage + 1}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => startPageCapture(nextMissingPage, 'file')}
                  icon={<ImageUp size={16} aria-hidden />}
                  className="flex-1"
                >
                  Enviar imagem
                </Button>
              </div>
              {missingCustomPages.length > 1 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Também faltam: {missingCustomPages.slice(1).map((i) => `página ${i + 1}`).join(', ')}.
                </p>
              )}
            </div>
          )}

          {!manualEntry && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-3">Andamento da leitura</h3>
              <ReadStages doneCount={7} anchorLabel={anchorLabelFor(activeExam)} />
            </div>
          )}

          {identified?.kind === 'ok' && (
            <div className="p-3 bg-success-50 dark:bg-success-700/15 border border-success-500/30 rounded-lg text-success-600 dark:text-success-100 text-sm">
              <strong>Aluno identificado pelo banco de dados:</strong> {identified.name}{' '}
              <span className="font-mono">({identified.cardId})</span>
              {identified.examTitle && <> — prova: {identified.examTitle}</>}
            </div>
          )}

          {identified?.kind === 'unknown' && (
            <div className="p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg text-warning-600 dark:text-warning-100 text-sm">
              QR Code identificado, porém o código{' '}
              <span className="font-mono">{identified.cardId}</span> não pertence a nenhum gabarito
              registrado. <strong>Identificação pendente</strong> — selecione o aluno manualmente abaixo.
            </div>
          )}

          {identified?.kind === 'wrong_exam' && (
            <div className="p-3 bg-danger-50 dark:bg-danger-700/15 border border-danger-500/30 rounded-lg text-danger-600 dark:text-danger-100 text-sm">
              <strong>ERRO — GABARITO DE OUTRA AVALIAÇÃO:</strong> o código{' '}
              <span className="font-mono">{identified.cardId}</span> pertence ao aluno{' '}
              {identified.name} na prova <strong>{identified.examTitle}</strong>. Selecione a prova
              correta para poder corrigir este cartão.
            </div>
          )}

          {capturedImage && (
            <div className="card">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {manualEntry ? 'Foto enviada (não lida automaticamente)' : 'Imagem Capturada'}
              </h3>
              <img src={capturedImage} alt={manualEntry ? 'Foto do cartão enviada' : 'Cartão capturado'} className="max-h-48 rounded-lg object-contain mx-auto" />
            </div>
          )}

          {/* Overlay gabarito na captura — verde=correto, vermelho=incorreto */}
          {capturedImage && activeExam?.answerKey && !overlayCustom && !manualEntry && (
            <div className="card">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Gabarito recortado</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Círculos verdes = acertos · vermelhos = erros · cinza = em branco · laranja = duplicada</p>
              <div style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', aspectRatio: cropBox ? `${cropBox.w}/${cropBox.h}` : `${CARD_WIDTH}/${CARD_HEIGHT}`, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                {/* fundo retificado do backend (alinhado 1:1 com template) — fallback para foto crua */}
                {cropBox ? (
                  <img src={omrResult?.rectifiedImage || capturedImage} alt="" style={{ position: 'absolute', left: `${-cropBox.x / cropBox.w * 100}%`, top: `${-cropBox.y / cropBox.h * 100}%`, width: `${CARD_WIDTH / cropBox.w * 100}%`, height: `${CARD_HEIGHT / cropBox.h * 100}%`, maxWidth: 'none', objectFit: 'fill', opacity: omrResult?.rectifiedImage ? 1 : 0.35 }} />
                ) : (
                  <img src={omrResult?.rectifiedImage || capturedImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: omrResult?.rectifiedImage ? 1 : 0.35 }} />
                )}
                {/* overlay SVG na geometria do template 1448x2048 (recortado p/ o gabarito) */}
                <svg viewBox={cropBox ? `${cropBox.x} ${cropBox.y} ${cropBox.w} ${cropBox.h}` : `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  {overlaySae ? (
                    <g>
                      {Array.from({ length: activeExam.totalQuestions }, (_, i) => {
                        const q = i + 1;
                        return (
                          <g key={q}>
                            {[0, 1, 2, 3].map((ci) => {
                              const letter = ['A', 'B', 'C', 'D'][ci];
                              const [x, y] = saeBubbleCenter(q, ci);
                              const key = activeExam.answerKey?.[q];
                              const isMarked = manualAnswers[q] === letter;
                              const isCorrect = key ? letter === key : false;
                              let stroke = '#333'; let fill = 'none'; let sw = 2;
                              if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                              else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                              else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                              return <circle key={`sae-${q}-${letter}`} cx={x} cy={y} r={SAE_BUBBLE_RADIUS} fill={fill} stroke={stroke} strokeWidth={sw} />;
                            })}
                          </g>
                        );
                      })}
                    </g>
                  ) : overlaySaev ? (
                    <g>
                      {Array.from({ length: Math.ceil(activeExam.questionsPerSubject / 2) }, (_, i) => {
                        const { y, side, cells } = overlaySaevRowFor(activeExam.questionsPerSubject, i + 1);
                        const h = side / 2;
                        return (
                          <g key={i + 1}>
                            {cells.map(({ q: qg, letter, x }) => {
                              const key = activeExam.answerKey?.[qg];
                              const isMarked = manualAnswers[qg] === letter;
                              const isCorrect = key ? letter === key : false;
                              let stroke = '#333'; let fill = 'none'; let sw = 2;
                              if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                              else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                              else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                              return <rect key={`saev-${qg}-${letter}`} x={x - h} y={y - h} width={side} height={side} fill={fill} stroke={stroke} strokeWidth={sw} />;
                            })}
                          </g>
                        );
                      })}
                    </g>
                  ) : overlayHerby ? (
                    <g>
                      {Array.from({ length: herbyRowsFor(activeExam.questionsPerSubject) }, (_, i) => {
                        const { y, side, cells } = overlayHerbyRowFor(activeExam.questionsPerSubject, i + 1, activeExam.layoutMode === 'single' ? 'single' : 'dual');
                        const h = side / 2;
                        return (
                          <g key={i + 1}>
                            {cells.map(({ q: qg, letter, x }) => {
                              const key = activeExam.answerKey?.[qg];
                              const isMarked = manualAnswers[qg] === letter;
                              const isCorrect = key ? letter === key : false;
                              let stroke = '#333'; let fill = 'none'; let sw = 2;
                              if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                              else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                              else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                              return <rect key={`herby-${qg}-${letter}`} x={x - h} y={y - h} width={side} height={side} fill={fill} stroke={stroke} strokeWidth={sw} />;
                            })}
                          </g>
                        );
                      })}
                    </g>
                  ) : overlaySimulado ? (
                    <g>
                      {Array.from({ length: SIMULADO_MAX_QUESTIONS }, (_, i) => {
                        const { y, r, cells } = overlaySimuladoRowFor(i + 1);
                        return (
                          <g key={i + 1}>
                            {cells.map(({ q: qg, letter, x }) => {
                              const key = activeExam.answerKey?.[qg];
                              const isMarked = manualAnswers[qg] === letter;
                              const isCorrect = key ? letter === key : false;
                              let stroke = '#333'; let fill = 'none'; let sw = 2;
                              if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                              else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                              else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                              return <circle key={`sim-${qg}-${letter}`} cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />;
                            })}
                          </g>
                        );
                      })}
                    </g>
                  ) : (
                  Array.from({ length: activeExam.questionsPerSubject }, (_, i) => {
                    // Geometria por layout (single usa colunas centrais) — overlay-bubbles.ts
                    const { y, r, cells } = overlayRowFor(activeExam, i + 1);
                    return (
                      <g key={i + 1}>
                        {cells.map(({ q: qg, letter, x }) => {
                          const key = activeExam.answerKey?.[qg];
                          const marked = manualAnswers[qg] === letter;
                          const isCorrect = key ? letter === key : false;
                          const isMarked = marked;
                          let stroke = '#333'; let fill = 'none'; let sw = 2;
                          if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                          else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                          else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                          return <circle key={`p-${qg}-${letter}`} cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />;
                        })}
                      </g>
                    );
                  })
                  )}
                  {/* marcações duplicadas em laranja */}
                  {(omrResult?.duplicateQuestions ?? []).map(q => {
                    if (overlaySaev) {
                      const marks = omrResult?.duplicateMarks?.[q] ?? [];
                      return marks.map(letter => {
                        const pos = overlaySaevBubbleFor(activeExam.questionsPerSubject, q, letter);
                        if (!pos) return null;
                        const h = pos.side / 2 + 4;
                        return <rect key={`dup-${q}-${letter}`} x={pos.x - h} y={pos.y - h} width={h * 2} height={h * 2} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 3" />;
                      });
                    }
                    if (overlayHerby) {
                      const marks = omrResult?.duplicateMarks?.[q] ?? [];
                      return marks.map(letter => {
                        const pos = overlayHerbyBubbleFor(activeExam.questionsPerSubject, q, letter, activeExam.layoutMode === 'single' ? 'single' : 'dual');
                        if (!pos) return null;
                        const h = pos.side / 2 + 4;
                        return <rect key={`dup-${q}-${letter}`} x={pos.x - h} y={pos.y - h} width={h * 2} height={h * 2} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 3" />;
                      });
                    }
                    if (overlaySimulado) {
                      const marks = omrResult?.duplicateMarks?.[q] ?? [];
                      return marks.map(letter => {
                        const pos = overlaySimuladoBubbleFor(q, letter);
                        if (!pos) return null;
                        return <circle key={`dup-${q}-${letter}`} cx={pos.x} cy={pos.y} r={pos.r + 4} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 3" />;
                      });
                    }
                    if (overlaySae) {
                      const marks = omrResult?.duplicateMarks?.[q] ?? [];
                      return marks.map(letter => {
                        const ci = ['A', 'B', 'C', 'D'].indexOf(letter);
                        if (ci < 0) return null;
                        const [x, y] = saeBubbleCenter(q, ci);
                        return <circle key={`dup-${q}-${letter}`} cx={x} cy={y} r={SAE_BUBBLE_RADIUS + 4} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 3" />;
                      });
                    }
                    const marks = omrResult?.duplicateMarks?.[q] ?? [];
                    return marks.map(letter => {
                      const pos = overlayBubbleFor(activeExam, q, letter);
                      if (!pos) return null;
                      return <circle key={`dup-${q}-${letter}`} cx={pos.x} cy={pos.y} r={pos.r + 4} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 3" />;
                    });
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* Overlay do Gabarito Personalizado: bolhas normalizadas do modelo
              (viewBox 0..1) sobre o retificado; radius normalizado ao maior lado. */}
          {capturedImage && activeExam?.answerKey && overlayCustom && !manualEntry && (
            <div className="card">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Gabarito personalizado</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Círculos verdes = acertos · vermelhos = erros · cinza = em branco · laranja = duplicada · âmbar = múltipla resposta</p>
              {!customGeom ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">Carregando o modelo do cartão…</p>
              ) : (
                <div style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', aspectRatio: `${overlayPageGeom?.pageW ?? customGeom.pageW}/${overlayPageGeom?.pageH ?? customGeom.pageH}`, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <img src={omrResult?.rectifiedImage || capturedImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', opacity: omrResult?.rectifiedImage ? 1 : 0.35 }} />
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                    {(overlayPageGeom?.bubbles ?? []).map((b) => {
                      const m = Math.max(overlayPageGeom?.pageW ?? customGeom.pageW, overlayPageGeom?.pageH ?? customGeom.pageH);
                      const inv = 1 / m;
                      const { rx, ry } = customBubbleShape(b, overlayPageGeom?.pageW ?? customGeom.pageW, overlayPageGeom?.pageH ?? customGeom.pageH);
                      const ans = manualAnswers[b.question] ?? '';
                      const key = activeExam.answerKey?.[b.question] ?? '';
                      const isMarked = ans.includes(b.option);
                      const isCorrect = key.includes(b.option);
                      let stroke = '#333'; let fill = 'none'; let sw = 2;
                      if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                      else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                      else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                      const isDup = !!omrResult?.duplicateMarks?.[b.question]?.includes(b.option);
                      const isMulti = !!omrResult?.multiMarks?.[b.question]?.includes(b.option);
                      return (
                        <g key={`${b.question}-${b.option}`}>
                          {b.shape === 'square'
                            ? <rect x={b.x - rx} y={b.y - ry} width={rx * 2} height={ry * 2} fill={fill} stroke={stroke} strokeWidth={sw * inv} />
                            : <ellipse cx={b.x} cy={b.y} rx={rx} ry={ry} fill={fill} stroke={stroke} strokeWidth={sw * inv} />}
                          {isDup && <ellipse cx={b.x} cy={b.y} rx={rx * 1.3} ry={ry * 1.3} fill="none" stroke="#f97316" strokeWidth={2 * inv} strokeDasharray={`${4 * inv} ${3 * inv}`} />}
                          {isMulti && <ellipse cx={b.x} cy={b.y} rx={rx * 1.3} ry={ry * 1.3} fill="none" stroke="#ca8a04" strokeWidth={2 * inv} />}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
            </div>
          )}

          {templateMismatch && (
            <div className="p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg text-warning-600 dark:text-warning-100 text-sm">
              <strong>Atenção:</strong> o cartão fotografado é do modelo{' '}
              <strong>{templateLabel(omrResult?.templateUsed)}</strong>,
              mas a prova selecionada usa o modelo{' '}
              <strong>{examModelLabel}</strong>.
              A leitura foi feita no modelo detectado — confira se a prova está correta antes de salvar.
            </div>
          )}

          {omrResult.thresholdsUsed && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Limiar: {omrResult.thresholdsUsed.source === 'adaptive'
                ? `adaptativo (${omrResult.thresholdsUsed.floor.toFixed(3)}, calculado desta foto)`
                : `fixo (${omrResult.thresholdsUsed.floor.toFixed(3)})`}
              {omrResult.nFrames && omrResult.nFrames > 1 && ` · ${omrResult.nFrames} frames votados`}
            </div>
          )}

          {(omrResult.warnings ?? []).length > 0 && (
            <div className="p-3 bg-brand-50 dark:bg-brand-700/15 border border-brand-500/30 dark:border-brand-700 rounded-lg text-brand-800 dark:text-brand-200 text-sm space-y-1">
              {(omrResult.warnings ?? []).map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {omrResult.debugImages?.heatmap && (
            <details className="p-3 bg-surface dark:bg-gray-800/60 border border-line dark:border-gray-700 rounded-lg text-sm">
              <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300 min-h-[44px]">
                Diagnóstico: heatmap de scores por bolha
              </summary>
              <img src={omrResult.debugImages.heatmap} alt="Heatmap de scores" className="mt-2 rounded-lg mx-auto" />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Preenchimento = score (verde marcado → vermelho vazio) · contorno = verdict (verde ok, âmbar incerta, laranja duplicada, cinza em branco).</p>
            </details>
          )}

          {(omrResult.lowConfidence ?? []).length > 0 && (            <div className="p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg text-warning-600 dark:text-warning-100 text-sm">
              <strong>Atenção:</strong> As questões {(omrResult.lowConfidence ?? []).join(', ')} foram identificadas com baixa confiança.
              Verifique manualmente abaixo.
            </div>
          )}

          {(omrResult.duplicateQuestions ?? []).length > 0 && (
            <div className="p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg text-warning-600 dark:text-warning-100 text-sm">
              <strong>Duas marcações detectadas:</strong>{' '}
              {(omrResult.duplicateQuestions ?? []).map((q) => {
                const marks = omrResult.duplicateMarks?.[q];
                return `Q${q}${marks?.length ? ` (${marks.join(' e ')})` : ''}`;
              }).join(', ')}{' '}
              — contadas como <strong>erro</strong>. Se necessário, corrija manualmente clicando na alternativa correta.
            </div>
          )}

          {aiEnabled && !manualEntry && aiStatus && !aiStatus.available && (
            <div className="callout-warning text-sm" role="status">
              <strong>Assistente IA ligado, mas o Ollama não está disponível.</strong>{' '}
              {aiStatus.error || 'Instale/abra o Ollama neste computador para receber sugestões.'}
            </div>
          )}

          {aiEnabled && aiStatus?.available && !manualEntry && (
            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-brand-600 dark:text-brand-200 shrink-0" aria-hidden />
                <h3 className="text-sm font-semibold text-ink dark:text-white">Assistente IA local</h3>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                  Ollama · {aiStatus.model}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Gerado neste computador. <strong>Revise antes de aplicar</strong> — nada é salvo
                automaticamente.
              </p>
              {aiError && (
                <p className="callout-info text-xs" role="status">{aiError}</p>
              )}

              <div className="rounded-lg border border-line dark:border-gray-700 p-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    loading={aiReading}
                    disabled={aiReading || pageQuestionList.length === 0}
                    icon={<Bot size={15} aria-hidden />}
                    onClick={() => void runAiReadAll()}
                  >
                    {aiReading ? 'Lendo a folha…' : 'Corrigir tudo com IA'}
                  </Button>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    {pageQuestionList.length} questão(ões) nesta folha
                    {aiSheet ? ` · ${aiSheet.model}` : ''}
                  </span>
                </div>
                {aiSheet && (
                  <div className="space-y-2">
                    <p className="text-xs text-ink dark:text-gray-200">
                      IA leu <strong>{Object.keys(aiSheet.answers).length}</strong> de{' '}
                      {pageQuestionList.length}
                      {aiSheet.missing.length > 0 && (
                        <> · sem resposta: {aiSheet.missing.map((q) => `Q${q}`).join(', ')}</>
                      )}
                      {aiDivergences.length > 0 && (
                        <> · <strong>{aiDivergences.length} divergem do OMR</strong></>
                      )}
                    </p>
                    {aiDivergences.length > 0 && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {aiDivergences.slice(0, 8)
                          .map((d) => `Q${d.q}: OMR ${d.omr || '—'} → IA ${d.ai}`)
                          .join(' · ')}
                        {aiDivergences.length > 8 && ' …'}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={applyAiSheet}>Aplicar respostas da IA</Button>
                      <Button size="sm" variant="secondary" onClick={() => setAiSheet(null)}>
                        Descartar
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {doubtfulQuestions.length > 0 && (
              <ul className="space-y-2">
                {doubtfulQuestions.map((q) => {
                  const low = (omrResult.lowConfidence ?? []).includes(q);
                  const dup = (omrResult.duplicateQuestions ?? []).includes(q);
                  const blank = (omrResult.blankQuestions ?? []).includes(q);
                  const marks = omrResult.duplicateMarks?.[q];
                  const reasons = [
                    low ? 'baixa confiança' : '',
                    dup ? 'duplicada' : '',
                    blank ? 'em branco' : '',
                  ].filter(Boolean).join(' · ');
                  const s = aiSuggestions[q];
                  return (
                    <li key={q} className="rounded-lg bg-surface dark:bg-gray-800/60 p-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink dark:text-gray-100">Q{q}</span>
                        <span className="text-[11px] text-amber-700 dark:text-amber-300 truncate">
                          {reasons}
                          {marks?.length ? ` (${marks.join(' + ')})` : ''}
                        </span>
                        <span className="flex-1" />
                        {!s && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={aiLoading === q}
                            disabled={aiLoading != null && aiLoading !== q}
                            onClick={() => void runAiSuggestion(q)}
                          >
                            Sugerir
                          </Button>
                        )}
                      </div>
                      {s && (
                        <div className="rounded-lg border border-line dark:border-gray-700 bg-white dark:bg-gray-900 p-2 space-y-1.5">
                          <p className="text-sm text-ink dark:text-gray-100">
                            Sugestão:{' '}
                            <strong>{s.suggestion === 'VAZIO' ? 'em branco' : (s.suggestion ?? 'sem sugestão')}</strong>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {' '}· confiança {Math.round(s.confidence * 100)}%
                            </span>
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{s.reason}</p>
                          <div className="flex flex-wrap gap-2">
                            {s.suggestion && /^[ABCD]$/.test(s.suggestion) && (
                              <Button size="sm" onClick={() => applyAiSuggestion(q, s.suggestion as string)}>
                                Aplicar {s.suggestion}
                              </Button>
                            )}
                            <Button size="sm" variant="secondary" onClick={() => ignoreAiSuggestion(q)}>
                              Ignorar
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              )}
            </div>
          )}

          <div className="card">
            <h3 className="text-lg font-semibold text-ink dark:text-white mb-4">
              {manualEntry ? 'Preencha as respostas' : 'Conferência'}
            </h3>
            {manualEntry && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Clique na alternativa marcada pelo aluno em cada questão. Clique de novo para desmarcar.
              </p>
            )}

            <div className="mb-4">
              <Field
                label="Aluno"
                htmlFor="review-student-name"
                required={identified?.kind !== 'ok'}
                helper={nameHelper}
              >
                {canMatchByName ? (
                  <Autocomplete
                    id="review-student-name"
                    value={studentName}
                    onValueChange={handleStudentNameChange}
                    options={autoOptions}
                    onPick={handlePickStudent}
                    invalid={!studentName.trim()}
                    ariaLabel="Aluno"
                    placeholder="Digite o nome do aluno (cartão sem QR cadastrado)"
                    emptyText={studentsLoading
                      ? 'Carregando lista de alunos...'
                      : 'Nenhum aluno encontrado — o resultado será criado para o nome digitado.'}
                  />
                ) : (
                  <Input
                    id="review-student-name"
                    type="text"
                    invalid={!studentName.trim()}
                    placeholder={identified?.kind === 'ok' ? identified.name : 'Digite o nome do aluno (cartão sem QR cadastrado)'}
                    value={studentName}
                    onChange={(e) => handleStudentNameChange(e.target.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
              {selectedAlunoId != null && !manualInfo && (
                <p className="text-xs text-success-600 dark:text-success-100 bg-success-50 dark:bg-success-700/15 border border-success-500/30 rounded-lg px-2 py-1 mt-2">
                  Aluno selecionado na lista — o resultado será atribuído direto a ele.
                </p>
              )}
              {selectedAlunoId == null && selectedFromCatalog && studentName.trim() && !manualInfo && (
                <p className="text-xs text-brand-800 dark:text-brand-200 bg-brand-50 dark:bg-brand-700/15 border border-brand-500/30 rounded-lg px-2 py-1 mt-2">
                  Nome do catálogo (turma ou global, ainda não importado para a prova) — o resultado será criado por nome.
                </p>
              )}
              {manualInfo && (
                <p className="text-xs text-success-600 dark:text-success-100 bg-success-50 dark:bg-success-700/15 border border-success-500/30 rounded-lg px-2 py-1 mt-2">
                  {manualInfo}
                </p>
              )}
              {candidates && candidates.length > 0 && (
                <div className="mt-3 p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg">
                  <p className="text-sm text-warning-600 dark:text-warning-100 font-medium mb-2">
                    Mais de um aluno com esse nome — escolha para quem vai o resultado:
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {candidates.map(c => (
                      <button
                        key={c.aluno_id}
                        type="button"
                        onClick={() => chooseNameCandidate(c)}
                        className="text-left px-3 py-2 rounded-lg border border-warning-500/40 bg-white dark:bg-gray-900 hover:bg-warning-100 dark:hover:bg-warning-500/20 text-sm min-h-[44px]"
                      >
                        <span className="font-medium">{c.nome}</span>
                        {c.matricula && <span className="text-gray-500 dark:text-gray-400"> · {c.matricula}</span>}
                        <span className={`ml-2 text-xs ${c.tem_gabarito ? 'text-gray-500 dark:text-gray-400' : 'text-warning-600 dark:text-warning-100 font-medium'}`}>
                          {c.tem_gabarito ? `cartão ${c.codigo_unico}` : 'sem cartão gerado'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setCandidates(null)} className="mt-2 text-xs text-gray-500 dark:text-gray-400 underline">
                    Cancelar escolha
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-6">
              {getSubjectIds(activeExam).map((sid) => {
                const [start, end] = getSubjectRange(sid, activeExam.questionsPerSubject, activeExam.layoutMode);
                return (
                  <div key={sid}>
                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                      {getSubjectName(activeExam, sid)} (1–{end - start + 1})
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line dark:border-gray-700">
                            <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Q</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500 dark:text-gray-400">A</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500 dark:text-gray-400">B</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500 dark:text-gray-400">C</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500 dark:text-gray-400">D</th>
                            <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Resposta</th>
                            <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Gabarito</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500 dark:text-gray-400">Resultado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: activeExam.questionsPerSubject }, (_, i) => start + i).map((q) => {
                            const selected = manualAnswers[q] || null;
                            const correctAnswer = activeExam.answerKey?.[q];
                            const isCorrect = selected && correctAnswer && selected === correctAnswer;
                            const dupList = omrResult.duplicateQuestions ?? [];
                            const qMarks = omrResult.duplicateMarks?.[q];
                            const isDuplicate = dupList.includes(q);
                            const isLowConf = (omrResult.lowConfidence ?? []).includes(q);

                            return (
                              <tr key={q} className={`border-b border-line/60 dark:border-gray-800 ${isLowConf ? 'bg-warning-50 dark:bg-warning-500/10' : isDuplicate ? 'bg-warning-50 dark:bg-warning-500/10' : ''}`}>
                                <td className="py-2 px-3 font-bold text-gray-700 dark:text-gray-300">{String(q - start + 1).padStart(2, '0')}</td>
                                {['A', 'B', 'C', 'D'].map((opt) => (
                                  <td key={opt} className="py-2 px-3 text-center">
                                    <button
                                      onClick={() => handleManualAnswer(q, opt)}
                                      className={`bubble-option w-8 h-8 text-xs ${
                                        selected === opt
                                          ? 'selected'
                                          : isDuplicate && !selected && qMarks?.includes(opt)
                                            ? 'marked'
                                            : ''
                                      }`}
                                      title={
                                        isDuplicate && !selected && qMarks?.includes(opt)
                                          ? `Aluno marcou ${opt}`
                                          : undefined
                                      }
                                    >
                                      {opt}
                                    </button>
                                  </td>
                                ))}
                                <td className="py-2 px-3 font-medium">
                                  {!selected && isDuplicate && qMarks?.length ? (
                                    <span className="text-danger-600 dark:text-danger-100">{qMarks.join(' + ')}</span>
                                  ) : selected ? (
                                    selected
                                  ) : (
                                    <span className="text-gray-300 dark:text-gray-600">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{correctAnswer || '—'}</td>
                                <td className="py-2 px-3 text-center">
                                  {selected ? (
                                    isCorrect ? (
                                      <span className="text-success-600 dark:text-success-100 font-medium">✓ Correta</span>
                                    ) : (
                                      <span className="text-danger-600 dark:text-danger-100 font-medium">✗ Incorreta</span>
                                    )
                                  ) : isDuplicate ? (
                                    <span className="text-danger-600 dark:text-danger-100 font-medium">
                                      ✗ Incorreta{' '}
                                      <span className="text-xs">
                                        (marcou {qMarks?.length ? qMarks.join(' e ') : 'duas alternativas'})
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">Em branco</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-ink dark:text-white mb-3">Resumo</h3>
            {(() => {
              const dupList = omrResult.duplicateQuestions ?? [];
              let correct = 0, incorrect = 0, blank = 0;
              for (let q = 1; q <= activeExam.totalQuestions; q++) {
                const ans = manualAnswers[q];
                if (!ans) {
                  // Política: duplicada não resolvida conta como ERRO
                  if (dupList.includes(q)) incorrect++;
                  else blank++;
                } else if (activeExam.answerKey?.[q] && ans === activeExam.answerKey[q]) correct++;
                else incorrect++;
              }
              const grade = calculateGrade(correct, activeExam.totalQuestions, activeExam.gradeScale);
              const subjectStats = computeSubjectStats(activeExam, manualAnswers, dupList);
              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div className="bg-success-50 dark:bg-success-700/15 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-success-600 dark:text-success-100">{correct}</p>
                      <p className="text-xs text-success-600 dark:text-success-100/70">Acertos</p>
                    </div>
                    <div className="bg-danger-50 dark:bg-danger-700/15 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-danger-600 dark:text-danger-100">{incorrect}</p>
                      <p className="text-xs text-danger-600 dark:text-danger-100/70">Erros</p>
                    </div>
                    <div className="bg-surface dark:bg-gray-800 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-500 dark:text-gray-400">{blank}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400/70">Em branco</p>
                    </div>
                    <div className="bg-warning-50 dark:bg-warning-500/10 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-warning-600 dark:text-warning-100">{(omrResult.duplicateQuestions ?? []).length}</p>
                      <p className="text-xs text-warning-600 dark:text-warning-100/70">Duplicadas (erros)</p>
                    </div>
                    <div className="bg-brand-50 dark:bg-brand-700/15 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-brand-600 dark:text-brand-200">
                        {activeExam.gradeScale === 'count' ? correct : grade}
                      </p>
                      <p className="text-xs text-brand-600 dark:text-brand-200/70">{getGradeLabel(activeExam.gradeScale)}</p>
                    </div>
                  </div>
                  <div className={`grid gap-4 ${getSubjectIds(activeExam).length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {getSubjectIds(activeExam).map((sid) => {
                      const st = subjectStats[sid];
                      const [sStart, sEnd] = getSubjectRange(sid, activeExam.questionsPerSubject, activeExam.layoutMode);
                      return (
                        <div key={sid} className="rounded-lg border border-line dark:border-gray-700 p-3">
                          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 truncate">
                            {getSubjectName(activeExam, sid)}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {st.correctCount}/{sEnd - sStart + 1} acertos
                            </span>
                            <span className="text-xl font-bold text-brand-600 dark:text-brand-200">
                              {activeExam.gradeScale === 'count' ? st.correctCount : st.grade}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>

          <div className="flex gap-2">
            <Button
              variant="success"
              onClick={handleSaveResult}
              disabled={!studentName.trim() || identified?.kind === 'wrong_exam'}
              icon={<Save size={16} aria-hidden />}
            >
              Salvar resultado
            </Button>
            <Button variant="secondary" onClick={resetForm} icon={<RotateCcw size={16} aria-hidden />}>
              Corrigir outro cartão
            </Button>
          </div>
        </div>
      )}

      {step === 'saved' && (
        <div className="card max-w-md text-center py-12">
          <div className="w-16 h-16 bg-success-50 dark:bg-success-700/20 rounded-full flex items-center justify-center mx-auto mb-4 text-success-600 dark:text-success-100" aria-hidden>
            <CheckCircle2 size={32} strokeWidth={1.8} />
          </div>
          <h3 className="text-xl font-bold text-ink dark:text-white mb-2">Resultado salvo!</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            O cartão de <strong>{studentName}</strong> foi corrigido e salvo com sucesso.
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={resetForm} icon={<RotateCcw size={16} aria-hidden />}>
              Corrigir outro cartão
            </Button>
            <Button variant="secondary" onClick={() => onNavigate('results')} icon={<ArrowRight size={16} aria-hidden />}>
              Ver resultados
            </Button>
          </div>
          <div className="text-left mt-6 pt-4 border-t border-line dark:border-gray-800">
            {manualEntry ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <PenLine size={15} aria-hidden />
                Resultado salvo com respostas preenchidas manualmente.
              </p>
            ) : (
              <ReadStages doneCount={8} anchorLabel={anchorLabelFor(activeExam)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════ Painel de correção em lote ═══════════════════════

const BATCH_STATUS_META: Record<BatchStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: 'Na fila', tone: 'neutral' },
  processing: { label: 'Processando…', tone: 'info' },
  saved: { label: 'Corrigido', tone: 'success' },
  pending_id: { label: 'QR ilegível', tone: 'warning' },
  unknown_code: { label: 'Código não registrado', tone: 'warning' },
  wrong_exam: { label: 'Prova divergente', tone: 'danger' },
  conflict: { label: 'Já corrigido', tone: 'warning' },
  error: { label: 'Falhou', tone: 'danger' },
};

interface BatchPanelProps {
  exams: Exam[];
  selectedExamId: string;
  onExamChange: (id: string) => void;
  items: BatchItem[];
  running: boolean;
  error: string | null;
  onFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStart: () => void;
  onResolveConflict: (item: BatchItem) => void;
  onReviewManually: (item: BatchItem, manual?: boolean) => void;
  onClear: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

function BatchPanel({
  exams, selectedExamId, onExamChange, items, running,
  error, onFiles, onStart, onResolveConflict, onReviewManually, onClear, fileInputRef,
}: BatchPanelProps) {
  const exam = selectedExamId ? exams.find(e => e.id === selectedExamId) : undefined;
  const processed = items.filter(i => i.status !== 'pending' && i.status !== 'processing').length;
  const savedCount = items.filter(i => i.status === 'saved').length;
  const problemCount = items.filter(i =>
    ['pending_id', 'unknown_code', 'wrong_exam', 'conflict', 'error'].includes(i.status)
  ).length;

  return (
    <div className="space-y-4">
      <div className="card max-w-3xl space-y-4">
        <div className="p-3 bg-brand-50 dark:bg-brand-700/15 border border-brand-500/30 dark:border-brand-700 rounded-lg text-brand-800 dark:text-brand-200 text-sm">
          <strong>Correção em lote:</strong> cada foto é identificada pelo QR Code do cartão — a ordem
          das fotos não importa. Fotos com QR válido são corrigidas e salvas automaticamente; problemas
          ficam na fila abaixo para revisão manual.
        </div>

        <Field label="Selecione a prova" required>
          {exams.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma prova cadastrada.</p>
          ) : (
            <Select
              aria-label="Selecione a prova"
              value={selectedExamId}
              onChange={(e) => onExamChange(e.target.value)}
              disabled={running}
            >
              <option value="">Selecione...</option>
              {exams.map(x => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.answerKey ? '' : ' (sem gabarito!)'}
                </option>
              ))}
            </Select>
          )}
          {exam && !exam.answerKey && (
            <p className="text-xs text-danger-600 dark:text-danger-100 mt-1">
              O lote exige gabarito cadastrado para corrigir automaticamente.
            </p>
          )}
        </Field>

        <div>
          <span className="label">Fotos dos cartões *</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!selectedExamId || running}
            className="w-full border-2 border-dashed border-line dark:border-gray-600 rounded-lg p-6 text-center hover:border-brand-400 hover:bg-brand-50/30 dark:hover:bg-brand-700/10 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            <ImagePlus size={28} strokeWidth={1.5} className="text-gray-400 dark:text-gray-500 mx-auto mb-2" aria-hidden />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Selecione uma ou várias fotos</span>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.jpg, .png — quantas quiser</p>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFiles}
          />
        </div>

        {error && (
          <div className="p-3 bg-danger-50 dark:bg-danger-700/15 border border-danger-500/30 rounded-lg text-danger-600 dark:text-danger-100 text-sm">{error}</div>
        )}

        {items.length > 0 && (
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-sm text-gray-600 dark:text-gray-300">{items.length} foto(s) na fila</span>
            {running && (
              <span className="inline-flex items-center gap-2 text-sm text-brand-600 dark:text-brand-200">
                <div className="animate-spin w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full" />
                {processed}/{items.length} processadas…
              </span>
            )}
            {!running && (
              <>
                <Button
                  onClick={onStart}
                  disabled={!exam || !exam.answerKey}
                  icon={<Play size={16} aria-hidden />}
                  className="ml-auto"
                >
                  Corrigir {items.length} foto{items.length > 1 ? 's' : ''}
                </Button>
                <Button variant="secondary" onClick={onClear} icon={<Trash2 size={15} aria-hidden />}>Limpar</Button>
              </>
            )}
          </div>
        )}
      </div>

      {items.length > 0 && !running && (
        <div className="card max-w-4xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-ink dark:text-white">Resultado do Lote</h3>
            <div className="flex gap-2 text-xs">
              <Badge tone="success">{savedCount} corrigida(s)</Badge>
              {problemCount > 0 && (
                <Badge tone="warning">{problemCount} para revisar</Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {items.map(item => {
              const meta = BATCH_STATUS_META[item.status];
              return (
                <div
                  key={item.fileName}
                  className={`border rounded-lg p-3 flex items-start gap-3 ${
                    item.status === 'saved' ? 'border-success-500/25'
                    : ['pending_id', 'unknown_code', 'conflict'].includes(item.status) ? 'border-warning-500/30'
                    : item.status === 'error' || item.status === 'wrong_exam' ? 'border-danger-500/30'
                    : 'border-line dark:border-gray-700'
                  }`}
                >
                  <img src={item.dataUrl} alt="" className="w-12 h-12 object-cover rounded-md border border-line dark:border-gray-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-ink dark:text-white truncate max-w-[240px]">{item.fileName}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {item.status === 'saved' && (
                        <>
                          <strong>{item.studentName}</strong>{' '}
                          <span className="font-mono text-[11px]">{item.cardId}</span> —{' '}
                          {item.correct}/{exam?.totalQuestions} acertos • Nota <strong>{item.grade}</strong>
                        </>
                      )}
                      {item.status === 'conflict' && (
                        <>
                          {item.studentName} ({item.cardId}) — nota anterior:{' '}
                          <strong>{item.previousNota ?? '—'}</strong> • nova nota: <strong>{item.grade}</strong>
                          {item.detail ? ` — ${item.detail}` : ''}
                        </>
                      )}
                      {(item.status === 'pending_id' || item.status === 'unknown_code') && item.detail}
                      {item.status === 'wrong_exam' && `${item.studentName ?? ''}: ${item.detail}`}
                      {item.status === 'error' && item.detail}
                      {item.status === 'pending' && 'Aguardando início'}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {item.status === 'conflict' && (
                      <Button size="sm" onClick={() => onResolveConflict(item)}>
                        Sobrescrever
                      </Button>
                    )}
                    {(item.status === 'pending_id' || item.status === 'unknown_code') && (
                      <Button size="sm" variant="secondary" onClick={() => onReviewManually(item)} icon={<Eye size={14} aria-hidden />}>
                        Revisar
                      </Button>
                    )}
                    {item.status === 'error' && (
                      <Button size="sm" variant="secondary" onClick={() => onReviewManually(item, true)} disabled={!exam?.answerKey} icon={<PenLine size={14} aria-hidden />}>
                        Inserir manualmente
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

