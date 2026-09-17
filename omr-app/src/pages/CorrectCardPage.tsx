import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppView, Exam, StudentResult, isSaeExam } from '../types';
import { saeBubbleCenter, SAE_BUBBLE_RADIUS } from '../utils/sae-template';
import { getExams, saveResult } from '../utils/storage';
import {
  processImage as apiProcessImage, ProcessResult,
  lookupCodigo, saveGabaritoResultado, AlreadyGradedError, postAvulsoResultado,
} from '../utils/api';
import { calculateGrade } from '../utils/grade';
import { computeSubjectStats, getSubjectName, getSubjectIds, getSubjectRange } from '../utils/exam';
import { CARD_WIDTH, CARD_HEIGHT, BUBBLE_RADIUS, PORTUGUESE_X, MATHEMATICS_X, questionYFor } from '../utils/card-template';
import { useAuth } from '../context/AuthContext';

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
  detail?: string;
  previousNota?: number | null;
}

function countResults(
  exam: Exam,
  answers: Record<number, string>,
  dupList: number[],
): { correct: number; incorrect: number; blank: number } {
  let correct = 0, incorrect = 0, blank = 0;
  const key = exam.answerKey || {};
  for (let q = 1; q <= exam.totalQuestions; q++) {
    const a = answers[q];
    if (!a) {
      // Política: duplicada não resolvida conta como ERRO
      if (dupList.includes(q)) incorrect++;
      else blank++;
    } else if (key[q] && a === key[q]) correct++;
    else incorrect++;
  }
  return { correct, incorrect, blank };
}

export default function CorrectCardPage({ examId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const exams = getExams(userId);
  const [selectedExamId, setSelectedExamId] = useState(examId || '');
  const [studentName, setStudentName] = useState('');
  const [step, setStep] = useState<'form' | 'capture' | 'processing' | 'review' | 'saved'>('form');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [omrResult, setOmrResult] = useState<ProcessResult | null>(null);
  const [manualAnswers, setManualAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [identified, setIdentified] = useState<Identification>(null);

  // Lote
  const [mode, setMode] = useState<'individual' | 'lote'>('individual');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Se celular tem provas vazias mas está logado, tenta sincronizar uma vez do servidor (sem quebrar a página)
  useEffect(() => {
    if (exams.length > 0 || !userId) return;
    let cancelled = false;
    import('../utils/api').then(({ getExamsFromDB }) => getExamsFromDB().then(remote => {
      if (cancelled || !remote.length) return;
      import('../utils/storage').then(({ saveExam }) => {
        for (const av of remote) {
          saveExam({
            id: av.external_id, name: av.titulo, subjectLP: av.subject_lp, subjectMat: av.subject_mat,
            questionsPerSubject: av.questions_per_subject,
            totalQuestions: av.layout_mode === 'single' ? av.questions_per_subject : av.questions_per_subject * 2,
            createdAt: av.created_at || new Date().toISOString(),
            gradeScale: av.grade_scale as Exam['gradeScale'],
            answerKey: av.answer_key as Record<number, string> | null,
            layoutMode: av.layout_mode as Exam['layoutMode'],
          }, userId);
        }
        if (!cancelled) window.location.reload();
      });
    }).catch(()=>{}) );
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const activeExam = selectedExamId ? exams.find(e => e.id === selectedExamId) : null;

  const startCamera = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    try {
      setError(null);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
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
      fileInputRef.current?.click();
      const e = err as DOMException;
      let msg = 'Câmera direta indisponível — abrindo câmera do sistema.';
      if (e?.name === 'NotAllowedError') msg = 'Permissão negada — use a câmera do sistema ou libere nas configurações.';
      setError(msg);
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      setError('Câmera ainda inicializando — aguarde 1 segundo e tente novamente.');
      return;
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    } catch {
      setError('Falha ao gerar imagem da captura. Tente “Enviar Imagem” com a câmera do sistema.');
      return;
    }
    if (!dataUrl || dataUrl.length < 200) {
      setError('Imagem de captura vazia. Aguarde a câmera estabilizar e tente novamente, ou use “Enviar Imagem”.');
      return;
    }
    setCapturedImage(dataUrl);
    stopCamera();
    processOMR(dataUrl);
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCapturedImage(dataUrl);
      setStep('processing');
      processOMR(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const processOMR = async (dataUrl: string) => {
    setStep('processing');
    setError(null);
    setProcessingProgress(0);

    try {
      // Converter dataUrl para File para enviar à API Python
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'card.jpg', { type: 'image/jpeg' });

      setProcessingProgress(50);
      const qpsUsado = activeExam?.questionsPerSubject ?? 22;
      const modoUsado = activeExam?.layoutMode ?? 'dual';
      const templateUsado = isSaeExam(activeExam) ? 'sae' : 'padrao';
      const result = await apiProcessImage(file, qpsUsado, modoUsado, templateUsado);
      setProcessingProgress(100);

      setOmrResult(result);

      if (result.success && result.answers) {
        setManualAnswers({ ...result.answers });

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
        setIdentified(identification);
        setStep('review');
      } else {
        setError(result.error || 'Erro ao processar a imagem');
        setCapturedImage(null);
        setStep('form');
      }
    } catch (err) {
      setError('Erro ao processar a imagem. Verifique se o backend Python está rodando.');
      setCapturedImage(null);
      setStep('form');
    }
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

  const handleSaveResult = async () => {
    if (!activeExam || !studentName.trim()) return;
    if (!activeExam.answerKey) {
      alert('Esta prova ainda não tem gabarito cadastrado. Vá em "Cadastrar gabarito" e informe as respostas corretas antes de corrigir.');
      return;
    }
    // §18 — gabarito de outra avaliação não pode ser corrigido aqui
    if (identified?.kind === 'wrong_exam') return;

    const answerKey = activeExam.answerKey || {};
    const dupList = omrResult?.duplicateQuestions ?? [];
    const dupMarks = omrResult?.duplicateMarks ?? {};
    let correctCount = 0;
    let incorrectCount = 0;
    let blankCount = 0;

    for (let q = 1; q <= activeExam.totalQuestions; q++) {
      const studentAnswer = manualAnswers[q];
      if (!studentAnswer) {
        // Política: duplicada não resolvida conta como ERRO
        if (dupList.includes(q)) incorrectCount++;
        else blankCount++;
      } else if (answerKey[q] && studentAnswer === answerKey[q]) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    }

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

    let codigoUnico: string | undefined = identified?.kind === 'ok' ? identified.cardId : undefined;

    // ─── Persistência oficial no banco (todos os casos) ───
    if (identified?.kind === 'ok') {
      try {
        await saveGabaritoResultado(identified.cardId, basePayload, false);
      } catch (err) {
        if (err instanceof AlreadyGradedError) {
          const prev = err.previous;
          const msg = `O gabarito ${identified.cardId} já possui resultado salvo`
            + `${prev.nome ? ` para ${prev.nome}` : ''}`
            + `${prev.nota != null ? ` (nota ${prev.nota})` : ''}. Substituir?`;
          if (confirm(msg)) {
            try {
              await saveGabaritoResultado(identified.cardId, basePayload, true);
            } catch {
              alert('Não foi possível atualizar o resultado no servidor. O resultado ficou salvo apenas neste navegador.');
            }
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Falha ao gravar no banco: ${msg}. Verifique se o celular está em http://192.168.18.139:5173 (mesma Wi-Fi) e logado.`);
        }
      }
    } else if (studentName.trim() && activeExam) {
      // Correção manual/avulsa sem QR — cria aluno+gabarito no banco
      try {
        const avulso = await postAvulsoResultado(activeExam.id, {
          nome: studentName.trim(),
          respostas: basePayload.respostas,
          acertos: correctCount,
          erros: incorrectCount,
          brancos: blankCount,
          nota: grade,
          observacoes,
        });
        codigoUnico = avulso.codigo_unico;
      } catch {
        // backend offline — segue apenas local
      }
    }

    const result: StudentResult = {
      id: uuidv4(),
      examId: activeExam.id,
      studentName: studentName.trim(),
      answers: { ...manualAnswers },
      correctCount,
      incorrectCount,
      blankCount,
      duplicateCount: dupList.length,
      duplicateQuestions: dupList,
      duplicateMarks: dupMarks,
      codigoUnico,
      grade,
      timestamp: new Date().toISOString(),
      manualOverrides: {},
    };

    saveResult(result, userId);
    setStep('saved');
  };

  const resetForm = () => {
    setStudentName('');
    setCapturedImage(null);
    setOmrResult(null);
    setManualAnswers({});
    setError(null);
    setProcessingProgress(0);
    setIdentified(null);
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
      reader.onload = () => {
        items.push({
          file,
          fileName: file.name,
          dataUrl: reader.result as string,
          status: 'pending',
        });
        loaded++;
        if (loaded === files.length) {
          items.sort((a, b) => a.fileName.localeCompare(b.fileName));
          setBatchItems(items);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const patchItem = (fileName: string, patch: Partial<BatchItem>) => {
    setBatchItems(prev => prev.map(it => it.fileName === fileName ? { ...it, ...patch } : it));
  };

  const runBatch = async () => {
    const exam = activeExam;
    if (!exam || !exam.answerKey || batchItems.length === 0) return;
    const qps = exam.questionsPerSubject;
    const layoutMode = exam.layoutMode ?? 'dual';
    setBatchRunning(true);
    setError(null);

    for (const item of batchItems) {
      if (!['pending', 'conflict'].includes(item.status)) continue;
      patchItem(item.fileName, { status: 'processing' });

      try {
        // 1. Leitura OMR + QR
        const result = await apiProcessImage(item.file, qps, layoutMode);
        if (!result.success || !result.answers) {
          patchItem(item.fileName, { status: 'error', detail: result.error || 'Falha na leitura' });
          continue;
        }

        const answers = { ...result.answers };
        const dupQuestions = result.duplicateQuestions ?? [];
        const dupMarks = result.duplicateMarks ?? {};
        const base = {
          answers, dupQuestions, dupMarks,
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
  const reviewManually = (item: BatchItem) => {
    setMode('individual');
    setCapturedImage(item.dataUrl);
    setOmrResult({
      success: true,
      answers: item.answers,
      blankQuestions: [],
      duplicateQuestions: item.dupQuestions,
      duplicateMarks: item.dupMarks,
      lowConfidence: [],
      cardId: item.cardId,
    });
    setManualAnswers({ ...(item.answers ?? {}) });
    setIdentified(item.cardId ? { kind: 'unknown', cardId: item.cardId } : null);
    setStudentName('');
    setStep('review');
  };

  const getGradeLabel = (gradeScale: string) => {
    if (gradeScale === 'count') return 'acertos';
    return `nota (${gradeScale})`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Corrigir Cartão-Resposta</h1>
      <p className="text-gray-500 mb-4">Capture ou envie a foto do cartão preenchido pelo aluno</p>

      {step === 'form' && (
        <div className="flex gap-2 mb-6">
          {(['individual', 'lote'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={batchRunning}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === m
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {m === 'individual' ? 'Individual' : 'Em lote (várias fotos)'}
            </button>
          ))}
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
              <label className="label">Selecione a Prova *</label>
              {exams.length === 0 ? (
                <div className="text-sm text-gray-500">
                  <p>Nenhuma prova cadastrada neste aparelho.</p>
                  <p className="text-xs mt-1">No celular, recarregue a página logado com o mesmo usuário do PC — as provas vêm do servidor.</p>
                  <button onClick={() => window.location.reload()} className="btn btn-secondary btn-sm mt-2">Recarregar</button>
                  <button onClick={() => onNavigate('new-exam')} className="btn btn-primary btn-sm mt-2 ml-2">Criar Prova</button>
                </div>
              ) : (
              <select
                className="input"
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
              </select>
            )}
          </div>

          {activeExam && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
              <strong>Identificação automática:</strong> o aluno será reconhecido pelo QR Code impresso no cartão
              (lista importada em &quot;Importar Alunos&quot;). Não é preciso digitar o nome.
              Cartões sem QR cadastrado pedirão o nome na conferência.
            </div>
          )}

          {activeExam && !activeExam.answerKey && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
              Esta prova ainda não possui gabarito.
              <button onClick={() => onNavigate('register-key', activeExam.id)} className="underline ml-1 font-medium">
                Cadastrar gabarito
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          <div className="flex gap-3">
            <button
              onClick={startCamera}
              disabled={!selectedExamId}
              className="btn btn-primary flex-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Capturar com Câmera
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedExamId}
              className="btn btn-secondary flex-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {window.isSecureContext ? 'Enviar Imagem' : 'Câmera do Sistema'}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />
          {!window.isSecureContext && (
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-2">
              Acesso via IP — ao clicar em “Capturar com Câmera” o sistema abre a câmera nativa do celular automaticamente.
            </p>
          )}
        </div>
      )}

      {step === 'capture' && (
        <div className="card max-w-2xl">
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              Posicione o cartão-resposta na frente da câmera. Certifique-se de que está:
            </p>
            <ul className="text-xs text-gray-500 list-disc list-inside space-y-1">
              <li>Bem iluminado (sem sombras sobre os círculos)</li>
              <li>Plano e sem dobraduras</li>
              <li>Totalmente visível dentro da moldura</li>
            </ul>
          </div>

          <div className="relative bg-black rounded-xl overflow-hidden mb-4">
            <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl" style={{ maxHeight: '400px', objectFit: 'cover' }} />
            <div className="absolute inset-4 border-2 border-dashed border-white/60 rounded-lg pointer-events-none" />
          </div>

          <canvas ref={canvasRef} className="hidden" />

          <div className="flex gap-3">
            <button onClick={captureFrame} className="btn btn-primary flex-1">
              Capturar
            </button>
            <button onClick={() => { stopCamera(); setStep('form'); }} className="btn btn-secondary">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="card max-w-2xl text-center py-12">
          <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Processando imagem...</p>
          <p className="text-sm text-gray-400 mt-1">
            Lendo as marcações do cartão ({Math.round(processingProgress)}%)
          </p>
          <div className="w-full max-w-xs mx-auto bg-gray-200 rounded-full h-2 mt-4 overflow-hidden">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-200"
              style={{ width: `${processingProgress}%` }}
            />
          </div>
        </div>
      )}

      {step === 'review' && omrResult && activeExam && (
        <div className="space-y-4 max-w-4xl">
          {identified?.kind === 'ok' && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
              <strong>Aluno identificado pelo banco de dados:</strong> {identified.name}{' '}
              <span className="font-mono">({identified.cardId})</span>
              {identified.examTitle && <> — prova: {identified.examTitle}</>}
            </div>
          )}

          {identified?.kind === 'unknown' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
              QR Code identificado, porém o código{' '}
              <span className="font-mono">{identified.cardId}</span> não pertence a nenhum gabarito
              registrado. <strong>Identificação pendente</strong> — selecione o aluno manualmente abaixo.
            </div>
          )}

          {identified?.kind === 'wrong_exam' && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <strong>ERRO — GABARITO DE OUTRA AVALIAÇÃO:</strong> o código{' '}
              <span className="font-mono">{identified.cardId}</span> pertence ao aluno{' '}
              {identified.name} na prova <strong>{identified.examTitle}</strong>. Selecione a prova
              correta para poder corrigir este cartão.
            </div>
          )}

          {capturedImage && (
            <div className="card">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Imagem Capturada</h3>
              <img src={capturedImage} alt="Cartão capturado" className="max-h-48 rounded-lg object-contain mx-auto" />
            </div>
          )}

          {/* Overlay gabarito na captura — verde=correto, vermelho=incorreto */}
          {capturedImage && activeExam?.answerKey && (
            <div className="card">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Visualização da correção na imagem</h3>
              <p className="text-xs text-gray-500 mb-3">Círculos verdes = acertos · vermelhos = erros · cinza = em branco · laranja = duplicada</p>
              <div style={{ position: 'relative', width: '100%', maxWidth: 420, margin: '0 auto', aspectRatio: `${CARD_WIDTH}/${CARD_HEIGHT}`, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                {/* fundo retificado do backend (alinhado 1:1 com template) — fallback para foto crua */}
                <img src={omrResult?.rectifiedImage || capturedImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: omrResult?.rectifiedImage ? 1 : 0.35 }} />
                {/* overlay SVG na geometria do template 1448x2048 */}
                <svg viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  {isSaeExam(activeExam) ? (
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
                  ) : (
                  (() => { const qYs = questionYFor(activeExam.questionsPerSubject); return Array.from({ length: activeExam.questionsPerSubject }, (_, i) => {
                    const q = i + 1;
                    const y = qYs[i];
                    const qGlobalPort = q;
                    const qGlobalMat = q + activeExam.questionsPerSubject;
                    return (
                      <g key={q}>
                        {/* Português */}
                        {PORTUGUESE_X.map((x, ci) => {
                          const letter = ['A','B','C','D'][ci];
                          const key = activeExam.answerKey?.[qGlobalPort];
                          const marked = manualAnswers[qGlobalPort] === letter;
                          const isCorrect = key ? letter === key : false;
                          const isMarked = marked;
                          let stroke = '#333'; let fill = 'none'; let sw = 2;
                          if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                          else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                          else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                          return <circle key={`p-${q}-${letter}`} cx={x} cy={y} r={BUBBLE_RADIUS} fill={fill} stroke={stroke} strokeWidth={sw} />;
                        })}
                        {/* Matemática (dual) */}
                        {activeExam.layoutMode !== 'single' && MATHEMATICS_X.map((x, ci) => {
                          const letter = ['A','B','C','D'][ci];
                          const key = activeExam.answerKey?.[qGlobalMat];
                          const marked = manualAnswers[qGlobalMat] === letter;
                          const isCorrect = key ? letter === key : false;
                          const isMarked = marked;
                          let stroke = '#333'; let fill = 'none'; let sw = 2;
                          if (isMarked && isCorrect) { stroke = '#16a34a'; fill = 'rgba(22,163,74,0.18)'; sw = 3; }
                          else if (isMarked && !isCorrect) { stroke = '#dc2626'; fill = 'rgba(220,38,38,0.18)'; sw = 3; }
                          else if (!isMarked && isCorrect) { stroke = '#16a34a'; sw = 2; }
                          return <circle key={`m-${q}-${letter}`} cx={x} cy={y} r={BUBBLE_RADIUS} fill={fill} stroke={stroke} strokeWidth={sw} />;
                        })}
                      </g>
                    );
                  })})())
                  }
                  {/* marcações duplicadas em laranja */}
                  {(omrResult?.duplicateQuestions ?? []).map(q => {
                    if (isSaeExam(activeExam)) {
                      const marks = omrResult?.duplicateMarks?.[q] ?? [];
                      return marks.map(letter => {
                        const ci = ['A', 'B', 'C', 'D'].indexOf(letter);
                        if (ci < 0) return null;
                        const [x, y] = saeBubbleCenter(q, ci);
                        return <circle key={`dup-${q}-${letter}`} cx={x} cy={y} r={SAE_BUBBLE_RADIUS + 4} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 3" />;
                      });
                    }
                    const y = questionYFor(activeExam.questionsPerSubject)[(q - 1) % activeExam.questionsPerSubject];
                    const isMat = activeExam.layoutMode !== 'single' && q > activeExam.questionsPerSubject;
                    const xs = isMat ? MATHEMATICS_X : PORTUGUESE_X;
                    const marks = omrResult?.duplicateMarks?.[q] ?? [];
                    return marks.map(letter => {
                      const ci = ['A','B','C','D'].indexOf(letter);
                      if (ci < 0) return null;
                      return <circle key={`dup-${q}-${letter}`} cx={xs[ci]} cy={y} r={BUBBLE_RADIUS + 4} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 3" />;
                    });
                  })}
                </svg>
              </div>
            </div>
          )}

          {(omrResult.lowConfidence ?? []).length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
              <strong>Atenção:</strong> As questões {(omrResult.lowConfidence ?? []).join(', ')} foram identificadas com baixa confiança.
              Verifique manualmente abaixo.
            </div>
          )}

          {(omrResult.duplicateQuestions ?? []).length > 0 && (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-orange-700 text-sm">
              <strong>Duas marcações detectadas:</strong>{' '}
              {(omrResult.duplicateQuestions ?? []).map((q) => {
                const marks = omrResult.duplicateMarks?.[q];
                return `Q${q}${marks?.length ? ` (${marks.join(' e ')})` : ''}`;
              }).join(', ')}{' '}
              — contadas como <strong>erro</strong>. Se necessário, corrija manualmente clicando na alternativa correta.
            </div>
          )}

          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Conferência
            </h3>

            <div className="mb-4">
              <label className="label">
                Aluno {identified?.kind === 'ok' ? '(identificado pelo banco de dados)' : '*'}
              </label>
              <input
                type="text"
                className={`input ${!studentName.trim() ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                placeholder={identified?.kind === 'ok' ? identified.name : 'Digite o nome do aluno (cartão sem QR cadastrado)'}
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
              />
              {!studentName.trim() && (
                <p className="text-xs text-amber-600 mt-1">
                  Informe o nome para salvar — necessário apenas quando o cartão não tem QR Code de lista importada.
                </p>
              )}
            </div>

            <div className="space-y-6">
              {getSubjectIds(activeExam).map((sid) => {
                const [start, end] = getSubjectRange(sid, activeExam.questionsPerSubject, activeExam.layoutMode);
                return (
                  <div key={sid}>
                    <h4 className="text-sm font-bold text-gray-700 mb-2">
                      {getSubjectName(activeExam, sid)} (1–{end - start + 1})
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="py-2 px-3 text-left font-medium text-gray-500">Q</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500">A</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500">B</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500">C</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500">D</th>
                            <th className="py-2 px-3 text-left font-medium text-gray-500">Resposta</th>
                            <th className="py-2 px-3 text-left font-medium text-gray-500">Gabarito</th>
                            <th className="py-2 px-3 text-center font-medium text-gray-500">Resultado</th>
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
                              <tr key={q} className={`border-b border-gray-100 ${isLowConf ? 'bg-amber-50' : isDuplicate ? 'bg-orange-50' : ''}`}>
                                <td className="py-2 px-3 font-bold text-gray-700">{String(q - start + 1).padStart(2, '0')}</td>
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
                                    <span className="text-red-600">{qMarks.join(' + ')}</span>
                                  ) : selected ? (
                                    selected
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-gray-600">{correctAnswer || '—'}</td>
                                <td className="py-2 px-3 text-center">
                                  {selected ? (
                                    isCorrect ? (
                                      <span className="text-emerald-600 font-medium">✓ Correta</span>
                                    ) : (
                                      <span className="text-red-600 font-medium">✗ Incorreta</span>
                                    )
                                  ) : isDuplicate ? (
                                    <span className="text-red-600 font-medium">
                                      ✗ Incorreta{' '}
                                      <span className="text-xs">
                                        (marcou {qMarks?.length ? qMarks.join(' e ') : 'duas alternativas'})
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-400">Em branco</span>
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
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Resumo</h3>
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
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-600">{correct}</p>
                      <p className="text-xs text-emerald-600/70">Acertos</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-red-600">{incorrect}</p>
                      <p className="text-xs text-red-600/70">Erros</p>
                    </div>
                    <div className="bg-gray-100 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-500">{blank}</p>
                      <p className="text-xs text-gray-500/70">Em branco</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-orange-600">{(omrResult.duplicateQuestions ?? []).length}</p>
                      <p className="text-xs text-orange-600/70">Duplicadas (erros)</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-blue-600">
                        {activeExam.gradeScale === 'count' ? correct : grade}
                      </p>
                      <p className="text-xs text-blue-600/70">{getGradeLabel(activeExam.gradeScale)}</p>
                    </div>
                  </div>
                  <div className={`grid gap-4 ${getSubjectIds(activeExam).length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {getSubjectIds(activeExam).map((sid) => {
                      const st = subjectStats[sid];
                      const [sStart, sEnd] = getSubjectRange(sid, activeExam.questionsPerSubject, activeExam.layoutMode);
                      return (
                        <div key={sid} className="rounded-lg border border-gray-200 p-3">
                          <p className="text-sm font-semibold text-gray-700 mb-2 truncate">
                            {getSubjectName(activeExam, sid)}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-500">
                              {st.correctCount}/{sEnd - sStart + 1} acertos
                            </span>
                            <span className="text-xl font-bold text-blue-600">
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

          <div className="flex gap-3">
            <button
              onClick={handleSaveResult}
              disabled={!studentName.trim() || identified?.kind === 'wrong_exam'}
              className="btn btn-success"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Salvar Resultado
            </button>
            <button onClick={resetForm} className="btn btn-secondary">
              Corrigir Outro Cartão
            </button>
          </div>
        </div>
      )}

      {step === 'saved' && (
        <div className="card max-w-md text-center py-12">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Resultado Salvo!</h3>
          <p className="text-gray-500 mb-6">
            O cartão de <strong>{studentName}</strong> foi corrigido e salvo com sucesso.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={resetForm} className="btn btn-primary">
              Corrigir Outro Cartão
            </button>
            <button onClick={() => onNavigate('results')} className="btn btn-secondary">
              Ver Resultados
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════ Painel de correção em lote ═══════════════════════

const BATCH_STATUS_META: Record<BatchStatus, { label: string; cls: string }> = {
  pending: { label: 'Na fila', cls: 'bg-gray-100 text-gray-500' },
  processing: { label: 'Processando…', cls: 'bg-blue-50 text-blue-600' },
  saved: { label: 'Corrigido', cls: 'bg-emerald-50 text-emerald-700' },
  pending_id: { label: 'QR ilegível', cls: 'bg-amber-50 text-amber-700' },
  unknown_code: { label: 'Código não registrado', cls: 'bg-amber-50 text-amber-700' },
  wrong_exam: { label: 'Prova divergente', cls: 'bg-red-50 text-red-700' },
  conflict: { label: 'Já corrigido', cls: 'bg-orange-50 text-orange-700' },
  error: { label: 'Falhou', cls: 'bg-red-50 text-red-700' },
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
  onReviewManually: (item: BatchItem) => void;
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
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          <strong>Correção em lote:</strong> cada foto é identificada pelo QR Code do cartão — a ordem
          das fotos não importa. Fotos com QR válido são corrigidas e salvas automaticamente; problemas
          ficam na fila abaixo para revisão manual.
        </div>

        <div>
          <label className="label">Selecione a Prova *</label>
          {exams.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma prova cadastrada.</p>
          ) : (
            <select
              className="input"
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
            </select>
          )}
          {exam && !exam.answerKey && (
            <p className="text-xs text-red-600 mt-1">
              O lote exige gabarito cadastrado para corrigir automaticamente.
            </p>
          )}
        </div>

        <div>
          <label className="label">Fotos dos Cartões *</label>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!selectedExamId || running}
            className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors disabled:opacity-50"
          >
            <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium text-gray-600">Selecione uma ou várias fotos</span>
            <p className="text-xs text-gray-400 mt-1">.jpg, .png — quantas quiser</p>
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
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        {items.length > 0 && (
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-sm text-gray-600">{items.length} foto(s) na fila</span>
            {running && (
              <span className="inline-flex items-center gap-2 text-sm text-blue-600">
                <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                {processed}/{items.length} processadas…
              </span>
            )}
            {!running && (
              <>
                <button
                  onClick={onStart}
                  disabled={!exam || !exam.answerKey}
                  className="btn btn-primary ml-auto"
                >
                  Corrigir {items.length} foto{items.length > 1 ? 's' : ''}
                </button>
                <button onClick={onClear} className="btn btn-secondary">Limpar</button>
              </>
            )}
          </div>
        )}
      </div>

      {items.length > 0 && !running && (
        <div className="card max-w-4xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-900">Resultado do Lote</h3>
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                {savedCount} corrigida(s)
              </span>
              {problemCount > 0 && (
                <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 font-medium">
                  {problemCount} para revisar
                </span>
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
                    item.status === 'saved' ? 'border-emerald-100'
                    : ['pending_id', 'unknown_code', 'conflict'].includes(item.status) ? 'border-amber-200'
                    : item.status === 'error' || item.status === 'wrong_exam' ? 'border-red-200'
                    : 'border-gray-200'
                  }`}
                >
                  <img src={item.dataUrl} alt="" className="w-12 h-12 object-cover rounded-md border border-gray-200" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 truncate max-w-[240px]">{item.fileName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
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
                      <button onClick={() => onResolveConflict(item)} className="btn btn-sm btn-primary">
                        Sobrescrever
                      </button>
                    )}
                    {(item.status === 'pending_id' || item.status === 'unknown_code') && (
                      <button onClick={() => onReviewManually(item)} className="btn btn-sm btn-secondary">
                        Revisar
                      </button>
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
