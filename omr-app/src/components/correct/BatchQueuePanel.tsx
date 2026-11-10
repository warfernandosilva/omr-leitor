import { Eye, ImagePlus, PenLine, Play, Trash2 } from 'lucide-react';
import type { Exam } from '../../types';
import Field from '../ui/Field';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

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

interface Props {
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

/** Fila de correção em lote: upload, progresso e ações por cartão. */
export default function BatchQueuePanel({
  exams, selectedExamId, onExamChange, items, running,
  error, onFiles, onStart, onResolveConflict, onReviewManually, onClear, fileInputRef,
}: Props) {
  const exam = selectedExamId ? exams.find(e => e.id === selectedExamId) : undefined;
  const processed = items.filter(i => i.status !== 'pending' && i.status !== 'processing').length;
  const savedCount = items.filter(i => i.status === 'saved').length;
  const problemCount = items.filter(i =>
    ['pending_id', 'unknown_code', 'wrong_exam', 'conflict', 'error'].includes(i.status)
  ).length;

  return (
    <div className="space-y-4">
      <div className="card max-w-4xl space-y-4">
        <div className="callout-info">
          <strong>Correção em lote:</strong> cada foto é identificada pelo QR Code do cartão — a ordem
          das fotos não importa. Fotos com QR válido são corrigidas e salvas automaticamente; problemas
          ficam na fila abaixo para revisão manual.
        </div>

        <Field label="Selecione a prova" required>
          {exams.length === 0 ? (
            <p className="text-sm text-[#71809A] dark:text-gray-400">Nenhuma prova cadastrada.</p>
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
            <ImagePlus size={28} strokeWidth={1.5} className="text-[#71809A] dark:text-gray-400 mx-auto mb-2" aria-hidden />
            <span className="block text-sm font-medium text-[#172B4D] dark:text-gray-200">Selecione uma ou várias fotos</span>
            <p className="text-xs text-[#71809A] dark:text-gray-400 mt-1">.jpg, .png — quantas quiser</p>
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
          <div className="callout-danger">{error}</div>
        )}

        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-[#172B4D] dark:text-gray-200">{items.length} foto(s) na fila</span>
            {running && (
              <span className="inline-flex items-center gap-2 text-sm text-brand-600 dark:text-brand-200">
                <span className="animate-spin w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full" />
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
          <div className="section-header mb-3">
            <h3 className="text-lg font-semibold text-[#172B4D] dark:text-white">Resultado do lote</h3>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{savedCount} corrigida(s)</Badge>
              {problemCount > 0 && <Badge tone="warning">{problemCount} para revisar</Badge>}
            </div>
          </div>

          <div className="space-y-2">
            {items.map(item => {
              const meta = BATCH_STATUS_META[item.status];
              return (
                <div
                  key={item.fileName}
                  className={`panel flex items-start gap-3 ${
                    item.status === 'saved' ? 'border-success-500/25'
                    : ['pending_id', 'unknown_code', 'conflict'].includes(item.status) ? 'border-warning-500/30'
                    : item.status === 'error' || item.status === 'wrong_exam' ? 'border-danger-500/30'
                    : ''
                  }`}
                >
                  <img src={item.dataUrl} alt="" className="w-12 h-12 object-cover rounded-md border border-line dark:border-gray-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#172B4D] dark:text-white truncate max-w-[240px]">{item.fileName}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <p className="text-xs text-[#71809A] dark:text-gray-400 mt-1">
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
                  <div className="flex shrink-0 gap-1">
                    {item.status === 'conflict' && (
                      <Button size="sm" onClick={() => onResolveConflict(item)}>Sobrescrever</Button>
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
