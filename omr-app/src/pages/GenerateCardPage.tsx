import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { PDFViewer, PDFDownloadLink } from '@react-pdf/renderer';
import { ArrowLeft, Download, Eye, Printer, Users } from 'lucide-react';
import { AppView, Exam, SaeSpec, DEFAULT_SAE_SPEC, DEFAULT_HERBY_SPEC, HerbySpec, isSaeExam, isHerbyExam, isSimuladoExam, templateLabel } from '../types';
import { getExam, getExams, saveExam } from '../utils/storage';
import { generateBlankCard, checkHealth, syncExam } from '../utils/api';
import AnswerCard from '../components/AnswerCard';
import CardPdfDocument from '../components/pdf/CardPdfDocument';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';

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
const isHerby = isHerbyExam(activeExam);
const isColar = activeExam?.templateType === 'colar';
const isSimulado = isSimuladoExam(activeExam);

// Carrega o cabeçalho SAE salvo na prova ao trocar de prova
const [herbySpec, setHerbySpec] = useState<HerbySpec>({ ...DEFAULT_HERBY_SPEC });

  useEffect(() => {
    setSaeSpec({ ...DEFAULT_SAE_SPEC, ...(activeExam?.saeSpec ?? {}) });
    setHerbySpec({ ...DEFAULT_HERBY_SPEC, ...(activeExam?.herbySpec ?? {}) });
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

  const persistHerby = () => {
    if (!activeExam) return;
    const updated: Exam = { ...activeExam, herbySpec: { ...herbySpec } };
    saveExam(updated, userId);
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
          { questionsPerSubject: activeExam.questionsPerSubject, layoutMode: activeExam.layoutMode, template: activeExam.templateType ?? 'padrao', sae: isSae ? saeSpec : undefined, herby: isHerby ? herbySpec : undefined, turma: activeExam.turma || activeExam.name },
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
  }, [showPreview, activeExam?.id, activeExam?.name, activeExam?.subjectLP, activeExam?.subjectMat, activeExam?.questionsPerSubject, activeExam?.layoutMode, activeExam?.templateType, JSON.stringify(saeSpec), JSON.stringify(herbySpec)]);

  // PDF oficial do backend (mesmo desenho dos gabaritos personalizados)
  const buildServerPdf = async (): Promise<Blob | null> => {
    try {
      if (!activeExam) return null;
      if (!(await checkHealth())) return null;
      return await generateBlankCard(
        activeExam.subjectLP,
        activeExam.layoutMode === 'single' ? '' : activeExam.subjectMat,
        'PDF',
        { questionsPerSubject: activeExam.questionsPerSubject, layoutMode: activeExam.layoutMode, template: activeExam.templateType ?? 'padrao', sae: isSae ? saeSpec : undefined, herby: isHerby ? herbySpec : undefined, turma: activeExam.turma || activeExam.name },
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
        downloadBlob(blob, `${isColar ? 'colar-avaliacao' : isSae ? 'cartao-sae' : isHerby ? 'cartao-herby' : isSimulado ? 'cartao-simulado' : 'cartao-resposta'}-${cardId}.pdf`);
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
    <div className="space-y-6 animate-fade-in">
      <div className="no-print">
        <PageHeader
          title="Gerar cartão-resposta"
          subtitle="Gere o cartão em formato A4 para impressão"
          actions={
            <Button variant="secondary" size="sm" onClick={() => onNavigate('import-students')} icon={<Users size={15} aria-hidden />}>
              Cartões por lista da prova
            </Button>
          }
        />

        {!showPreview && (
          <div className="card max-w-2xl">
            <div className="space-y-4">
              <Field label="Selecione a prova" htmlFor="card-exam-select">
                {exams.length === 0 ? (
                  <EmptyState
                    title="Nenhuma prova cadastrada"
                    action={<Button size="sm" onClick={() => onNavigate('new-exam')}>Criar nova prova</Button>}
                  />
                ) : (
                  <Select
                    id="card-exam-select"
                    value={selectedExamId}
                    onChange={(e) => setSelectedExamId(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {exams.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </Select>
                )}
              </Field>

              {activeExam && (
                <div className="bg-surface dark:bg-gray-800/60 rounded-lg p-4 text-sm">
                  <p className="text-ink dark:text-gray-100"><strong>Prova:</strong> {activeExam.name}</p>
                  {isColar ? (
                    <>
                      <p className="text-gray-600 dark:text-gray-300 mt-1"><strong>Modelo:</strong> Colar em Avaliação (só o gabarito, sem cabeçalho)</p>
                      <p className="text-gray-600 dark:text-gray-300"><strong>Questões:</strong> {activeExam.questionsPerSubject}</p>
                    </>
                  ) : isSimulado ? (
                    <>
                      <p className="text-gray-600 dark:text-gray-300 mt-1"><strong>Modelo:</strong> Simulado (só a tabela · réguas como âncora · sem QR/nome/turma)</p>
                      <p className="text-gray-600 dark:text-gray-300"><strong>Questões:</strong> {activeExam.questionsPerSubject} fixas</p>
                    </>
                  ) : isSae ? (
                    <>
                      <p className="text-gray-600 dark:text-gray-300 mt-1"><strong>Modelo:</strong> Avaliação Contínua (cabeçalho editável abaixo)</p>
                      <p className="text-gray-600 dark:text-gray-300"><strong>Questões:</strong> {activeExam.questionsPerSubject}</p>
                    </>
                  ) : activeExam.layoutMode === 'single' ? (
                    <>
                      <p className="text-gray-600 dark:text-gray-300 mt-1"><strong>Disciplina:</strong> {activeExam.subjectLP}{isHerby ? ' (Herby 1 disciplina — metade esquerda)' : ''}</p>
                      <p className="text-gray-600 dark:text-gray-300"><strong>Questões:</strong> {activeExam.questionsPerSubject}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-gray-600 dark:text-gray-300 mt-1"><strong>Disciplinas:</strong> {activeExam.subjectLP} e {activeExam.subjectMat}</p>
                      <p className="text-gray-600 dark:text-gray-300"><strong>Questões por disciplina:</strong> {activeExam.questionsPerSubject}</p>
                    </>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">ID do cartão: {cardId}</p>
                </div>
              )}

              {activeExam && isSae && (
                <div className="border border-brand-500/30 rounded-lg p-4 space-y-3 bg-brand-50/50 dark:bg-brand-700/10">
                  <p className="text-sm font-medium text-brand-800 dark:text-brand-200">Cabeçalho do cartão — Avaliação Contínua</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Ano" htmlFor="sae-ano">
                      <Input id="sae-ano" value={saeSpec.ano} onChange={(e) => setSae({ ano: e.target.value })} />
                    </Field>
                    <Field label="Caderno" htmlFor="sae-caderno">
                      <Input id="sae-caderno" value={saeSpec.caderno} onChange={(e) => setSae({ caderno: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Programa (linha 1)" htmlFor="sae-prog1">
                    <Input id="sae-prog1" value={saeSpec.programa_linha1} onChange={(e) => setSae({ programa_linha1: e.target.value })} />
                  </Field>
                  <Field label="Programa (linha 2)" htmlFor="sae-prog2">
                    <Input id="sae-prog2" value={saeSpec.programa_linha2} onChange={(e) => setSae({ programa_linha2: e.target.value })} />
                  </Field>
                  <div>
                    <span className="label">Título (4 linhas)</span>
                    <div className="space-y-2">
                      {saeSpec.titulo.map((t, i) => (
                        <Input key={i} aria-label={`Título linha ${i + 1}`} value={t} onChange={(e) => setSaeTitulo(i, e.target.value)} />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Disciplina" htmlFor="sae-disc">
                      <Input id="sae-disc" value={saeSpec.disciplina} onChange={(e) => setSae({ disciplina: e.target.value })} />
                    </Field>
                    <Field label="Série" htmlFor="sae-serie">
                      <Input id="sae-serie" value={saeSpec.serie} onChange={(e) => setSae({ serie: e.target.value })} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="QR Code (texto)" htmlFor="sae-qr">
                      <Input id="sae-qr" className="font-mono" value={saeSpec.qr_payload} onChange={(e) => setSae({ qr_payload: e.target.value })} />
                    </Field>
                    <Field label="Código de barras (texto)" htmlFor="sae-bar">
                      <Input id="sae-bar" className="font-mono" value={saeSpec.codigo_barras} onChange={(e) => setSae({ codigo_barras: e.target.value })} />
                    </Field>
                  </div>
                </div>
              )}

              <Button
                onClick={() => { if (isSae) persistSae(); if (isHerby) persistHerby(); setShowPreview(true); }}
                disabled={!selectedExamId}
                icon={<Eye size={16} aria-hidden />}
              >
                Visualizar cartão
              </Button>
            </div>
          </div>
        )}

        {showPreview && activeExam && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="success" onClick={handlePrint} icon={<Printer size={16} aria-hidden />}>
              Imprimir
            </Button>
            <Button onClick={handleDownloadPdf} loading={downloading} icon={<Download size={16} aria-hidden />}>
              Baixar PDF
            </Button>
            <Button variant="secondary" onClick={() => setShowPreview(false)} icon={<ArrowLeft size={16} aria-hidden />}>
              Voltar
            </Button>
          </div>
        )}

        {showPreview && activeExam && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
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
            ) : isSae || isColar || isSimulado ? (
              <div className="print-answer-card shadow-2xl flex items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {loadingPng
                  ? 'Carregando prévia do servidor...'
                  : `A prévia do cartão "${templateLabel(activeExam.templateType)}" é gerada pelo backend Python. Verifique se o backend está rodando e recarregue a página.`}
              </div>
            ) : (
              <div className="print-answer-card shadow-2xl" style={{ position: 'relative' }}>
                {loadingPng ? (
                  <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">Carregando prévia do servidor...</div>
                ) : (
                  <AnswerCard exam={activeExam} cardId={cardId} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showPreview && activeExam && !isSae && !isColar && !isSimulado && (
        <div id="print-card" className="print-answer-card" style={{ position: 'fixed', left: -10000, top: 0, zIndex: -1 }}>
          <AnswerCard exam={activeExam} cardId={cardId} />
        </div>
      )}
    </div>
  );
}
