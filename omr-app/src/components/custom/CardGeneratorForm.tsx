import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ChevronRight, CircleDot, Eye, FileDown,
  FileText, Focus, Info, LayoutGrid, ListChecks, Loader2, MessageSquare, Minus,
  Move, Plus, QrCode, Redo2, RefreshCw, Ruler, Sparkles, Trash2, Type, Undo2, ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Exam } from '../../types';
import { syncExam } from '../../utils/api';
import {
  generateCustomTemplateFromSpec,
  previewGeneratedCard,
  type CardBlockSpec,
  type CardElementSpec,
  type CardSpec,
  type CustomTemplateDetail,
  type GeneratePreviewResult,
} from '../../utils/custom-template-api';
import { useToast } from '../ui/Toast';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';

// ─── Constantes ───────────────────────────────────────────────────────────────

const FIELD_OPTIONS = [
  { value: 'student_name', label: 'Nome do aluno', short: 'Nome' },
  { value: 'matricula', label: 'Matrícula', short: 'Matrícula' },
  { value: 'turma', label: 'Turma', short: 'Turma' },
  { value: 'exam_title', label: 'Prova', short: 'Prova' },
  { value: 'subject', label: 'Disciplina', short: 'Disciplina' },
  { value: 'date', label: 'Data', short: 'Data' },
  { value: 'code', label: 'Código do cartão', short: 'Código' },
] as const;

const LETTERS = 'ABCDEFGHIJ';

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Oficio: [216, 330],
};

const DEFAULT_BLOCK: CardBlockSpec = {
  title: '',
  n_questions: 20,
  labels: ['A', 'B', 'C', 'D'],
  columns: 1,
  start_question: 1,
};

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
  blocks: [DEFAULT_BLOCK],
  elements: [],
};

type StarterKind = 'quiz' | 'exam' | 'survey' | 'blank';

interface Starter {
  kind: StarterKind;
  title: string;
  desc: string;
  tag: string;
  name: string;
  spec: Partial<CardSpec>;
  blocks: CardBlockSpec[];
}

const STARTERS: Starter[] = [
  {
    kind: 'quiz',
    title: 'Questionário',
    desc: '20 questões, de A a D, em duas colunas.',
    tag: 'Múltipla escolha',
    name: 'Questionário · 20 questões',
    spec: {
      title: 'Questionário',
      subtitle: 'Avaliação de múltipla escolha',
      fields: ['student_name', 'turma', 'date'],
      instructions: 'Preencha as bolhas completamente com caneta escura ou lápis.',
      bubble_mm: 5,
      columns: 2,
      qr: true,
      anchors: true,
    },
    blocks: [{ n_questions: 20, labels: ['A', 'B', 'C', 'D'], columns: 2, start_question: 1 }],
  },
  {
    kind: 'exam',
    title: 'Prova final',
    desc: '50 questões, de A a E, com identificação.',
    tag: 'Prova',
    name: 'Prova final · 50 questões',
    spec: {
      title: 'Prova final',
      subtitle: 'Avaliação com identificação do aluno',
      fields: ['student_name', 'matricula', 'turma', 'date'],
      instructions: 'Preencha as bolhas completamente com caneta escura ou lápis.',
      bubble_mm: 4,
      columns: 3,
      qr: true,
      anchors: true,
    },
    blocks: [{
      n_questions: 50,
      labels: ['A', 'B', 'C', 'D', 'E'],
      columns: 3,
      start_question: 1,
    }],
  },
  {
    kind: 'survey',
    title: 'Pesquisa',
    desc: '10 afirmações avaliadas de 1 a 5.',
    tag: 'Pesquisa',
    name: 'Pesquisa · 10 afirmações',
    spec: {
      title: 'Pesquisa de satisfação',
      subtitle: '1 = discordo totalmente  ·  5 = concordo totalmente',
      fields: [],
      instructions: 'Marque uma bolha por afirmação.',
      bubble_mm: 5,
      columns: 1,
      qr: false,
      anchors: true,
    },
    blocks: [{
      n_questions: 10,
      labels: ['1', '2', '3', '4', '5'],
      columns: 1,
      start_question: 1,
    }],
  },
  {
    kind: 'blank',
    title: 'Folha em branco',
    desc: 'Comece do zero e monte do seu jeito.',
    tag: 'Livre',
    name: 'Cartão-resposta',
    spec: {
      title: 'Cartão-resposta',
      subtitle: '',
      fields: ['student_name'],
      instructions: '',
      bubble_mm: 5,
      columns: 1,
      qr: true,
      anchors: true,
    },
    blocks: [{ n_questions: 20, labels: ['A', 'B', 'C', 'D'], columns: 1, start_question: 1 }],
  },
];

type Tab = 'inicio' | 'inserir' | 'layout' | 'exibir';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inicio', label: 'Início' },
  { id: 'inserir', label: 'Inserir' },
  { id: 'layout', label: 'Layout' },
  { id: 'exibir', label: 'Exibir' },
];

const COMPACT = '!min-h-[38px] !py-1.5 text-xs';

interface Snapshot {
  spec: CardSpec;
  nome: string;
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function numOrUndefined(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function labelsFor(n: number): string[] {
  return LETTERS.slice(0, clamp(Math.round(n), 2, LETTERS.length)).split('');
}

function pageDims(spec: CardSpec): [number, number] {
  const base = spec.page_format === 'custom'
    ? [spec.page_w_mm ?? 210, spec.page_h_mm ?? 297]
    : PAGE_SIZES[spec.page_format ?? 'A4'] ?? PAGE_SIZES.A4;
  return spec.orientation === 'landscape' ? [base[1], base[0]] : [base[0], base[1]];
}

// ─── Componentes internos ─────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ToolButton({
  icon, label, onClick, active, disabled, title,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex min-w-[48px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-semibold leading-none transition-colors disabled:opacity-40 ${
        active
          ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
          : 'border-transparent text-gray-600 hover:border-line hover:bg-surface dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800'
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ToolField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-[74px] flex-col justify-center gap-0.5 px-1">
      <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </div>
  );
}

function MiniPage({ kind }: { kind: StarterKind }) {
  if (kind === 'blank') {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-gray-300 bg-white/70 dark:border-gray-600 dark:bg-gray-900/40">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
          <Plus size={22} aria-hidden />
        </span>
      </div>
    );
  }

  const options = kind === 'survey' ? 5 : kind === 'exam' ? 5 : 4;
  const columns = kind === 'survey' ? 1 : kind === 'exam' ? 3 : 2;
  const rows = kind === 'survey' ? 8 : kind === 'exam' ? 9 : 7;

  return (
    <div className="relative flex h-full w-full justify-center overflow-hidden rounded-md border border-line bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="relative aspect-[210/297] h-full bg-white">
        <div className="h-[6px] w-[58%] rounded-sm bg-navy-900/80" />
        <div className="mt-1.5 h-[3px] w-[40%] rounded bg-gray-300" />

        <div className="mt-3 space-y-1.5">
          <div className="flex items-end gap-1">
            <span className="h-[2px] w-5 bg-gray-400" />
            <span className="h-[2px] flex-1 bg-gray-200" />
          </div>
          {(kind === 'exam' || kind === 'quiz') && (
            <div className="flex items-end gap-1">
              <span className="h-[2px] w-5 bg-gray-400" />
              <span className="h-[2px] w-16 bg-gray-200" />
            </div>
          )}
        </div>

        {(kind === 'exam' || kind === 'quiz') && (
          <div className="absolute right-0 top-0 grid h-[14%] w-[14%] grid-cols-3 grid-rows-3 gap-[1px] border border-navy-900/70 p-[2px]">
            {Array.from({ length: 9 }).map((_, i) => (
              <span key={i} className={i % 2 === 0 ? 'bg-navy-900/80' : 'bg-transparent'} />
            ))}
          </div>
        )}

        <div
          className="mt-4 grid gap-x-3 gap-y-1.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-center gap-[3px]">
              <span className="h-[2px] w-[6px] shrink-0 bg-gray-400" />
              {Array.from({ length: options }).map((__, o) => (
                <span
                  key={o}
                  className="h-[5px] w-[5px] shrink-0 rounded-full border border-gray-400"
                />
              ))}
            </div>
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 space-y-1">
          <div className="h-[2px] w-[65%] bg-gray-200" />
          <div className="h-[2px] w-[45%] bg-gray-200" />
        </div>
      </div>
    </div>
  );
}

function ElementCard({
  element, index, onChange, onRemove,
}: {
  element: CardElementSpec;
  index: number;
  onChange: (patch: Partial<CardElementSpec>, coalesce: string) => void;
  onRemove: () => void;
}) {
  const pct = (value: number | undefined) => Math.round((value ?? 0) * 100);
  const setPct = (key: 'x' | 'y' | 'w' | 'h', raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const value = clamp(n, 0, 100) / 100;
    const limited = key === 'w' || key === 'h' ? Math.max(0.01, value) : value;
    onChange({ [key]: limited }, `el-${index}-${key}`);
  };

  return (
    <div className="rounded-lg border border-line p-2.5 dark:border-gray-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          {element.kind === 'text' ? <Type size={13} aria-hidden /> : <Minus size={13} aria-hidden />}
          {element.kind === 'text' ? 'Texto' : 'Linha'} {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="btn-icon !min-h-[26px] !min-w-[26px] text-gray-400 hover:text-danger-600"
          aria-label={`Remover ${element.kind === 'text' ? 'texto' : 'linha'} ${index + 1}`}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>

      {element.kind === 'text' && (
        <>
          <Input
            value={element.text ?? ''}
            placeholder="Texto"
            aria-label="Conteúdo do texto"
            className={`${COMPACT} mb-2`}
            onChange={(e) => onChange({ text: e.target.value }, `el-${index}-text`)}
          />
          <div className="mb-2 grid grid-cols-2 gap-2">
            <div>
              <span className="mb-0.5 block text-[10px] text-gray-400">Fonte (mm)</span>
              <Input
                type="number" min={1.5} max={30} step={0.5}
                value={element.font_mm ?? 4}
                className={COMPACT}
                onChange={(e) => onChange({ font_mm: numOrUndefined(e.target.value) }, `el-${index}-font`)}
              />
            </div>
            <div>
              <span className="mb-0.5 block text-[10px] text-gray-400">Alinhamento</span>
              <Select
                value={element.align ?? 'left'}
                className={COMPACT}
                onChange={(e) => onChange({ align: e.target.value as CardElementSpec['align'] }, `el-${index}-align`)}
              >
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
              </Select>
            </div>
          </div>
          <label className="mb-2 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={element.bold === true}
              onChange={(e) => onChange({ bold: e.target.checked }, `el-${index}-bold`)}
            />
            Negrito
          </label>
        </>
      )}

      <div className="grid grid-cols-4 gap-1.5">
        {(['x', 'y', 'w', 'h'] as const).map((key) => (
          <label key={key} className="block">
            <span className="mb-0.5 block text-[10px] uppercase text-gray-400">{key} %</span>
            <Input
              type="number" min={0} max={100} step={1}
              value={pct(element[key])}
              className={`${COMPACT} !px-1.5 text-center`}
              onChange={(e) => setPct(key, e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function BlockCard({
  block, index, total, onChange, onRemove,
}: {
  block: CardBlockSpec;
  index: number;
  total: number;
  onChange: (patch: Partial<CardBlockSpec>, coalesce: string) => void;
  onRemove: () => void;
}) {
  const nOptions = block.labels?.length ?? 4;
  const setOptions = (raw: string) => {
    const n = clamp(Number(raw) || 4, 2, 10);
    onChange({ labels: labelsFor(n), n_options: n }, `blk-${index}-options`);
  };

  return (
    <div className="space-y-2 rounded-lg border border-line p-2.5 dark:border-gray-700">
      <div className="mb-0 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          <ListChecks size={13} aria-hidden /> Bloco {index + 1}
        </span>
        <button
          type="button"
          disabled={total <= 1}
          onClick={onRemove}
          className="btn-icon !min-h-[26px] !min-w-[26px] text-gray-400 hover:text-danger-600 disabled:opacity-30"
          aria-label={`Remover bloco ${index + 1}`}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>

      <Input
        value={block.title ?? ''}
        placeholder="Título do bloco (opcional)"
        aria-label={`Título do bloco ${index + 1}`}
        className={`${COMPACT} mb-2`}
        onChange={(e) => onChange({ title: e.target.value }, `blk-${index}-title`)}
      />

      <label className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
        <input
          type="checkbox"
          checked={block.show_title !== false}
          onChange={(e) => onChange({ show_title: e.target.checked }, `blk-${index}-show`)}
        />
        Exibir título na folha
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-400">Questões</span>
          <Input
            type="number" min={1} max={200}
            value={block.n_questions ?? ''}
            className={COMPACT}
            onChange={(e) => onChange({ n_questions: numOrUndefined(e.target.value) }, `blk-${index}-nq`)}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-400">Alternativas</span>
          <Input
            type="number" min={2} max={10}
            value={nOptions}
            className={COMPACT}
            onChange={(e) => setOptions(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-400">Colunas</span>
          <Select
            value={String(block.columns ?? 1)}
            className={COMPACT}
            onChange={(e) => onChange({ columns: Number(e.target.value) }, `blk-${index}-cols`)}
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </Select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-400">1ª questão</span>
          <Input
            type="number" min={1} max={10000}
            value={block.start_question ?? 1}
            className={COMPACT}
            onChange={(e) => onChange({ start_question: numOrUndefined(e.target.value) }, `blk-${index}-start`)}
          />
        </label>
      </div>
      <Field label="Orientação da grade" htmlFor={`blk-${index}-dist`} className="mt-2">
        <Select
          id={`blk-${index}-dist`}
          value={block.distribution ?? 'vertical'}
          className={COMPACT}
          onChange={(e) => onChange(
            { distribution: e.target.value === 'horizontal' ? 'horizontal' : 'vertical' },
            `blk-${index}-dist`,
          )}
        >
          <option value="vertical">Vertical (uma questão por linha)</option>
          <option value="horizontal">Horizontal (lado a lado)</option>
        </Select>
      </Field>
      <p className="mt-1.5 text-[10px] text-gray-400">
        {block.labels?.join(' · ') || 'A · B · C · D'}
      </p>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/** Gerador de cartão do zero: modelos, editor visual, prévia real e gravação. */
export default function CardGeneratorForm({
  exams, onCreated, onCancel,
}: {
  exams: Exam[];
  onCreated: (d: CustomTemplateDetail) => void;
  onCancel: () => void;
}) {
  const { notify } = useToast();

  const [mode, setMode] = useState<'gallery' | 'editor'>('gallery');
  const [tab, setTab] = useState<Tab>('inicio');
  const [nome, setNome] = useState('Cartão-resposta');
  const [examId, setExamId] = useState('');
  const [spec, setSpec] = useState<CardSpec>({ ...DEFAULT_SPEC });
  const [zoom, setZoom] = useState(1);
  const [showMargin, setShowMargin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [preview, setPreview] = useState<GeneratePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    kind: 'element';
    index: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  // Histórico (desfazer/refazer) — snapshots leves de spec + nome.
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const [, setHistoryTick] = useState(0);

  const blocks = spec.blocks ?? [];
  const elements = spec.elements ?? [];

  const pushHistory = useCallback((coalesce?: string) => {
    const now = Date.now();
    const same = coalesce
      && lastCoalesce.current?.key === coalesce
      && now - lastCoalesce.current.at < 900;
    if (!same) {
      past.current = [...past.current.slice(-79), { spec, nome }];
      future.current = [];
      setHistoryTick((n) => n + 1);
    }
    lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null;
  }, [spec, nome]);

  const mutate = useCallback((patch: Partial<CardSpec>, coalesce?: string) => {
    pushHistory(coalesce);
    setSpec((prev) => ({ ...prev, ...patch }));
  }, [pushHistory]);

  const rename = (value: string) => {
    pushHistory('nome');
    setNome(value);
  };

  const patchElementAt = (index: number, patch: Partial<CardElementSpec>) =>
    mutate({ elements: elements.map((el, i) => (i === index ? { ...el, ...patch } : el)) }, `drag-${index}`);

  /** Drag & drop de elementos decorativos no canvas (coordenadas normalizadas). */
  const onPagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const dx = (e.clientX - d.startX) / rect.width;
    const dy = (e.clientY - d.startY) / rect.height;
    const el = elements[d.index];
    const nx = clamp(d.origX + dx, 0, Math.max(0, 1 - (d.origW ?? 0.8)));
    const ny = clamp(d.origY + dy, 0, Math.max(0, 1 - (d.origH ?? 0.05)));
    if (el?.kind === 'text') patchElementAt(d.index, { x: nx, y: ny });
    else patchElementAt(d.index, { x: nx, y: ny, w: Math.max(0.01, (d.origW ?? 0.8) - dx) });
  };

  const onPagePointerUp = () => { dragRef.current = null; };

  const startElementDrag = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const el = elements[index];
    if (!el) return;
    dragRef.current = {
      kind: 'element',
      index,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.w,
      origH: el.h,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captura indisponível */ }
  };

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current = [{ spec, nome }, ...future.current].slice(0, 80);
    setSpec(prev.spec);
    setNome(prev.nome);
    lastCoalesce.current = null;
    setHistoryTick((n) => n + 1);
  }, [spec, nome]);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (!next) return;
    past.current = [...past.current.slice(-79), { spec, nome }];
    setSpec(next.spec);
    setNome(next.nome);
    lastCoalesce.current = null;
    setHistoryTick((n) => n + 1);
  }, [spec, nome]);

  // Atalhos Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y.
  useEffect(() => {
    if (mode !== 'editor') return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, undo, redo]);

  // Prévia real renderizada pelo backend, com debounce.
  useEffect(() => {
    if (mode !== 'editor') return;
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
    }, 420);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [spec, mode, refreshKey]);

  const startFrom = (starter: Starter) => {
    setSpec({
      ...DEFAULT_SPEC,
      ...starter.spec,
      n_questions: starter.blocks[0]?.n_questions ?? 20,
      n_options: starter.blocks[0]?.labels?.length ?? 4,
      blocks: starter.blocks.map((b) => ({ ...b, labels: [...(b.labels ?? [])] })),
      elements: [],
    });
    setNome(starter.name);
    setExamId('');
    past.current = [];
    future.current = [];
    lastCoalesce.current = null;
    setHistoryTick((n) => n + 1);
    setTab('inicio');
    setMode('editor');
  };

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
      notify(e instanceof Error ? e.message : 'Falha ao gerar o cartão', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleField = (source: string) => {
    const cur = spec.fields ?? [];
    mutate({
      fields: cur.includes(source) ? cur.filter((f) => f !== source) : [...cur, source],
    }, `field-${source}`);
  };

  const addBlock = () => {
    const total = blocks.reduce((sum, b) => sum + (b.n_questions ?? 0), 0);
    mutate({
      blocks: [...blocks, {
        ...DEFAULT_BLOCK,
        title: '',
        n_questions: 10,
        labels: ['A', 'B', 'C', 'D'],
        columns: 1,
        start_question: total + 1,
      }],
    });
  };

  const updateBlock = (index: number, patch: Partial<CardBlockSpec>, coalesce: string) => {
    mutate({ blocks: blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) }, coalesce);
  };

  const removeBlock = (index: number) => {
    if (blocks.length <= 1) return;
    mutate({ blocks: blocks.filter((_, i) => i !== index) }, 'blocks');
  };

  const addElement = (kind: CardElementSpec['kind']) => {
    const base: CardElementSpec = kind === 'text'
      ? { kind, text: 'Novo texto', x: 0.08, y: 0.12, w: 0.5, h: 0.05, font_mm: 4, align: 'left' }
      : { kind, x: 0.08, y: 0.5, w: 0.84, h: 0.006 };
    mutate({ elements: [...elements, base] }, 'elements');
    setTab('inserir');
  };

  const updateElement = (index: number, patch: Partial<CardElementSpec>, coalesce: string) => {
    mutate({ elements: elements.map((e, i) => (i === index ? { ...e, ...patch } : e)) }, coalesce);
  };

  const removeElement = (index: number) => {
    mutate({ elements: elements.filter((_, i) => i !== index) }, 'elements');
  };

  const customPage = spec.page_format === 'custom';
  const [pageW, pageH] = pageDims(spec);
  const margin = spec.margin_mm ?? 10;
  const activeOptions = blocks[0]?.labels?.length ?? spec.n_options ?? 4;
  const totalQuestions = blocks.reduce((sum, b) => sum + (b.n_questions ?? 0), 0);

  // ─── Galeria de modelos ────────────────────────────────────────────────────
  if (mode === 'gallery') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="page-title">Criar do zero</h2>
            <p className="page-subtitle">
              Escolha um modelo inicial e ajuste tudo no editor visual. As âncoras OMR
              já vêm prontas para leitura.
            </p>
          </div>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {STARTERS.map((starter) => {
            const Icon = starter.kind === 'quiz'
              ? FileText
              : starter.kind === 'exam'
                ? ListChecks
                : starter.kind === 'survey'
                  ? MessageSquare
                  : LayoutGrid;
            return (
              <button
                key={starter.kind}
                type="button"
                onClick={() => startFrom(starter)}
                className="card card-hover group flex flex-col gap-3 p-3 text-left"
              >
                <div className="h-[190px] rounded-lg bg-[#F0EFEA] p-2.5 dark:bg-gray-800/60">
                  <MiniPage kind={starter.kind} />
                </div>
                <div className="px-1 pb-1">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-300">
                    <Icon size={12} aria-hidden /> {starter.tag}
                  </span>
                  <h3 className="mt-1 text-base font-semibold text-ink dark:text-white">
                    {starter.title}
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    {starter.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="callout-info flex items-start gap-2">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            Você pode começar por qualquer modelo e mudar formato, questões, blocos e
            elementos depois. Nada é gravado até clicar em <strong>Gerar cartão</strong>.
          </p>
        </div>
      </div>
    );
  }

  // ─── Editor ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card dark:border-gray-800 dark:bg-gray-900 lg:h-[calc(100vh-11rem)] lg:min-h-[560px]">
      {/* Topbar */}
      <div className="flex items-center gap-2 border-b border-line bg-white px-2.5 py-2 dark:border-gray-800 dark:bg-gray-900">
        <button
          type="button"
          onClick={() => setMode('gallery')}
          className="btn-icon !min-h-[34px] !min-w-[34px]"
          title="Voltar aos modelos"
          aria-label="Voltar aos modelos"
        >
          <ArrowLeft size={17} aria-hidden />
        </button>
        <span className="hidden h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white sm:flex">
          <LayoutGrid size={16} aria-hidden />
        </span>
        <input
          value={nome}
          onChange={(e) => rename(e.target.value)}
          aria-label="Nome do cartão"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-ink outline-none transition-colors hover:border-line focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:text-white dark:hover:border-gray-700"
        />
        <span className="hidden text-[11px] text-gray-400 sm:block">
          {previewing ? 'Atualizando…' : preview?.image ? 'Prévia pronta' : 'Sem prévia'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button" onClick={undo} className="btn-icon !min-h-[34px] !min-w-[34px]"
            title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={past.current.length === 0}
          >
            <Undo2 size={16} aria-hidden />
          </button>
          <button
            type="button" onClick={redo} className="btn-icon !min-h-[34px] !min-w-[34px]"
            title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer" disabled={future.current.length === 0}
          >
            <Redo2 size={16} aria-hidden />
          </button>
          <Button
            size="sm"
            onClick={() => void handleGenerate()}
            loading={busy}
            disabled={!preview || previewing}
            icon={<FileDown size={15} aria-hidden />}
            className="ml-1"
          >
            Gerar cartão
          </Button>
        </div>
      </div>

      {/* Ribbon */}
      <div className="border-b border-line bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-end gap-1 overflow-x-auto px-2 pt-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'bg-brand-50 text-brand-700 shadow-[inset_0_-2px_0_#1769FF] dark:bg-brand-700/20 dark:text-brand-200'
                  : 'text-gray-500 hover:bg-surface hover:text-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-[56px] items-stretch gap-0.5 overflow-x-auto px-2 py-1.5">
          {tab === 'inicio' && (
            <>
              <div className="flex items-center px-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                Campos
              </div>
              {FIELD_OPTIONS.map((f) => (
                <ToolButton
                  key={f.value}
                  icon={<Type size={15} aria-hidden />}
                  label={f.short}
                  active={(spec.fields ?? []).includes(f.value)}
                  onClick={() => toggleField(f.value)}
                  title={`Mostrar campo: ${f.label}`}
                />
              ))}
            </>
          )}

          {tab === 'inserir' && (
            <>
              <ToolButton icon={<Type size={16} aria-hidden />} label="Texto"
                          onClick={() => addElement('text')} />
              <ToolButton icon={<Minus size={16} aria-hidden />} label="Linha"
                          onClick={() => addElement('line')} />
              <span className="mx-1 w-px self-stretch bg-line dark:bg-gray-700" />
              <ToolButton icon={<ListChecks size={16} aria-hidden />} label="Bloco"
                          onClick={addBlock} />
              <ToolButton
                icon={<QrCode size={16} aria-hidden />} label="QR"
                active={spec.qr !== false}
                onClick={() => mutate({ qr: spec.qr === false }, 'qr')}
                title="Ligar/desligar a área de QR Code"
              />
              <ToolButton
                icon={<Focus size={16} aria-hidden />} label="Âncoras"
                active={spec.anchors !== false}
                onClick={() => mutate({ anchors: spec.anchors === false }, 'anchors')}
                title="Ligar/desligar as âncoras ArUco"
              />
            </>
          )}

          {tab === 'layout' && (
            <>
              <ToolField label="Formato">
                <Select
                  value={spec.page_format}
                  className={`${COMPACT} !min-h-[30px]`}
                  onChange={(e) => mutate({ page_format: e.target.value as CardSpec['page_format'] })}
                >
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                  <option value="Letter">Carta</option>
                  <option value="Oficio">Ofício</option>
                  <option value="custom">Personalizado</option>
                </Select>
              </ToolField>
              <ToolField label="Orientação">
                <Select
                  value={spec.orientation}
                  className={`${COMPACT} !min-h-[30px]`}
                  onChange={(e) => mutate({ orientation: e.target.value as CardSpec['orientation'] })}
                >
                  <option value="portrait">Retrato</option>
                  <option value="landscape">Paisagem</option>
                </Select>
              </ToolField>
              <ToolField label="Bolha (mm)">
                <Input
                  type="number" min={3} max={20} step={0.5}
                  value={spec.bubble_mm ?? ''}
                  className={`${COMPACT} !min-h-[30px]`}
                  onChange={(e) => mutate({ bubble_mm: numOrUndefined(e.target.value) }, 'bubble')}
                />
              </ToolField>
              <ToolField label="Margem (mm)">
                <Input
                  type="number" min={3} max={40}
                  value={spec.margin_mm ?? ''}
                  className={`${COMPACT} !min-h-[30px]`}
                  onChange={(e) => mutate({ margin_mm: numOrUndefined(e.target.value) }, 'margin')}
                />
              </ToolField>
              <ToolField label="Alternativas">
                <Input
                  type="number" min={2} max={10}
                  value={activeOptions}
                  className={`${COMPACT} !min-h-[30px]`}
                  onChange={(e) => {
                    const n = clamp(Number(e.target.value) || 4, 2, 10);
                    updateBlock(0, { labels: labelsFor(n), n_options: n }, 'blk-0-options');
                  }}
                />
              </ToolField>
              <span className="mx-1 w-px self-stretch bg-line dark:bg-gray-700" />
              <ToolButton
                icon={<CircleDot size={16} aria-hidden />} label={spec.shape === 'square' ? 'Quadrado' : 'Círculo'}
                onClick={() => mutate({ shape: spec.shape === 'square' ? 'circle' : 'square' }, 'shape')}
                title="Alternar formato das bolhas"
              />
              <ToolButton icon={<Plus size={16} aria-hidden />} label="Bloco" onClick={addBlock} />
            </>
          )}

          {tab === 'exibir' && (
            <>
              <ToolField label="Zoom">
                <Select
                  value={String(zoom)}
                  className={`${COMPACT} !min-h-[30px]`}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  <option value="0.75">75%</option>
                  <option value="0.9">90%</option>
                  <option value="1">100%</option>
                  <option value="1.15">115%</option>
                  <option value="1.3">130%</option>
                </Select>
              </ToolField>
              <ToolButton
                icon={<Ruler size={16} aria-hidden />} label="Margem"
                active={showMargin}
                onClick={() => setShowMargin((v) => !v)}
                title="Mostrar a margem de segurança"
              />
              <ToolButton
                icon={<RefreshCw size={16} aria-hidden />} label="Atualizar"
                onClick={() => setRefreshKey((k) => k + 1)}
              />
              <span className="mx-1 w-px self-stretch bg-line dark:bg-gray-700" />
              <div className="flex items-center gap-1 px-1 text-[11px] text-gray-500 dark:text-gray-400">
                <Eye size={14} aria-hidden />
                {preview?.image
                  ? `${pageW.toFixed(0)}×${pageH.toFixed(0)} mm`
                  : 'Aguardando prévia'}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Workspace */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Canvas */}
        <div
          className="relative flex-1 overflow-auto bg-[#E9E8E2] dark:bg-gray-950"
          style={{
            backgroundImage: 'radial-gradient(#CFCEC7 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <div className="flex min-h-full min-w-full flex-col items-center px-3 pb-14 pt-6 sm:px-6">
            {preview?.image ? (
              <div
                ref={pageWrapRef}
                onPointerMove={onPagePointerMove}
                onPointerUp={onPagePointerUp}
                className="relative bg-white shadow-[0_4px_8px_rgba(20,22,28,.10),0_16px_30px_rgba(20,22,28,.10)]"
                style={{
                  width: `${Math.round(560 * zoom)}px`,
                  maxWidth: zoom <= 1 ? '100%' : 'none',
                }}
              >
                <img src={preview.image} alt="Prévia do cartão" className="block h-auto w-full" />
                {showMargin && (
                  <div
                    className="pointer-events-none absolute border border-dashed border-brand-500/70"
                    style={{
                      top: `${(margin / pageH) * 100}%`,
                      bottom: `${(margin / pageH) * 100}%`,
                      left: `${(margin / pageW) * 100}%`,
                      right: `${(margin / pageW) * 100}%`,
                    }}
                  />
                )}
                {elements.map((el, i) => (
                  <button
                    key={i}
                    type="button"
                    className="absolute z-10 h-4 w-4 cursor-grab rounded-full bg-white shadow-sm ring-2 ring-brand-500"
                    style={{
                      left: `${Math.min(100, (el.x + (el.w ?? 0.8)) * 100)}%`,
                      top: `${Math.min(100, (el.y + (el.h ?? 0.05)) * 100)}%`,
                      transform: 'translate(-100%, -100%)',
                    }}
                    onPointerDown={(e) => startElementDrag(e, i)}
                    aria-label={`Mover ${el.kind === 'text' ? 'texto' : 'linha'} ${i + 1}`}
                    tabIndex={-1}
                  >
                    <Move size={10} className="text-brand-500" aria-hidden />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[320px] w-full max-w-md flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white/70 p-6 text-center dark:border-gray-700 dark:bg-gray-900/50">
                {previewError ? (
                  <>
                    <AlertTriangle size={22} className="text-danger-500" aria-hidden />
                    <p className="text-xs text-danger-600 dark:text-danger-300">{previewError}</p>
                    <Button size="sm" variant="secondary" onClick={() => setRefreshKey((k) => k + 1)}>
                      Tentar novamente
                    </Button>
                  </>
                ) : (
                  <>
                    <Loader2 size={22} className="animate-spin text-brand-500" aria-hidden />
                    <p className="text-xs text-gray-500">Gerando prévia…</p>
                  </>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full bg-navy-900/85 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur">
                {spec.page_format === 'custom' ? 'Personalizado' : spec.page_format}
                {' · '}
                {spec.orientation === 'landscape' ? 'Paisagem' : 'Retrato'}
                {' · '}
                {totalQuestions} questão(ões)
              </span>
              {previewing && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] text-gray-500">
                  <Loader2 size={12} className="animate-spin" aria-hidden /> atualizando
                </span>
              )}
            </div>
          </div>

          {/* Zoom flutuante */}
          <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-white/95 p-0.5 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
            <button
              type="button" className="btn-icon !min-h-[30px] !min-w-[30px]"
              onClick={() => setZoom((z) => clamp(Math.round((z - 0.1) * 10) / 10, 0.5, 1.6))}
              aria-label="Diminuir zoom" title="Diminuir zoom"
            >
              <ZoomOut size={14} aria-hidden />
            </button>
            <span className="w-10 text-center text-[11px] font-semibold text-gray-500">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button" className="btn-icon !min-h-[30px] !min-w-[30px]"
              onClick={() => setZoom((z) => clamp(Math.round((z + 0.1) * 10) / 10, 0.5, 1.6))}
              aria-label="Aumentar zoom" title="Aumentar zoom"
            >
              <ZoomIn size={14} aria-hidden />
            </button>
          </div>
        </div>

        {/* Painel lateral */}
        <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-t border-line bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:w-[360px] lg:border-l lg:border-t-0">
          {tab === 'inicio' && (
            <>
              <Section title="Documento" hint="Nome e vínculo do cartão.">
                {exams.length > 0 && (
                  <Field label="Vincular à prova (opcional)" htmlFor="gen-exam">
                    <Select id="gen-exam" value={examId} onChange={(e) => setExamId(e.target.value)}>
                      <option value="">Nenhuma</option>
                      {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </Select>
                  </Field>
                )}
                <div className="rounded-lg bg-surface p-3 text-[11px] leading-relaxed text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                  O nome do arquivo/gabarito fica na barra superior. A prévia é gerada pelo
                  mesmo motor que fará a leitura.
                </div>
              </Section>

              <Section title="Cabeçalho" hint="Textos impressos no topo da folha.">
                <Field label="Escola" htmlFor="gen-school">
                  <Input id="gen-school" className={COMPACT} value={spec.school ?? ''}
                         onChange={(e) => mutate({ school: e.target.value }, 'school')} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Professor(a)" htmlFor="gen-teacher">
                    <Input id="gen-teacher" className={COMPACT} value={spec.teacher ?? ''}
                           onChange={(e) => mutate({ teacher: e.target.value }, 'teacher')} />
                  </Field>
                  <Field label="Data" htmlFor="gen-date" helper="Opcional.">
                    <Input id="gen-date" className={COMPACT} value="" disabled
                           placeholder="Preenchida pelo sistema" />
                  </Field>
                </div>
                <Field label="Título" htmlFor="gen-title">
                  <Input id="gen-title" className={COMPACT} value={spec.title ?? ''}
                         onChange={(e) => mutate({ title: e.target.value }, 'title')} />
                </Field>
                <Field label="Subtítulo" htmlFor="gen-sub">
                  <Input id="gen-sub" className={COMPACT} value={spec.subtitle ?? ''}
                         onChange={(e) => mutate({ subtitle: e.target.value }, 'subtitle')} />
                </Field>
                <Field label="Instruções" htmlFor="gen-instr" helper="Uma linha por linha do texto.">
                  <textarea id="gen-instr" className="input !min-h-[64px] text-xs" rows={3}
                            value={spec.instructions ?? ''}
                            onChange={(e) => mutate({ instructions: e.target.value }, 'instructions')} />
                </Field>
              </Section>

              <Section title="Campos de identificação" hint="Aparecem como linhas para preencher.">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {FIELD_OPTIONS.map((f) => (
                    <label key={f.value} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <input type="checkbox" checked={(spec.fields ?? []).includes(f.value)}
                             onChange={() => toggleField(f.value)} />
                      {f.label}
                    </label>
                  ))}
                </div>
              </Section>
            </>
          )}

          {tab === 'inserir' && (
            <>
              <Section title="Elementos decorativos" hint="Desenhados na folha; ignorados pela leitura.">
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Type size={14} aria-hidden />}
                          onClick={() => addElement('text')} className="flex-1">
                    Texto
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Minus size={14} aria-hidden />}
                          onClick={() => addElement('line')} className="flex-1">
                    Linha
                  </Button>
                </div>

                {elements.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line p-3 text-center text-[11px] text-gray-400 dark:border-gray-700">
                    Nenhum elemento ainda. Adicione textos e linhas para personalizar a folha.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {elements.map((el, i) => (
                      <ElementCard
                        key={i}
                        element={el}
                        index={i}
                        onChange={(patch, coalesce) => updateElement(i, patch, coalesce)}
                        onRemove={() => removeElement(i)}
                      />
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Códigos e âncoras" hint="O leitor usa as âncoras para alinhar a foto.">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 dark:border-gray-700">
                  <div>
                    <p className="text-xs font-semibold text-ink dark:text-white">QR Code</p>
                    <p className="text-[11px] text-gray-400">Identifica o aluno na leitura.</p>
                  </div>
                  <input type="checkbox" checked={spec.qr !== false}
                         onChange={(e) => mutate({ qr: e.target.checked }, 'qr')} />
                </div>
                {spec.qr !== false && (
                  <Field label="Tamanho do QR (mm)" htmlFor="gen-qr-mm">
                    <Input id="gen-qr-mm" type="number" min={10} max={60} step={1}
                           className={COMPACT} value={spec.qr_mm ?? ''}
                           onChange={(e) => mutate({ qr_mm: numOrUndefined(e.target.value) }, 'qr-mm')} />
                  </Field>
                )}

                <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 dark:border-gray-700">
                  <div>
                    <p className="text-xs font-semibold text-ink dark:text-white">Âncoras ArUco</p>
                    <p className="text-[11px] text-gray-400">Quatro marcadores nos cantos.</p>
                  </div>
                  <input type="checkbox" checked={spec.anchors !== false}
                         onChange={(e) => mutate({ anchors: e.target.checked }, 'anchors')} />
                </div>
                {spec.anchors !== false && (
                  <Field label="Tamanho da âncora (mm)" htmlFor="gen-anchor-mm">
                    <Input id="gen-anchor-mm" type="number" min={5} max={25} step={0.5}
                           className={COMPACT} value={spec.anchor_mm ?? ''}
                           onChange={(e) => mutate({ anchor_mm: numOrUndefined(e.target.value) }, 'anchor-mm')} />
                  </Field>
                )}
              </Section>
            </>
          )}

          {tab === 'layout' && (
            <>
              <Section title="Página" hint="Formato, orientação e margem.">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Formato" htmlFor="gen-format">
                    <Select id="gen-format" className={COMPACT} value={spec.page_format}
                            onChange={(e) => mutate({ page_format: e.target.value as CardSpec['page_format'] })}>
                      <option value="A4">A4</option>
                      <option value="A5">A5</option>
                      <option value="Letter">Carta</option>
                      <option value="Oficio">Ofício</option>
                      <option value="custom">Personalizado</option>
                    </Select>
                  </Field>
                  <Field label="Orientação" htmlFor="gen-orient">
                    <Select id="gen-orient" className={COMPACT} value={spec.orientation}
                            onChange={(e) => mutate({ orientation: e.target.value as CardSpec['orientation'] })}>
                      <option value="portrait">Retrato</option>
                      <option value="landscape">Paisagem</option>
                    </Select>
                  </Field>
                </div>
                {customPage && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Largura (mm)" htmlFor="gen-pw">
                      <Input id="gen-pw" type="number" min={50} max={1000} className={COMPACT}
                             value={spec.page_w_mm ?? ''}
                             onChange={(e) => mutate({ page_w_mm: numOrUndefined(e.target.value) }, 'page-w')} />
                    </Field>
                    <Field label="Altura (mm)" htmlFor="gen-ph">
                      <Input id="gen-ph" type="number" min={50} max={1000} className={COMPACT}
                             value={spec.page_h_mm ?? ''}
                             onChange={(e) => mutate({ page_h_mm: numOrUndefined(e.target.value) }, 'page-h')} />
                    </Field>
                  </div>
                )}
                <Field label="Margem de segurança (mm)" htmlFor="gen-margin">
                  <Input id="gen-margin" type="number" min={3} max={40} className={COMPACT}
                         value={spec.margin_mm ?? ''}
                         onChange={(e) => mutate({ margin_mm: numOrUndefined(e.target.value) }, 'margin')} />
                </Field>
              </Section>

              <Section title="Blocos de questões" hint="Cada bloco tem numeração e alternativas próprias.">
                <div className="space-y-2">
                  {blocks.map((block, i) => (
                    <BlockCard
                      key={i}
                      block={block}
                      index={i}
                      total={blocks.length}
                      onChange={(patch, coalesce) => updateBlock(i, patch, coalesce)}
                      onRemove={() => removeBlock(i)}
                    />
                  ))}
                </div>
                <Button size="sm" variant="secondary" icon={<Plus size={14} aria-hidden />}
                        onClick={addBlock} className="w-full">
                  Adicionar bloco
                </Button>
                <p className="text-right text-[11px] text-gray-400">
                  Total: {totalQuestions} questão(ões)
                </p>
              </Section>

              <Section title="Aparência das bolhas">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Diâmetro (mm)" htmlFor="gen-bubble">
                    <Input id="gen-bubble" type="number" min={3} max={20} step={0.5} className={COMPACT}
                           value={spec.bubble_mm ?? ''}
                           onChange={(e) => mutate({ bubble_mm: numOrUndefined(e.target.value) }, 'bubble')} />
                  </Field>
                  <Field label="Formato" htmlFor="gen-shape">
                    <Select id="gen-shape" className={COMPACT} value={spec.shape}
                            onChange={(e) => mutate({ shape: e.target.value as CardSpec['shape'] }, 'shape')}>
                      <option value="circle">Círculo</option>
                      <option value="square">Quadrado</option>
                    </Select>
                  </Field>
                  <Field label="Espaço entre alternativas (mm)" htmlFor="gen-gapx">
                    <Input id="gen-gapx" type="number" min={1} max={20} step={0.5} className={COMPACT}
                           value={spec.option_gap_mm ?? ''}
                           onChange={(e) => mutate({ option_gap_mm: numOrUndefined(e.target.value) }, 'gap-x')} />
                  </Field>
                  <Field label="Espaço entre questões (mm)" htmlFor="gen-gapy">
                    <Input id="gen-gapy" type="number" min={0.5} max={20} step={0.5} className={COMPACT}
                           value={spec.row_gap_mm ?? ''}
                           onChange={(e) => mutate({ row_gap_mm: numOrUndefined(e.target.value) }, 'gap-y')} />
                  </Field>
                  <Field label="Espaço entre colunas (mm)" htmlFor="gen-colgap">
                    <Input id="gen-colgap" type="number" min={4} max={60} step={0.5} className={COMPACT}
                           value={spec.column_gap_mm ?? ''}
                           onChange={(e) => mutate({ column_gap_mm: numOrUndefined(e.target.value) }, 'gap-col')} />
                  </Field>
                </div>
              </Section>
            </>
          )}

          {tab === 'exibir' && (
            <>
              <Section title="Prévia" hint="Resumo do cartão gerado.">
                {preview?.summary ? (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-surface p-2.5 dark:bg-gray-800/60">
                      <p className="text-[10px] uppercase text-gray-400">Questões</p>
                      <p className="text-lg font-semibold text-ink dark:text-white">
                        {preview.summary.n_questions}
                      </p>
                    </div>
                    <div className="rounded-lg bg-surface p-2.5 dark:bg-gray-800/60">
                      <p className="text-[10px] uppercase text-gray-400">Blocos</p>
                      <p className="text-lg font-semibold text-ink dark:text-white">
                        {preview.summary.n_blocks}
                      </p>
                    </div>
                    <div className="rounded-lg bg-surface p-2.5 dark:bg-gray-800/60">
                      <p className="text-[10px] uppercase text-gray-400">Âncoras</p>
                      <p className="text-lg font-semibold text-ink dark:text-white">
                        {preview.summary.n_anchors}
                      </p>
                    </div>
                    <div className="rounded-lg bg-surface p-2.5 dark:bg-gray-800/60">
                      <p className="text-[10px] uppercase text-gray-400">Elementos</p>
                      <p className="text-lg font-semibold text-ink dark:text-white">
                        {preview.summary.n_elements ?? 0}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">A prévia ainda não foi gerada.</p>
                )}

                {preview?.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <Info size={12} className="mt-0.5 shrink-0" aria-hidden />{w}
                  </p>
                ))}
                {preview?.issues.filter((i) => i.level === 'error').map((i, k) => (
                  <p key={k} className="flex items-start gap-1.5 text-[11px] text-danger-600">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{i.message}
                  </p>
                ))}
              </Section>

              <Section title="Exibição">
                <Field label="Zoom da página" htmlFor="gen-zoom">
                  <Select id="gen-zoom" className={COMPACT} value={String(zoom)}
                          onChange={(e) => setZoom(Number(e.target.value))}>
                    <option value="0.75">75%</option>
                    <option value="0.9">90%</option>
                    <option value="1">100%</option>
                    <option value="1.15">115%</option>
                    <option value="1.3">130%</option>
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={showMargin}
                         onChange={(e) => setShowMargin(e.target.checked)} />
                  Mostrar margem de segurança
                </label>
                <Button size="sm" variant="secondary" icon={<RefreshCw size={14} aria-hidden />}
                        onClick={() => setRefreshKey((k) => k + 1)} className="w-full">
                  Atualizar prévia
                </Button>
              </Section>

              <Section title="Dicas">
                <ul className="space-y-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                  <li className="flex gap-1.5"><ChevronRight size={12} className="mt-0.5 shrink-0" aria-hidden />
                    Use <strong>Layout</strong> para dividir as questões em vários blocos.
                  </li>
                  <li className="flex gap-1.5"><ChevronRight size={12} className="mt-0.5 shrink-0" aria-hidden />
                    Adicione textos e linhas em <strong>Inserir</strong> para personalizar o cabeçalho.
                  </li>
                  <li className="flex gap-1.5"><ChevronRight size={12} className="mt-0.5 shrink-0" aria-hidden />
                    Ctrl+Z desfaz e Ctrl+Shift+Z refaz qualquer ajuste.
                  </li>
                </ul>
              </Section>
            </>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-3 dark:border-gray-800">
            <Button size="sm" onClick={() => void handleGenerate()} loading={busy}
                    disabled={!preview || previewing}
                    icon={<Sparkles size={14} aria-hidden />}>
              Gerar cartão
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
              Cancelar
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
