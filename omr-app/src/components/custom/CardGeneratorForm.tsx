import { useEffect, useState } from 'react';
import { AlertTriangle, Info, Loader2, Sparkles } from 'lucide-react';
import type { Exam } from '../../types';
import { syncExam } from '../../utils/api';
import {
  generateCustomTemplateFromSpec,
  previewGeneratedCard,
  type CardSpec,
  type CustomTemplateDetail,
  type GeneratePreviewResult,
} from '../../utils/custom-template-api';
import { useToast } from '../ui/Toast';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';

const QUESTION_PRESETS = [10, 20, 30, 40, 50, 60, 80, 100];

const FIELD_OPTIONS = [
  { value: 'student_name', label: 'Nome do aluno' },
  { value: 'matricula', label: 'Matrícula' },
  { value: 'turma', label: 'Turma' },
  { value: 'exam_title', label: 'Prova' },
  { value: 'subject', label: 'Disciplina' },
  { value: 'date', label: 'Data' },
  { value: 'code', label: 'Código do cartão' },
];

const DEFAULT_SPEC: CardSpec = {
  page_format: 'A4',
  orientation: 'portrait',
  margin_mm: 10,
  title: 'Cartão-resposta',
  subtitle: '',
  instructions: '',
  fields: ['student_name', 'matricula', 'turma'],
  n_questions: 20,
  n_options: 4,
  columns: 1,
  start_question: 1,
  bubble_mm: 5,
  option_gap_mm: 3,
  row_gap_mm: 2,
  column_gap_mm: 12,
  shape: 'circle',
  anchors: true,
  anchor_mm: 10,
  qr: true,
  qr_mm: 22,
};

function numOrUndefined(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Gerador de cartão do zero: configura, vê a prévia real e grava o modelo. */
export default function CardGeneratorForm({
  exams, onCreated, onCancel,
}: {
  exams: Exam[];
  onCreated: (d: CustomTemplateDetail) => void;
  onCancel: () => void;
}) {
  const { notify } = useToast();
  const [nome, setNome] = useState('Cartão-resposta');
  const [examId, setExamId] = useState('');
  const [spec, setSpec] = useState<CardSpec>({ ...DEFAULT_SPEC });
  const [preview, setPreview] = useState<GeneratePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof CardSpec>(key: K, value: CardSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  const toggleField = (source: string) => {
    const cur = spec.fields ?? [];
    set('fields', cur.includes(source) ? cur.filter((f) => f !== source) : [...cur, source]);
  };

  // Prévia real (renderizada pelo backend), com debounce para não martelar a API.
  useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      previewGeneratedCard(spec)
        .then((r) => {
          if (cancelled) return;
          setPreview(r);
          setPreviewError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : 'Falha ao gerar a prévia');
        })
        .finally(() => { if (!cancelled) setPreviewing(false); });
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [spec]);

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const exam = exams.find((e) => e.id === examId);
      if (exam) await syncExam(exam).catch(() => undefined);
      const d = await generateCustomTemplateFromSpec(
        spec, nome.trim() || 'Cartão-resposta', exam?.id,
      );
      notify('Cartão gerado e pronto para ler.', 'success');
      onCreated(d);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Falha ao gerar o cartão', 'error');    } finally {
      setBusy(false);
    }
  };

  const customPage = spec.page_format === 'custom';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] items-start">
      {/* Prévia */}
      <div className="card order-1 lg:order-2 lg:sticky lg:top-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="label mb-0">Prévia</p>
          {previewing && <Loader2 size={14} className="animate-spin text-gray-400" aria-hidden />}
        </div>
        <div className="rounded-lg border border-line dark:border-gray-800 bg-gray-100 dark:bg-gray-800/60 p-2 flex justify-center min-h-[240px]">
          {preview?.image ? (
            <img src={preview.image} alt="Prévia do cartão"
                 className="max-h-[70vh] w-auto shadow-sm bg-white" />
          ) : previewError ? (
            <p className="text-xs text-red-600 self-center px-3 text-center">{previewError}</p>
          ) : (
            <p className="text-xs text-gray-500 self-center">Gerando prévia…</p>
          )}
        </div>
        {preview && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {preview.summary.n_questions} questão(ões) · {preview.summary.n_blocks} bloco(s) ·
            {' '}{preview.summary.n_anchors} âncora(s){preview.summary.has_qr ? ' · QR' : ''} ·
            {' '}{preview.summary.page_w}×{preview.summary.page_h} px
          </p>
        )}
        {preview?.warnings.map((w, i) => (
          <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <Info size={12} className="mt-0.5 shrink-0" aria-hidden />{w}
          </p>
        ))}
        {preview?.issues.filter((i) => i.level === 'error').map((i, k) => (
          <p key={k} className="flex items-start gap-1.5 text-[11px] text-red-600">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{i.message}
          </p>
        ))}
      </div>

      {/* Configurações */}
      <div className="card order-2 lg:order-1 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome do cartão" htmlFor="gen-nome">
            <Input id="gen-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </Field>
          {exams.length > 0 && (
            <Field label="Vincular à prova (opcional)" htmlFor="gen-exam">
              <Select id="gen-exam" value={examId} onChange={(e) => setExamId(e.target.value)}>
                <option value="">Nenhuma</option>
                {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <section className="space-y-3">
          <p className="text-sm font-semibold text-ink dark:text-white">Página</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Formato" htmlFor="gen-format">
              <Select id="gen-format" value={spec.page_format}
                      onChange={(e) => set('page_format', e.target.value as CardSpec['page_format'])}>
                <option value="A4">A4 (210×297 mm)</option>
                <option value="A5">A5 (148×210 mm)</option>
                <option value="Letter">Carta (216×279 mm)</option>
                <option value="Oficio">Ofício (216×330 mm)</option>
                <option value="custom">Personalizado</option>
              </Select>
            </Field>
            <Field label="Orientação" htmlFor="gen-orient">
              <Select id="gen-orient" value={spec.orientation}
                      onChange={(e) => set('orientation', e.target.value as CardSpec['orientation'])}>
                <option value="portrait">Retrato</option>
                <option value="landscape">Paisagem</option>
              </Select>
            </Field>
          </div>
          {customPage && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Largura (mm)" htmlFor="gen-pw">
                <Input id="gen-pw" type="number" min={50} max={1000} value={spec.page_w_mm ?? ''}
                       onChange={(e) => set('page_w_mm', numOrUndefined(e.target.value))} />
              </Field>
              <Field label="Altura (mm)" htmlFor="gen-ph">
                <Input id="gen-ph" type="number" min={50} max={1000} value={spec.page_h_mm ?? ''}
                       onChange={(e) => set('page_h_mm', numOrUndefined(e.target.value))} />
              </Field>
            </div>
          )}
          <Field label="Margem (mm)" htmlFor="gen-margin">
            <Input id="gen-margin" type="number" min={3} max={40} value={spec.margin_mm ?? ''}
                   onChange={(e) => set('margin_mm', numOrUndefined(e.target.value))} />
          </Field>
        </section>

        <section className="space-y-3 border-t border-line dark:border-gray-800 pt-3">
          <p className="text-sm font-semibold text-ink dark:text-white">Questões</p>
          <div className="flex flex-wrap gap-1.5">
            {QUESTION_PRESETS.map((n) => (
              <button key={n} type="button"
                      onClick={() => set('n_questions', n)}
                      className={`px-2.5 py-1 rounded border text-xs transition-colors ${
                        spec.n_questions === n
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
                          : 'border-line dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-400'
                      }`}>
                {n}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Questões" htmlFor="gen-nq">
              <Input id="gen-nq" type="number" min={1} max={200} value={spec.n_questions ?? ''}
                     onChange={(e) => set('n_questions', numOrUndefined(e.target.value))} />
            </Field>
            <Field label="Alternativas por questão" htmlFor="gen-nopt">
              <Input id="gen-nopt" type="number" min={2} max={10} value={spec.n_options ?? ''}
                     onChange={(e) => set('n_options', numOrUndefined(e.target.value))} />
            </Field>
            <Field label="Colunas" htmlFor="gen-cols" helper="Mais colunas cabem mais questões.">
              <Select id="gen-cols" value={String(spec.columns ?? 1)}
                      onChange={(e) => set('columns', Number(e.target.value))}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </Select>
            </Field>
            <Field label="Numeração inicial" htmlFor="gen-start">
              <Input id="gen-start" type="number" min={1} max={10000} value={spec.start_question ?? ''}
                     onChange={(e) => set('start_question', numOrUndefined(e.target.value))} />
            </Field>
          </div>
        </section>

        <section className="space-y-3 border-t border-line dark:border-gray-800 pt-3">
          <p className="text-sm font-semibold text-ink dark:text-white">Aparência</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Diâmetro da bolha (mm)" htmlFor="gen-bubble">
              <Input id="gen-bubble" type="number" min={3} max={20} step={0.5} value={spec.bubble_mm ?? ''}
                     onChange={(e) => set('bubble_mm', numOrUndefined(e.target.value))} />
            </Field>
            <Field label="Formato" htmlFor="gen-shape">
              <Select id="gen-shape" value={spec.shape}
                      onChange={(e) => set('shape', e.target.value as CardSpec['shape'])}>
                <option value="circle">Círculo</option>
                <option value="square">Quadrado</option>
              </Select>
            </Field>
            <Field label="Espaço entre alternativas (mm)" htmlFor="gen-gapx">
              <Input id="gen-gapx" type="number" min={1} max={20} step={0.5} value={spec.option_gap_mm ?? ''}
                     onChange={(e) => set('option_gap_mm', numOrUndefined(e.target.value))} />
            </Field>
            <Field label="Espaço entre questões (mm)" htmlFor="gen-gapy">
              <Input id="gen-gapy" type="number" min={0.5} max={20} step={0.5} value={spec.row_gap_mm ?? ''}
                     onChange={(e) => set('row_gap_mm', numOrUndefined(e.target.value))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Âncoras OMR" htmlFor="gen-anchors">
              <div className="flex items-center gap-2">
                <input id="gen-anchors" type="checkbox" checked={spec.anchors !== false}
                       onChange={(e) => set('anchors', e.target.checked)} />
                <span className="text-xs text-gray-600 dark:text-gray-300">ArUco nos 4 cantos</span>
              </div>
            </Field>
            <Field label="Tamanho da âncora (mm)" htmlFor="gen-anchor-mm">
              <Input id="gen-anchor-mm" type="number" min={5} max={25} step={0.5}
                     value={spec.anchor_mm ?? ''} disabled={spec.anchors === false}
                     onChange={(e) => set('anchor_mm', numOrUndefined(e.target.value))} />
            </Field>
            <Field label="QR Code" htmlFor="gen-qr">
              <div className="flex items-center gap-2">
                <input id="gen-qr" type="checkbox" checked={spec.qr !== false}
                       onChange={(e) => set('qr', e.target.checked)} />
                <span className="text-xs text-gray-600 dark:text-gray-300">Identifica o aluno</span>
              </div>
            </Field>
            <Field label="Tamanho do QR (mm)" htmlFor="gen-qr-mm">
              <Input id="gen-qr-mm" type="number" min={10} max={60} step={1}
                     value={spec.qr_mm ?? ''} disabled={spec.qr === false}
                     onChange={(e) => set('qr_mm', numOrUndefined(e.target.value))} />
            </Field>
          </div>
        </section>

        <section className="space-y-3 border-t border-line dark:border-gray-800 pt-3">
          <p className="text-sm font-semibold text-ink dark:text-white">Cabeçalho</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Escola" htmlFor="gen-school" helper="Texto fixo do cartão.">
              <Input id="gen-school" value={spec.school ?? ''}
                     onChange={(e) => set('school', e.target.value)} />
            </Field>
            <Field label="Professor(a)" htmlFor="gen-teacher">
              <Input id="gen-teacher" value={spec.teacher ?? ''}
                     onChange={(e) => set('teacher', e.target.value)} />
            </Field>
          </div>
          <Field label="Título" htmlFor="gen-title">
            <Input id="gen-title" value={spec.title ?? ''}
                   onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Subtítulo" htmlFor="gen-sub">
            <Input id="gen-sub" value={spec.subtitle ?? ''}
                   onChange={(e) => set('subtitle', e.target.value)} />
          </Field>
          <Field label="Instruções" htmlFor="gen-instr" helper="Uma linha por linha do texto.">
            <textarea id="gen-instr" className="input" rows={2} value={spec.instructions ?? ''}
                      onChange={(e) => set('instructions', e.target.value)} />
          </Field>
          <div>
            <span className="label">Campos de identificação</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {FIELD_OPTIONS.map((f) => (
                <label key={f.value} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={(spec.fields ?? []).includes(f.value)}
                         onChange={() => toggleField(f.value)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2 border-t border-line dark:border-gray-800 pt-3">
          <Button onClick={() => void handleGenerate()} loading={busy}
                  disabled={!preview || previewing}
                  icon={<Sparkles size={16} aria-hidden />}>
            Gerar cartão
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}
