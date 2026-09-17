import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { PDFViewer, PDFDownloadLink } from '@react-pdf/renderer';
import { AppView, Exam, SaeSpec, DEFAULT_SAE_SPEC, isSaeExam } from '../types';
import { getExam, getExams, saveExam } from '../utils/storage';
import { generateBlankCard, checkHealth, syncExam } from '../utils/api';
import AnswerCard from '../components/AnswerCard';
import CardPdfDocument from '../components/pdf/CardPdfDocument';
import { useAuth } from '../context/AuthContext';

interface Props {
  examId: string | null;
  onNavigate: (view: AppView, examId?: string) => void;
}

export default function GenerateCardPage({ examId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;

  const exams = getExams(userId);
  const exam = examId ? getExam(examId, userId) : null;
  const [selectedExamId, setSelectedExamId] = useState(examId || '');
  const [cardId] = useState(() => uuidv4().slice(0, 8).toUpperCase());
  const [showPreview, setShowPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [loadingPng, setLoadingPng] = useState(false);
  const [saeSpec, setSaeSpec] = useState<SaeSpec>({ ...DEFAULT_SAE_SPEC });

  useEffect(() => {
    if (examId) setSelectedExamId(examId);
  }, [examId]);

  const activeExam: Exam | undefined = selectedExamId
    ? exams.find(e => e.id === selectedExamId)
    : exam ?? undefined;

  const isSae = isSaeExam(activeExam);

  // Carrega o cabeçalho SAE salvo na prova ao trocar de prova
  useEffect(() => {
    setSaeSpec({ ...DEFAULT_SAE_SPEC, ...(activeExam?.saeSpec ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExamId]);

  const setSae = (patch: Partial<SaeSpec>) => setSaeSpec(prev => ({ ...prev, ...patch }));
  const setSaeTitulo = (i: number, v: string) =>
    setSaeSpec(prev => ({ ...prev, titulo: prev.titulo.map((t, j) => (j === i ? v : t)) }));

  const persistSae = () => {
    if (!activeExam) return;
    const updated: Exam = {
      ...activeExam,
      saeSpec: { ...saeSpec },
      subjectLP: saeSpec.disciplina.trim() || activeExam.subjectLP,
      subjectMat: saeSpec.disciplina.trim() || activeExam.subjectMat,
    };
    saveExam(updated, userId);
    // Sincroniza o cabeçalho com o backend para o PDF em lote por alunos
    syncExam(updated).catch(() => {});
  };

  // PNG oficial do backend para o preview react-pdf (mesma imagem dos gabaritos)
  useEffect(() => {
    if (!showPreview || !activeExam) {
      setPngUrl(null);
      return;
    }
    let cancelled = false;
    const urlRef: { current: string | null } = { current: null };
    setLoadingPng(true);
    (async () => {
      try {
        if (!(await checkHealth())) return;
        const blob = await generateBlankCard(
          activeExam.subjectLP,
          activeExam.layoutMode === 'single' ? '' : activeExam.subjectMat,
          'PNG',
          { questionsPerSubject: activeExam.questionsPerSubject, layoutMode: activeExam.layoutMode, template: activeExam.templateType ?? 'padrao', sae: isSae ? saeSpec : undefined },
        );
        if (cancelled) return;
        urlRef.current = URL.createObjectURL(blob);
        setPngUrl(urlRef.current);
      } catch {
        if (!cancelled) setPngUrl(null);
      } finally {
        if (!cancelled) setLoadingPng(false);
      }
    })();
    return () => {
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, activeExam?.id, activeExam?.subjectLP, activeExam?.subjectMat, activeExam?.questionsPerSubject, activeExam?.layoutMode, activeExam?.templateType, JSON.stringify(saeSpec)]);

  // PDF oficial do backend (mesmo desenho dos gabaritos personalizados)
  const buildServerPdf = async (): Promise<Blob | null> => {
    try {
      if (!activeExam) return null;
      if (!(await checkHealth())) return null;
      return await generateBlankCard(
        activeExam.subjectLP,
        activeExam.layoutMode === 'single' ? '' : activeExam.subjectMat,
        'PDF',
        { questionsPerSubject: activeExam.questionsPerSubject, layoutMode: activeExam.layoutMode, template: activeExam.templateType ?? 'padrao', sae: isSae ? saeSpec : undefined },
      );
    } catch {
      return null;
    }
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handlePrint = async () => {
    // Abre o PDF do servidor em nova aba para impressão; fallback: impressão do DOM
    const blob = await buildServerPdf();
    if (blob && blob.type.includes('pdf')) {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setSourceNote('PDF oficial do servidor aberto para impressão.');
    } else {
      window.print();
      setSourceNote('Impresso a partir da prévia do navegador (backend indisponível).');
    }
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    setSourceNote(null);
    try {
      const blob = await buildServerPdf();
      if (blob) {
        downloadBlob(blob, `${isSae ? 'cartao-sae' : 'cartao-resposta'}-${cardId}.pdf`);
        setSourceNote('PDF gerado pelo servidor — idêntico aos gabaritos oficiais (sem QR/nome).');
        return;
      }

      // Fallback offline: rasteriza a prévia DOM (carregado sob demanda)
      const el = document.getElementById('print-card');
      if (!el) return;
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(el, { scale: 3, backgroundColor: '#ffffff' });
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      pdf.save(`cartao-resposta-${cardId}.pdf`);
      setSourceNote('Gerado no navegador (backend Python indisponível).');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="no-print">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900">Gerar Cartão-Resposta</h1>
          <button onClick={() => onNavigate('import-students')} className="btn btn-secondary btn-sm">
            Gerar por Lista de Alunos →
          </button>
        </div>
        <p className="text-gray-500 mb-6">Gere o cartão em formato A4 para impressão</p>

        {!showPreview && (
          <div className="card max-w-2xl mb-8">
            <div className="space-y-4">
              <div>
                <label className="label">Selecione a Prova</label>
                {exams.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    <p>Nenhuma prova cadastrada.</p>
                    <button onClick={() => onNavigate('new-exam')} className="btn btn-primary btn-sm mt-2">
                      Criar Nova Prova
                    </button>
                  </div>
                ) : (
                  <select
                    className="input"
                    value={selectedExamId}
                    onChange={(e) => setSelectedExamId(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {exams.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {activeExam && (
                <div className="bg-gray-50 rounded-lg p-4 text-sm">
                  <p><strong>Prova:</strong> {activeExam.name}</p>
                  {isSae ? (
                    <>
                      <p><strong>Modelo:</strong> Avaliação Contínua (cabeçalho editável abaixo)</p>
                      <p><strong>Questões:</strong> {activeExam.questionsPerSubject}</p>
                    </>
                  ) : (
                    <>
                      <p><strong>Disciplinas:</strong> {activeExam.subjectLP} e {activeExam.subjectMat}</p>
                      <p><strong>Questões por disciplina:</strong> {activeExam.questionsPerSubject}</p>
                    </>
                  )}
                  <p className="text-xs text-gray-400 mt-2">ID do cartão: {cardId}</p>
                </div>
              )}

              {activeExam && isSae && (
                <div className="border border-violet-200 rounded-lg p-4 space-y-3 bg-violet-50/50">
                  <p className="text-sm font-medium text-violet-800">Cabeçalho do cartão — Avaliação Contínua</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Ano</label>
                      <input className="input" value={saeSpec.ano} onChange={(e) => setSae({ ano: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Caderno</label>
                      <input className="input" value={saeSpec.caderno} onChange={(e) => setSae({ caderno: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Programa (linha 1)</label>
                    <input className="input" value={saeSpec.programa_linha1} onChange={(e) => setSae({ programa_linha1: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Programa (linha 2)</label>
                    <input className="input" value={saeSpec.programa_linha2} onChange={(e) => setSae({ programa_linha2: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Título (4 linhas)</label>
                    <div className="space-y-2">
                      {saeSpec.titulo.map((t, i) => (
                        <input key={i} className="input" value={t} onChange={(e) => setSaeTitulo(i, e.target.value)} />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Disciplina</label>
                      <input className="input" value={saeSpec.disciplina} onChange={(e) => setSae({ disciplina: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Série</label>
                      <input className="input" value={saeSpec.serie} onChange={(e) => setSae({ serie: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">QR Code (texto)</label>
                      <input className="input font-mono" value={saeSpec.qr_payload} onChange={(e) => setSae({ qr_payload: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Código de barras (texto)</label>
                      <input className="input font-mono" value={saeSpec.codigo_barras} onChange={(e) => setSae({ codigo_barras: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => { if (isSae) persistSae(); setShowPreview(true); }}
                disabled={!selectedExamId}
                className="btn btn-primary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Visualizar Cartão
              </button>
            </div>
          </div>
        )}

        {showPreview && activeExam && (
          <div className="flex gap-3 mb-4">
            <button onClick={handlePrint} className="btn btn-success">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimir
            </button>
            <button onClick={handleDownloadPdf} disabled={downloading} className="btn btn-primary">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {downloading ? 'Gerando...' : 'Baixar PDF'}
            </button>
            <button onClick={() => setShowPreview(false)} className="btn btn-secondary">
              Voltar
            </button>
          </div>
        )}

        {showPreview && activeExam && (
          <p className="text-xs text-gray-400 mt-2">
            {sourceNote ?? 'O PDF é gerado pelo servidor com o mesmo desenho dos gabaritos oficiais (sem QR/nome de aluno).'}
          </p>
        )}

        {showPreview && activeExam && (
          <div className="bg-gray-200 dark:bg-gray-800 p-4 rounded-xl overflow-auto flex justify-center">
            {pngUrl ? (
              <div className="w-full max-w-3xl">
                <PDFViewer width="100%" height={800} showToolbar style={{ border: 'none', borderRadius: 12 }}>
                  <CardPdfDocument pngUrl={pngUrl} title={`Cartao-resposta ${cardId}`} />
                </PDFViewer>
                <div className="mt-3 flex justify-center">
                  <PDFDownloadLink
                    document={<CardPdfDocument pngUrl={pngUrl} title={`Cartao-resposta ${cardId}`} />}
                    fileName={`cartao-resposta-${cardId}.pdf`}
                    className="btn btn-secondary btn-sm min-h-[44px]"
                  >
                    {({ loading }) => (loading ? 'Preparando PDF...' : 'Baixar via react-pdf (offline)')}
                  </PDFDownloadLink>
                </div>
              </div>
            ) : isSae ? (
              <div className="print-answer-card shadow-2xl flex items-center justify-center p-8 text-center text-sm text-gray-500">
                {loadingPng
                  ? 'Carregando prévia do servidor...'
                  : 'A prévia do cartão “Avaliação Contínua” é gerada pelo backend Python. Verifique se o backend está rodando e recarregue a página.'}
              </div>
            ) : (
              <div className="print-answer-card shadow-2xl" style={{ position: 'relative' }}>
                {loadingPng ? (
                  <div className="flex items-center justify-center h-full text-sm text-gray-500">Carregando prévia do servidor...</div>
                ) : (
                  <AnswerCard exam={activeExam} cardId={cardId} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showPreview && activeExam && !isSae && (
        <div id="print-card" className="print-answer-card" style={{ position: 'fixed', left: -10000, top: 0, zIndex: -1 }}>
          <AnswerCard exam={activeExam} cardId={cardId} />
        </div>
      )}
    </div>
  );
}
