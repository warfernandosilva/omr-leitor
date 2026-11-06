import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, CircleDot,
  Crosshair, Eye, EyeOff, FileDown, FileText, Focus, Grid3x3, Info, LayoutGrid,
  Layers, ListChecks, Loader2, Lock, Maximize2, MessageSquare, Minus, PanelLeft,
  PanelRight, Plus, QrCode, Redo2, RefreshCw, RotateCcw, Ruler, ShieldCheck,
  Sparkles, Trash2, Type, Undo2, Unlock, X, ZoomIn, ZoomOut,
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
import { snapDelta, clampRect, type Rect } from '../../utils/custom-template-edit';
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

type Step = 1 | 2 | 3;
type PropsTab = 'geral' | 'questoes' | 'elementos' | 'pagina';
type Selection = { kind: 'block' | 'element'; index: number } | null;
type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const COMPACT = '!min-h-[38px] !py-1.5 text-xs';
const PAGE_BASE_PX = 560;

const STEP_LABELS = ['Carregar documento', 'Identificar elementos', 'Validar e ativar'];

const PROPS_TABS: { id: PropsTab; label: string }[] = [
  { id: 'geral', label: 'Documento' },
  { id: 'questoes', label: 'Questões' },
  { id: 'elementos', label: 'Elementos' },
  { id: 'pagina', label: 'Página' },
];

interface Snapshot {
  spec: CardSpec;
  nome: string;
}

type DragState =
  | {
      kind: 'element';
      index: number;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | {
      kind: 'block';
      index: number;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
      moved?: boolean;
    }
  | {
      kind: 'resize';
      index: number;
      dir: ResizeDir;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
      moved?: boolean;
    };

// ─── Auxiliares ───────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

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

function blockName(block: CardBlockSpec, index: number): string {
  const title = block.title?.trim();
  if (title) return title;
  const start = block.start_question ?? 1;
  const n = block.n_questions ?? 0;
  return `Bloco ${index + 1} · ${start}–${start + Math.max(0, n - 1)}`;
}

// ─── Componentes internos ─────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.09em] text-gray-500 dark:text-gray-400">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-400 dark:text-gray-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Stepper({
  step, hasModel, hasPreview, meta, onStep, onValidate,
}: {
  step: Step;
  hasModel: boolean;
  hasPreview: boolean;
  meta: string;
  onStep: (step: Step) => void;
  onValidate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-1 overflow-x-auto">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const disabled = (n === 2 && !hasModel) || (n === 3 && !hasPreview);
          const active = n === step;
          const done = n < step;
          return (
            <div key={label} className="flex items-center gap-1">
              {i > 0 && <span className="h-px w-4 bg-line dark:bg-gray-700" aria-hidden />}
              <button
                type="button"
                onClick={() => !disabled && onStep(n)}
                disabled={disabled}
                aria-current={active ? 'step' : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
                    : done
                      ? 'text-success-700 hover:bg-success-50 dark:text-success-100 dark:hover:bg-success-700/20'
                      : 'text-gray-500 hover:bg-surface hover:text-ink dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  active
                    ? 'bg-brand-500 text-white'
                    : done
                      ? 'bg-success-100 text-success-700 dark:bg-success-700/30 dark:text-success-100'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  {done ? <Check size={11} aria-hidden /> : n}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden text-[10.5px] text-gray-400 md:inline">{meta}</span>
        {step === 2 && hasPreview && (
          <Button size="sm" onClick={onValidate} icon={<ArrowRight size={14} aria-hidden />}>
            Validar
          </Button>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  icon, label, onClick, active, disabled, title, wide,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-pressed={active}
      className={`flex ${wide ? 'col-span-2' : ''} flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-semibold leading-none transition-colors disabled:opacity-40 ${
        active
          ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
          : 'border-line bg-white text-gray-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-brand-700 dark:hover:bg-brand-700/20'
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
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
  element, index, selected, onChange, onRemove, onSelect,
}: {
  element: CardElementSpec;
  index: number;
  selected: boolean;
  onChange: (patch: Partial<CardElementSpec>, coalesce: string) => void;
  onRemove: () => void;
  onSelect: () => void;
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
    <div
      className={`rounded-lg border p-2.5 transition-colors ${
        selected ? 'border-brand-300 bg-brand-50/40 dark:border-brand-700 dark:bg-brand-700/10' : 'border-line dark:border-gray-700'
      }`}
      onPointerDown={onSelect}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          {element.kind === 'text' ? <Type size={13} aria-hidden /> : <Minus size={13} aria-hidden />}
          {element.kind === 'text' ? 'Texto' : 'Linha'} {index + 1}
          {(element.hidden || element.locked) && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-normal text-gray-400">
              {element.hidden && <EyeOff size={10} aria-hidden />}
              {element.locked && <Lock size={10} aria-hidden />}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
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
  block, index, total, selected, onChange, onRemove, onSelect,
}: {
  block: CardBlockSpec;
  index: number;
  total: number;
  selected: boolean;
  onChange: (patch: Partial<CardBlockSpec>, coalesce: string) => void;
  onRemove: () => void;
  onSelect: () => void;
}) {
  const nOptions = block.labels?.length ?? 4;
  const setOptions = (raw: string) => {
    const n = clamp(Number(raw) || 4, 2, 10);
    onChange({ labels: labelsFor(n), n_options: n }, `blk-${index}-options`);
  };

  return (
    <div
      className={`space-y-2 rounded-lg border p-2.5 transition-colors ${
        selected ? 'border-brand-300 bg-brand-50/40 dark:border-brand-700 dark:bg-brand-700/10' : 'border-line dark:border-gray-700'
      }`}
      onPointerDown={onSelect}
    >
      <div className="mb-0 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          <ListChecks size={13} aria-hidden /> Bloco {index + 1}
          {(block.hidden || block.locked) && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-normal text-gray-400">
              {block.hidden && <EyeOff size={10} aria-hidden />}
              {block.locked && <Lock size={10} aria-hidden />}
            </span>
          )}
        </span>
        <button
          type="button"
          disabled={total <= 1}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
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

  const [step, setStep] = useState<Step>(1);
  const [nome, setNome] = useState('Cartão-resposta');
  const [examId, setExamId] = useState('');
  const [spec, setSpec] = useState<CardSpec>({ ...DEFAULT_SPEC });
  const [zoom, setZoom] = useState(1);
  /** O usuário ajustou o zoom manualmente: não re-ajustar sozinho ao redimensionar. */
  const zoomManualRef = useRef(false);
  const [showMargin, setShowMargin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState<Selection>(null);
  const [propsTab, setPropsTab] = useState<PropsTab>('geral');
  const [rulers, setRulers] = useState(true);
  const [grid, setGrid] = useState(false);
  const [snap, setSnap] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<'tools' | 'props' | null>(null);

  const [preview, setPreview] = useState<GeneratePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const fittedRef = useRef(false);

  // Histórico (desfazer/refazer) — snapshots leves de spec + nome.
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const [, setHistoryTick] = useState(0);

  const blocks = useMemo(() => spec.blocks ?? [], [spec.blocks]);
  const elements = useMemo(() => spec.elements ?? [], [spec.elements]);

  const [pageW, pageH] = pageDims(spec);
  const margin = spec.margin_mm ?? 10;
  const totalQuestions = blocks.reduce((sum, b) => sum + (b.n_questions ?? 0), 0);

  const displayW = Math.round(PAGE_BASE_PX * zoom);
  const displayH = Math.round(displayW * (pageH / pageW));
  const pxPerMm = displayW / pageW;

  const selectedBlockIndex = selected?.kind === 'block' && selected.index < blocks.length
    ? selected.index : null;
  const selectedElementIndex = selected?.kind === 'element' && selected.index < elements.length
    ? selected.index : null;

  // ─── Histórico ─────────────────────────────────────────────────────────────

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

  useEffect(() => {
    if (step !== 2) return;
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
  }, [step, undo, redo]);

  // ─── Prévia real ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (step === 1) return;
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
    }, 380);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [spec, step, refreshKey]);

  // ─── Ações de documento ────────────────────────────────────────────────────

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
    setSelected(null);
    setPropsTab('geral');
    setZoom(1);
    fittedRef.current = false;
    zoomManualRef.current = false;
    past.current = [];
    future.current = [];
    lastCoalesce.current = null;
    setHistoryTick((n) => n + 1);
    setPreview(null);
    setStep(2);
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

  const goStep = (next: Step) => {
    if (next === 1) {
      setStep(1);
      setMobilePanel(null);
      return;
    }
    if (next === 2) {
      setStep(2);
      setMobilePanel(null);
      return;
    }
    if (preview) setStep(3);
  };

  const changePage = (patch: Partial<CardSpec>) => {
    pushHistory();
    fittedRef.current = false;
    setSpec((prev) => ({
      ...prev,
      ...patch,
      blocks: (prev.blocks ?? []).map((b) => {
        const next = { ...b };
        delete next.x_mm;
        delete next.y_mm;
        delete next.w_mm;
        delete next.h_mm;
        return next;
      }),
    }));
  };

  const resetBlockPositions = () => {
    pushHistory();
    setSpec((prev) => ({
      ...prev,
      blocks: (prev.blocks ?? []).map((b) => {
        const next = { ...b };
        delete next.x_mm;
        delete next.y_mm;
        delete next.w_mm;
        delete next.h_mm;
        return next;
      }),
    }));
    notify('Blocos reorganizados no fluxo automático.', 'info');
  };

  // ─── Blocos e elementos ────────────────────────────────────────────────────

  const hasBlockPos = (b: CardBlockSpec) =>
    b.x_mm != null && b.y_mm != null && b.w_mm != null && b.h_mm != null;

  /** Congela o layout automático dos blocos (mm) antes de uma edição livre. */
  const freezeBlockPositions = (list: CardBlockSpec[]): CardBlockSpec[] =>
    list.map((b, i) => {
      if (hasBlockPos(b)) return b;
      const l = preview?.layout?.find((item) => item.index === i);
      if (!l) return b;
      return {
        ...b,
        x_mm: l.x_mm,
        y_mm: l.y_mm,
        w_mm: l.w_mm,
        h_mm: l.h_mm,
      };
    });

  const blockBounds = useCallback((index: number): Rect & { w: number; h: number } | null => {
    const b = blocks[index];
    if (!b) return null;
    if (hasBlockPos(b)) {
      return { x: b.x_mm!, y: b.y_mm!, w: b.w_mm!, h: b.h_mm! };
    }
    const l = preview?.layout?.find((item) => item.index === index);
    if (!l) return null;
    return { x: l.x_mm, y: l.y_mm, w: l.w_mm, h: l.h_mm };
  }, [blocks, preview]);

  const toggleField = (source: string) => {
    const cur = spec.fields ?? [];
    mutate({
      fields: cur.includes(source) ? cur.filter((f) => f !== source) : [...cur, source],
    }, `field-${source}`);
  };

  const addBlock = () => {
    const bounds = blocks.map((_, i) => blockBounds(i)).filter(Boolean) as Rect[];
    const x = bounds.length ? Math.min(...bounds.map((b) => b.x)) : margin;
    const y = bounds.length ? Math.max(...bounds.map((b) => b.y + b.h)) + 4 : 50;
    const w = bounds.length ? Math.max(...bounds.map((b) => b.w)) : Math.max(60, pageW - margin * 2);
    const h = 60;
    const newIndex = blocks.length;
    // No fluxo automático o novo bloco entra no empilhamento; no modo livre
    // ele nasce logo abaixo do último bloco, com posição em mm.
    const free = blocks.length > 0 && blocks.every(hasBlockPos);
    mutate({
      blocks: [...blocks, {
        ...DEFAULT_BLOCK,
        title: '',
        n_questions: 10,
        labels: ['A', 'B', 'C', 'D'],
        columns: 1,
        start_question: totalQuestions + 1,
        ...(free
          ? {
              x_mm: round1(x),
              y_mm: round1(Math.min(y, Math.max(margin, pageH - h - margin))),
              w_mm: round1(w),
              h_mm: h,
            }
          : {}),
      }],
    });
    setSelected({ kind: 'block', index: newIndex });
    setPropsTab('questoes');
  };

  const updateBlock = (index: number, patch: Partial<CardBlockSpec>, coalesce: string) => {
    mutate({ blocks: blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) }, coalesce);
  };

  const removeBlock = (index: number) => {
    if (blocks.length <= 1) return;
    mutate({ blocks: blocks.filter((_, i) => i !== index) }, 'blocks');
    if (selectedBlockIndex != null && selectedBlockIndex >= index) {
      setSelected(selectedBlockIndex === index ? null : { kind: 'block', index: selectedBlockIndex - 1 });
    }
  };

  const addElement = (kind: CardElementSpec['kind']) => {
    const base: CardElementSpec = kind === 'text'
      ? { kind, text: 'Novo texto', x: 0.08, y: 0.12, w: 0.5, h: 0.05, font_mm: 4, align: 'left' }
      : { kind, x: 0.08, y: 0.5, w: 0.84, h: 0.006 };
    const newIndex = elements.length;
    mutate({ elements: [...elements, base] }, 'elements');
    setSelected({ kind: 'element', index: newIndex });
    setPropsTab('elementos');
  };

  const updateElement = (index: number, patch: Partial<CardElementSpec>, coalesce: string) => {
    mutate({ elements: elements.map((e, i) => (i === index ? { ...e, ...patch } : e)) }, coalesce);
  };

  const removeElement = (index: number) => {
    mutate({ elements: elements.filter((_, i) => i !== index) }, 'elements');
    if (selectedElementIndex != null && selectedElementIndex >= index) {
      setSelected(selectedElementIndex === index ? null : { kind: 'element', index: selectedElementIndex - 1 });
    }
  };

  const selectBlock = (index: number) => {
    setSelected({ kind: 'block', index });
    setPropsTab('questoes');
  };

  const selectElement = (index: number) => {
    setSelected({ kind: 'element', index });
    setPropsTab('elementos');
  };

  // ─── Camadas ───────────────────────────────────────────────────────────────

  const moveLayer = (kind: 'block' | 'element', index: number, direction: 1 | -1) => {
    const list = kind === 'block' ? blocks : elements;
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    if (kind === 'block') {
      const next = blocks.slice();
      [next[index], next[target]] = [next[target], next[index]];
      mutate({ blocks: next }, 'layer-block');
    } else {
      const next = elements.slice();
      [next[index], next[target]] = [next[target], next[index]];
      mutate({ elements: next }, 'layer-element');
    }
    if (selected?.kind === kind && selected.index === index) {
      setSelected({ kind, index: target });
    }
  };

  const toggleLayer = (kind: 'block' | 'element', index: number) => {
    if (kind === 'block') {
      const b = blocks[index];
      if (!b) return;
      // Sem nenhum bloco visível o cartão não teria questões para ler.
      if (!b.hidden && blocks.filter((x) => !x.hidden).length <= 1) {
        notify('Mantenha pelo menos um bloco visível para gerar o cartão.', 'info');
        return;
      }
      updateBlock(index, { hidden: !b.hidden }, `hide-block-${index}`);
    } else {
      updateElement(index, { hidden: !elements[index]?.hidden }, `hide-element-${index}`);
    }
  };

  const toggleLock = (kind: 'block' | 'element', index: number) => {
    if (kind === 'block') {
      updateBlock(index, { locked: !blocks[index]?.locked }, `lock-block-${index}`);
    } else {
      updateElement(index, { locked: !elements[index]?.locked }, `lock-element-${index}`);
    }
  };

  // ─── Drag & drop no canvas ─────────────────────────────────────────────────

  const allRects = (exclude?: { kind: 'block' | 'element'; index: number }): Rect[] => {
    const rects: Rect[] = [];
    blocks.forEach((b, i) => {
      if (exclude?.kind === 'block' && exclude.index === i) return;
      if (b.hidden) return;
      const g = blockBounds(i);
      if (!g) return;
      rects.push({ x: g.x / pageW, y: g.y / pageH, w: g.w / pageW, h: g.h / pageH });
    });
    elements.forEach((el, i) => {
      if (exclude?.kind === 'element' && exclude.index === i) return;
      if (el.hidden) return;
      rects.push({ x: el.x, y: el.y, w: el.w, h: el.h });
    });
    rects.push({ x: 0, y: 0, w: 1, h: 1 });
    return rects;
  };

  const applySnap = (
    rect: Rect,
    exclude: { kind: 'block' | 'element'; index: number },
  ): Rect => {
    if (!snap) return rect;
    const s = snapDelta(rect, allRects(exclude));
    return { ...rect, x: rect.x + s.dx, y: rect.y + s.dy };
  };

  const onPagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width === 0) return;

    if (d.kind === 'element') {
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      let next = clampRect({
        x: d.origX + dx,
        y: d.origY + dy,
        w: d.origW,
        h: d.origH,
      });
      next = clampRect(applySnap(next, { kind: 'element', index: d.index }));
      updateElement(d.index, { x: next.x, y: next.y }, `drag-el-${d.index}`);
      return;
    }

    if (d.kind === 'block') {
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      let next = clampRect({
        x: d.origX / pageW + dx,
        y: d.origY / pageH + dy,
        w: d.origW / pageW,
        h: d.origH / pageH,
      });
      next = clampRect(applySnap(next, { kind: 'block', index: d.index }));
      if (!d.moved) {
        d.moved = true;
        pushHistory(`drag-block-${d.index}`);
        // Primeiro arraste congela o layout automático em mm para todos os
        // blocos; antes disso o gerador continua reorganizando sozinho.
        setSpec((prev) => ({ ...prev, blocks: freezeBlockPositions(prev.blocks ?? []) }));
      }
      setSpec((prev) => ({
        ...prev,
        blocks: (prev.blocks ?? []).map((b, i) => (
          i === d.index
            ? { ...b, x_mm: round1(next.x * pageW), y_mm: round1(next.y * pageH) }
            : b
        )),
      }));
      return;
    }

    const dxMm = ((e.clientX - d.startX) / rect.width) * pageW;
    const dyMm = ((e.clientY - d.startY) / rect.height) * pageH;
    let x = d.origX;
    let y = d.origY;
    let w = d.origW;
    let h = d.origH;

    if (d.dir.includes('e')) w = d.origW + dxMm;
    if (d.dir.includes('s')) h = d.origH + dyMm;
    if (d.dir.includes('w')) { w = d.origW - dxMm; x = d.origX + dxMm; }
    if (d.dir.includes('n')) { h = d.origH - dyMm; y = d.origY + dyMm; }

    w = Math.max(32, w);
    h = Math.max(20, h);
    x = clamp(x, 0, Math.max(0, pageW - w));
    y = clamp(y, 0, Math.max(0, pageH - h));
    w = Math.min(w, pageW - x);
    h = Math.min(h, pageH - y);

    if (!d.moved) {
      d.moved = true;
      pushHistory(`resize-block-${d.index}`);
      setSpec((prev) => ({ ...prev, blocks: freezeBlockPositions(prev.blocks ?? []) }));
    }
    setSpec((prev) => ({
      ...prev,
      blocks: (prev.blocks ?? []).map((b, i) => (
        i === d.index
          ? {
              ...b,
              x_mm: round1(x),
              y_mm: round1(y),
              w_mm: round1(w),
              h_mm: round1(h),
            }
          : b
      )),
    }));
  };

  const onPagePointerUp = () => { dragRef.current = null; };

  const startBlockDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    const b = blocks[index];
    const bounds = blockBounds(index);
    if (!b || !bounds) return;
    e.preventDefault();
    e.stopPropagation();
    selectBlock(index);
    if (b.locked || b.hidden) return;
    dragRef.current = {
      kind: 'block',
      index,
      startX: e.clientX,
      startY: e.clientY,
      origX: bounds.x,
      origY: bounds.y,
      origW: bounds.w,
      origH: bounds.h,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captura indisponível */ }
  };

  const startBlockResize = (e: ReactPointerEvent<HTMLButtonElement>, index: number, dir: ResizeDir) => {
    const b = blocks[index];
    const bounds = blockBounds(index);
    if (!b || !bounds) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.locked) return;
    dragRef.current = {
      kind: 'resize',
      index,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origX: bounds.x,
      origY: bounds.y,
      origW: bounds.w,
      origH: bounds.h,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captura indisponível */ }
  };

  const startElementDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    const el = elements[index];
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    selectElement(index);
    if (el.locked || el.hidden) return;
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

  const fitToScreen = useCallback(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    const availW = Math.max(160, el.clientWidth - 48);
    const availH = Math.max(160, el.clientHeight - 48);
    const byWidth = availW / PAGE_BASE_PX;
    const byHeight = availH / (PAGE_BASE_PX * (pageH / pageW));
    setZoom(clamp(Math.floor(Math.min(byWidth, byHeight) * 100) / 100, 0.3, 2));
    // "Ajustar à tela" é uma ação explícita: libera o re-ajuste automático.
    zoomManualRef.current = false;
  }, [pageH, pageW]);

  // Ao entrar no editor a folha inteira cabe na tela; depois o zoom é livre.
  useEffect(() => {
    if (step !== 2 || !preview?.image || fittedRef.current) return;
    fittedRef.current = true;
    const timer = window.setTimeout(fitToScreen, 60);
    return () => window.clearTimeout(timer);
  }, [step, preview?.image, pageW, pageH, fitToScreen]);

  // A área do editor muda de tamanho (janela, barra inferior, troca de painel):
  // re-ajusta o zoom para a folha continuar cabendo — a menos que o usuário
  // tenha escolhido um zoom manualmente.
  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (zoomManualRef.current || step !== 2) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (zoomManualRef.current || step !== 2) return;
        const availW = Math.max(160, el.clientWidth - 48);
        const availH = Math.max(160, el.clientHeight - 48);
        const byWidth = availW / PAGE_BASE_PX;
        const byHeight = availH / (PAGE_BASE_PX * (pageH / pageW));
        setZoom(clamp(Math.floor(Math.min(byWidth, byHeight) * 100) / 100, 0.3, 2));
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [step, pageH, pageW]);

  // ─── Rótulos de seleção ────────────────────────────────────────────────────

  const selectedLabel = selectedBlockIndex != null
    ? blockName(blocks[selectedBlockIndex], selectedBlockIndex)
    : selectedElementIndex != null
      ? `${elements[selectedElementIndex]?.kind === 'text' ? 'Texto' : 'Linha'} ${selectedElementIndex + 1}`
      : 'Documento';

  const errorCount = preview?.issues.filter((i) => i.level === 'error').length ?? 0;
  const warningCount = preview?.warnings.length ?? 0;

  // ─── Painel de ferramentas ────────────────────────────────────────────────

  const renderTools = (mobile = false) => (
    <div className={`flex h-full w-full flex-col bg-white dark:bg-gray-900 ${mobile ? '' : 'border-r border-line dark:border-gray-800'}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5 dark:border-gray-800">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">
          Ferramentas
        </span>
        {mobile && (
          <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={() => setMobilePanel(null)} aria-label="Fechar ferramentas">
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <Section title="Inserir" hint="Adicione elementos à folha.">
          <div className="grid grid-cols-3 gap-1.5">
            <ToolButton icon={<Type size={16} aria-hidden />} label="Texto" onClick={() => addElement('text')} />
            <ToolButton icon={<Minus size={16} aria-hidden />} label="Linha" onClick={() => addElement('line')} />
            <ToolButton icon={<ListChecks size={16} aria-hidden />} label="Bloco" onClick={addBlock} />
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
            <ToolButton
              icon={<CircleDot size={16} aria-hidden />} label={spec.shape === 'square' ? 'Quadrado' : 'Círculo'}
              onClick={() => mutate({ shape: spec.shape === 'square' ? 'circle' : 'square' }, 'shape')}
              title="Alternar formato das bolhas"
            />
          </div>
        </Section>

        <Section title="Campos" hint="Linhas de identificação impressas no topo.">
          <div className="grid grid-cols-2 gap-1">
            {FIELD_OPTIONS.map((f) => {
              const active = (spec.fields ?? []).includes(f.value);
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => toggleField(f.value)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10.5px] font-medium transition-colors ${
                    active
                      ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
                      : 'border-line text-gray-500 hover:bg-surface dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    active ? 'border-brand-500 bg-brand-500 text-white' : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {active && <Check size={9} aria-hidden />}
                  </span>
                  <span className="truncate">{f.short}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Camadas" hint="Do topo para a base da folha.">
          <div className="space-y-0.5">
            {blocks.length === 0 && elements.length === 0 && (
              <p className="rounded-md border border-dashed border-line p-2 text-center text-[10.5px] text-gray-400 dark:border-gray-700">
                Nenhum elemento ainda.
              </p>
            )}
            {[...blocks.keys()].reverse().map((i) => {
              const b = blocks[i];
              const isSelected = selectedBlockIndex === i;
              return (
                <div
                  key={`block-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectBlock(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectBlock(i); }}
                  className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10.5px] ${
                    isSelected
                      ? 'border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
                      : 'border-transparent text-gray-600 hover:bg-surface dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <ListChecks size={12} className="shrink-0" aria-hidden />
                  <span className={`min-w-0 flex-1 truncate ${b.hidden ? 'line-through opacity-50' : ''} ${b.locked ? 'text-gray-400' : ''}`}>
                    {blockName(b, i)}
                  </span>
                  <span className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <LayerAction title="Subir camada" onClick={() => moveLayer('block', i, 1)} icon={<ChevronUp size={11} aria-hidden />} disabled={i === blocks.length - 1} />
                    <LayerAction title="Descer camada" onClick={() => moveLayer('block', i, -1)} icon={<ChevronDown size={11} aria-hidden />} disabled={i === 0} />
                    <LayerAction title={b.hidden ? 'Mostrar' : 'Ocultar'} onClick={() => toggleLayer('block', i)} icon={b.hidden ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />} />
                    <LayerAction title={b.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => toggleLock('block', i)} icon={b.locked ? <Lock size={11} aria-hidden /> : <Unlock size={11} aria-hidden />} />
                  </span>
                </div>
              );
            })}
            {[...elements.keys()].reverse().map((i) => {
              const el = elements[i];
              const isSelected = selectedElementIndex === i;
              return (
                <div
                  key={`element-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectElement(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectElement(i); }}
                  className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10.5px] ${
                    isSelected
                      ? 'border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
                      : 'border-transparent text-gray-600 hover:bg-surface dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {el.kind === 'text' ? <Type size={12} className="shrink-0" aria-hidden /> : <Minus size={12} className="shrink-0" aria-hidden />}
                  <span className={`min-w-0 flex-1 truncate ${el.hidden ? 'line-through opacity-50' : ''} ${el.locked ? 'text-gray-400' : ''}`}>
                    {el.kind === 'text' ? `Texto ${i + 1}` : `Linha ${i + 1}`}
                  </span>
                  <span className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <LayerAction title="Subir camada" onClick={() => moveLayer('element', i, 1)} icon={<ChevronUp size={11} aria-hidden />} disabled={i === elements.length - 1} />
                    <LayerAction title="Descer camada" onClick={() => moveLayer('element', i, -1)} icon={<ChevronDown size={11} aria-hidden />} disabled={i === 0} />
                    <LayerAction title={el.hidden ? 'Mostrar' : 'Ocultar'} onClick={() => toggleLayer('element', i)} icon={el.hidden ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />} />
                    <LayerAction title={el.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => toggleLock('element', i)} icon={el.locked ? <Lock size={11} aria-hidden /> : <Unlock size={11} aria-hidden />} />
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );

  // ─── Painel de propriedades ────────────────────────────────────────────────

  const renderProps = (mobile = false) => (
    <div className={`flex h-full w-full flex-col bg-white dark:bg-gray-900 ${mobile ? '' : 'border-l border-line dark:border-gray-800'}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5 dark:border-gray-800">
        <div className="min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">
            Propriedades
          </span>
          <span className="block truncate text-[10.5px] text-gray-400">{selectedLabel}</span>
        </div>
        {mobile && (
          <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={() => setMobilePanel(null)} aria-label="Fechar propriedades">
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      <div className="flex shrink-0 border-b border-line px-1.5 dark:border-gray-800" role="tablist" aria-label="Propriedades">
        {PROPS_TABS.map((t) => {
          const active = propsTab === t.id;
          const count = t.id === 'questoes' ? blocks.length : t.id === 'elementos' ? elements.length : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPropsTab(t.id)}
              className={`relative flex-1 border-b-2 px-1 py-2 text-[10.5px] font-semibold transition-colors ${
                active
                  ? 'border-brand-500 text-brand-700 dark:text-brand-200'
                  : 'border-transparent text-gray-500 hover:text-ink dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`ml-1 rounded-full px-1 py-0.5 text-[9px] ${
                  active ? 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        {propsTab === 'geral' && (
          <>
            <Section title="Documento" hint="Nome, vínculo e textos do cabeçalho.">
              <Field label="Nome do cartão" htmlFor="gen-nome">
                <Input id="gen-nome" className={COMPACT} value={nome} onChange={(e) => rename(e.target.value)} />
              </Field>
              {exams.length > 0 && (
                <Field label="Vincular à prova (opcional)" htmlFor="gen-exam">
                  <Select id="gen-exam" className={COMPACT} value={examId} onChange={(e) => setExamId(e.target.value)}>
                    <option value="">Nenhuma</option>
                    {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </Select>
                </Field>
              )}
            </Section>

            <Section title="Cabeçalho">
              <Field label="Escola" htmlFor="gen-school">
                <Input id="gen-school" className={COMPACT} value={spec.school ?? ''}
                       onChange={(e) => mutate({ school: e.target.value }, 'school')} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Professor(a)" htmlFor="gen-teacher">
                  <Input id="gen-teacher" className={COMPACT} value={spec.teacher ?? ''}
                         onChange={(e) => mutate({ teacher: e.target.value }, 'teacher')} />
                </Field>
                <Field label="Data" htmlFor="gen-date" helper="Automática.">
                  <Input id="gen-date" className={COMPACT} value="" disabled placeholder="Sistema" />
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

        {propsTab === 'questoes' && (
          <>
            <Section title="Blocos de questões" hint="Cada bloco tem numeração e alternativas próprias.">
              <div className="space-y-2">
                {blocks.map((block, i) => (
                  <BlockCard
                    key={i}
                    block={block}
                    index={i}
                    total={blocks.length}
                    selected={selectedBlockIndex === i}
                    onSelect={() => selectBlock(i)}
                    onChange={(patch, coalesce) => updateBlock(i, patch, coalesce)}
                    onRemove={() => removeBlock(i)}
                  />
                ))}
              </div>
              <Button size="sm" variant="secondary" icon={<Plus size={14} aria-hidden />}
                      onClick={addBlock} className="w-full">
                Adicionar bloco
              </Button>
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <button type="button" onClick={resetBlockPositions} className="inline-flex items-center gap-1 hover:text-brand-600">
                  <RotateCcw size={12} aria-hidden /> Reorganizar
                </button>
                <span>Total: {totalQuestions} questão(ões)</span>
              </div>
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
                <Field label="Entre alternativas (mm)" htmlFor="gen-gapx">
                  <Input id="gen-gapx" type="number" min={1} max={20} step={0.5} className={COMPACT}
                         value={spec.option_gap_mm ?? ''}
                         onChange={(e) => mutate({ option_gap_mm: numOrUndefined(e.target.value) }, 'gap-x')} />
                </Field>
                <Field label="Entre questões (mm)" htmlFor="gen-gapy">
                  <Input id="gen-gapy" type="number" min={0.5} max={20} step={0.5} className={COMPACT}
                         value={spec.row_gap_mm ?? ''}
                         onChange={(e) => mutate({ row_gap_mm: numOrUndefined(e.target.value) }, 'gap-y')} />
                </Field>
                <Field label="Entre colunas (mm)" htmlFor="gen-colgap">
                  <Input id="gen-colgap" type="number" min={4} max={60} step={0.5} className={COMPACT}
                         value={spec.column_gap_mm ?? ''}
                         onChange={(e) => mutate({ column_gap_mm: numOrUndefined(e.target.value) }, 'gap-col')} />
                </Field>
              </div>
            </Section>
          </>
        )}

        {propsTab === 'elementos' && (
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
                  Nenhum elemento ainda. Arraste textos e linhas no canvas para personalizar a folha.
                </p>
              ) : (
                <div className="space-y-2">
                  {elements.map((el, i) => (
                    <ElementCard
                      key={i}
                      element={el}
                      index={i}
                      selected={selectedElementIndex === i}
                      onChange={(patch, coalesce) => updateElement(i, patch, coalesce)}
                      onRemove={() => removeElement(i)}
                      onSelect={() => selectElement(i)}
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

        {propsTab === 'pagina' && (
          <>
            <Section title="Página" hint="Formato, orientação e margem.">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Formato" htmlFor="gen-format">
                  <Select id="gen-format" className={COMPACT} value={spec.page_format}
                          onChange={(e) => changePage({ page_format: e.target.value as CardSpec['page_format'] })}>
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                    <option value="Letter">Carta</option>
                    <option value="Oficio">Ofício</option>
                    <option value="custom">Personalizado</option>
                  </Select>
                </Field>
                <Field label="Orientação" htmlFor="gen-orient">
                  <Select id="gen-orient" className={COMPACT} value={spec.orientation}
                          onChange={(e) => changePage({ orientation: e.target.value as CardSpec['orientation'] })}>
                    <option value="portrait">Retrato</option>
                    <option value="landscape">Paisagem</option>
                  </Select>
                </Field>
              </div>
              {spec.page_format === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Largura (mm)" htmlFor="gen-pw">
                    <Input id="gen-pw" type="number" min={50} max={1000} className={COMPACT}
                           value={spec.page_w_mm ?? ''}
                           onChange={(e) => changePage({ page_w_mm: numOrUndefined(e.target.value) })} />
                  </Field>
                  <Field label="Altura (mm)" htmlFor="gen-ph">
                    <Input id="gen-ph" type="number" min={50} max={1000} className={COMPACT}
                           value={spec.page_h_mm ?? ''}
                           onChange={(e) => changePage({ page_h_mm: numOrUndefined(e.target.value) })} />
                  </Field>
                </div>
              )}
              <Field label="Margem de segurança (mm)" htmlFor="gen-margin">
                <Input id="gen-margin" type="number" min={3} max={40} className={COMPACT}
                       value={spec.margin_mm ?? ''}
                       onChange={(e) => mutate({ margin_mm: numOrUndefined(e.target.value) }, 'margin')} />
              </Field>
            </Section>

            <Section title="Exibição">
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                Réguas em milímetros
                <input type="checkbox" checked={rulers} onChange={(e) => setRulers(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                Grade de 10 mm
                <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                Encaixar ao arrastar
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                Mostrar margem de segurança
                <input type="checkbox" checked={showMargin} onChange={(e) => setShowMargin(e.target.checked)} />
              </label>
              <Button size="sm" variant="secondary" icon={<RefreshCw size={14} aria-hidden />}
                      onClick={() => setRefreshKey((k) => k + 1)} className="w-full">
                Atualizar prévia
              </Button>
            </Section>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 dark:border-gray-800">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[10.5px] text-gray-500 dark:text-gray-400">
          <span className={`h-2 w-2 shrink-0 rounded-full ${errorCount ? 'bg-danger-500' : warningCount ? 'bg-warning-500' : 'bg-success-500'}`} />
          <span className="truncate">
            {errorCount
              ? `${errorCount} problema${errorCount > 1 ? 's' : ''}`
              : warningCount
                ? `${warningCount} aviso${warningCount > 1 ? 's' : ''}`
                : 'Pronto para ativar'}
          </span>
        </span>
        <Button size="sm" variant="secondary" icon={<ShieldCheck size={13} aria-hidden />}
                onClick={() => goStep(3)} disabled={!preview || previewing}>
          Validar
        </Button>
      </div>
    </div>
  );

  // ─── Galeria de modelos ────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card dark:border-gray-800 dark:bg-gray-900">
        <Stepper
          step={step} hasModel={false} hasPreview={false}
          meta="Criação · A4 retrato" onStep={goStep} onValidate={() => undefined}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
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
        </div>
      </div>
    );
  }

  // ─── Etapa 3: validação ────────────────────────────────────────────────────

  if (step === 3) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card dark:border-gray-800 dark:bg-gray-900">
        <Stepper
          step={step} hasModel hasPreview={!!preview}
          meta={`${spec.page_format === 'custom' ? 'Personalizado' : spec.page_format} · ${spec.orientation === 'landscape' ? 'paisagem' : 'retrato'}`}
          onStep={goStep} onValidate={() => undefined}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-h-[420px] items-center justify-center overflow-auto rounded-xl bg-surface p-4 dark:bg-gray-950">
              {preview?.image ? (
                <img
                  src={preview.image}
                  alt="Prévia do cartão"
                  className="max-h-[64vh] w-auto max-w-full bg-white shadow-[0_4px_8px_rgba(20,22,28,.10),0_16px_30px_rgba(20,22,28,.10)]"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  {previewError ? (
                    <>
                      <AlertTriangle size={22} className="text-danger-500" aria-hidden />
                      <p className="max-w-xs text-xs text-danger-600 dark:text-danger-300">{previewError}</p>
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
            </div>

            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-ink dark:text-white">Validar e ativar</h2>
                <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  Confira o resumo da folha. Se estiver tudo certo, gere o cartão para começar a ler.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Questões', value: preview?.summary.n_questions ?? totalQuestions },
                  { label: 'Blocos', value: preview?.summary.n_blocks ?? blocks.length },
                  { label: 'Âncoras', value: preview?.summary.n_anchors ?? 4 },
                  { label: 'Elementos', value: preview?.summary.n_elements ?? elements.length },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg bg-surface p-2.5 dark:bg-gray-800/60">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{item.label}</p>
                    <p className="text-lg font-semibold text-ink dark:text-white">{item.value}</p>
                  </div>
                ))}
              </div>

              {exams.length > 0 && (
                <Field label="Vincular à prova (opcional)" htmlFor="gen-exam-valid">
                  <Select id="gen-exam-valid" className={COMPACT} value={examId} onChange={(e) => setExamId(e.target.value)}>
                    <option value="">Nenhuma</option>
                    {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </Select>
                </Field>
              )}

              <div className="space-y-1.5">
                {errorCount > 0 && (
                  <p className="callout-danger flex items-start gap-1.5 text-[11px]">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                    {errorCount} problema(s) impedem a leitura. Volte ao editor e ajuste.
                  </p>
                )}
                {preview?.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <Info size={12} className="mt-0.5 shrink-0" aria-hidden />{w}
                  </p>
                ))}
                {preview?.issues.filter((i) => i.level === 'error').map((i, k) => (
                  <p key={k} className="flex items-start gap-1.5 text-[11px] text-danger-600 dark:text-danger-300">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{i.message}
                  </p>
                ))}
                {errorCount === 0 && (
                  <p className="callout-success flex items-start gap-1.5 text-[11px]">
                    <Check size={13} className="mt-0.5 shrink-0" aria-hidden />
                    Estrutura pronta: âncoras, QR e blocos serão gravados como um modelo normal.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t border-line pt-3 dark:border-gray-800">
                <Button
                  onClick={() => void handleGenerate()}
                  loading={busy}
                  disabled={!preview || previewing || errorCount > 0}
                  icon={<Sparkles size={15} aria-hidden />}
                >
                  Gerar cartão e ativar
                </Button>
                <Button variant="secondary" onClick={() => setStep(2)} icon={<ArrowLeft size={15} aria-hidden />}>
                  Voltar ao editor
                </Button>
                <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Etapa 2: editor ──────────────────────────────────────────────────────

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card dark:border-gray-800 dark:bg-gray-900">
      {/* Topbar */}
      <div className="flex items-center gap-2 border-b border-line bg-white px-2.5 py-2 dark:border-gray-800 dark:bg-gray-900">
        <button
          type="button"
          onClick={() => setStep(1)}
          className="btn-icon !min-h-[34px] !min-w-[34px]"
          title="Voltar aos modelos"
          aria-label="Voltar aos modelos"
        >
          <ArrowLeft size={17} aria-hidden />
        </button>
        <span className="hidden h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white sm:flex">
          <LayoutGrid size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:block">
            Criar gabarito personalizado
          </span>
          <input
            value={nome}
            onChange={(e) => rename(e.target.value)}
            aria-label="Nome do cartão"
            className="w-full min-w-0 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink outline-none transition-colors hover:border-line focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:text-white dark:hover:border-gray-700"
          />
        </div>
        <span className="hidden text-[11px] text-gray-400 md:block">
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
            disabled={!preview || previewing || errorCount > 0}
            icon={<FileDown size={15} aria-hidden />}
            className="ml-1 hidden sm:inline-flex"
          >
            Gerar cartão
          </Button>
        </div>
      </div>

      <Stepper
        step={step} hasModel hasPreview={!!preview}
        meta={`${spec.page_format === 'custom' ? 'Personalizado' : spec.page_format} · ${spec.orientation === 'landscape' ? 'paisagem' : 'retrato'}`}
        onStep={goStep} onValidate={() => goStep(3)}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[236px] shrink-0 lg:block">{renderTools()}</aside>

        {/* Canvas */}
        <section className="flex min-w-0 flex-1 flex-col bg-[#EEF1F6] dark:bg-gray-950" aria-label="Área de edição do cartão">
          <div className="flex flex-wrap items-center gap-1 border-b border-line bg-white px-2 py-1.5 dark:border-gray-800 dark:bg-gray-900">
            <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[10.5px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <Layers size={12} aria-hidden /> 1 / 1
            </span>
            <span className="mx-1 h-5 w-px bg-line dark:bg-gray-700" aria-hidden />
            <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={() => { zoomManualRef.current = true; setZoom((z) => clamp(Math.round((z - 0.1) * 10) / 10, 0.3, 2)); }} aria-label="Diminuir zoom" title="Diminuir zoom">
              <ZoomOut size={15} aria-hidden />
            </button>
            <span className="w-10 text-center text-[11px] font-semibold text-gray-500">{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={() => { zoomManualRef.current = true; setZoom((z) => clamp(Math.round((z + 0.1) * 10) / 10, 0.3, 2)); }} aria-label="Aumentar zoom" title="Aumentar zoom">
              <ZoomIn size={15} aria-hidden />
            </button>
            <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={fitToScreen} aria-label="Ajustar à tela" title="Ajustar à tela">
              <Maximize2 size={15} aria-hidden />
            </button>
            <span className="mx-1 hidden h-5 w-px bg-line dark:bg-gray-700 sm:block" aria-hidden />
            <ToolbarToggle title="Réguas" active={rulers} onClick={() => setRulers((v) => !v)} icon={<Ruler size={15} aria-hidden />} />
            <ToolbarToggle title="Grade" active={grid} onClick={() => setGrid((v) => !v)} icon={<Grid3x3 size={15} aria-hidden />} />
            <ToolbarToggle title="Guias de alinhamento" active={snap} onClick={() => setSnap((v) => !v)} icon={<Crosshair size={15} aria-hidden />} />
            <span className="ml-auto flex items-center gap-1">
              <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px] lg:hidden" onClick={() => setMobilePanel('tools')} aria-label="Ferramentas">
                <PanelLeft size={16} aria-hidden />
              </button>
              <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px] lg:hidden" onClick={() => setMobilePanel('props')} aria-label="Propriedades">
                <PanelRight size={16} aria-hidden />
              </button>
              {previewing && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10.5px] text-gray-500 dark:bg-gray-800">
                  <Loader2 size={11} className="animate-spin" aria-hidden /> atualizando
                </span>
              )}
            </span>
          </div>

          <div ref={canvasScrollRef} className="relative min-h-0 flex-1 overflow-auto">
            <div className="flex min-h-full min-w-full">
              <div
                className="m-auto grid shrink-0 p-5"
                style={{
                  gridTemplateColumns: rulers ? '21px auto' : 'auto',
                  gridTemplateRows: rulers ? '21px auto' : 'auto',
                }}
              >
                {rulers && <div aria-hidden />}
                {rulers && (
                  <div className="relative overflow-hidden border border-line bg-[#FBFCFE] dark:border-gray-700 dark:bg-gray-900" style={{ width: displayW, height: 21 }} aria-hidden>
                    {Array.from({ length: Math.floor(pageW / 10) + 1 }).map((_, i) => {
                      const mm = i * 10;
                      const major = mm % 20 === 0;
                      return (
                        <span key={mm}>
                          <span className="absolute top-0 w-px bg-[#B7C4D6]" style={{ left: mm * pxPerMm, height: major ? 8 : 4 }} />
                          {major && mm < pageW && (
                            <span className="absolute top-[10px] -translate-x-1/2 text-[7.5px] leading-none text-[#7C8DA6]" style={{ left: mm * pxPerMm }}>
                              {mm}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
                {rulers && (
                  <div className="relative overflow-hidden border border-line bg-[#FBFCFE] dark:border-gray-700 dark:bg-gray-900" style={{ width: 21, height: displayH }} aria-hidden>
                    {Array.from({ length: Math.floor(pageH / 10) + 1 }).map((_, i) => {
                      const mm = i * 10;
                      const major = mm % 20 === 0;
                      return (
                        <span key={mm}>
                          <span className="absolute left-0 h-px bg-[#B7C4D6]" style={{ top: mm * pxPerMm, width: major ? 8 : 4 }} />
                          {major && mm < pageH && (
                            <span
                              className="absolute left-[10px] text-[7.5px] leading-none text-[#7C8DA6]"
                              style={{ top: mm * pxPerMm, transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'center' }}
                            >
                              {mm}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div
                  ref={pageWrapRef}
                  onPointerMove={onPagePointerMove}
                  onPointerUp={onPagePointerUp}
                  onPointerCancel={onPagePointerUp}
                  className="relative select-none bg-white shadow-[0_4px_8px_rgba(20,22,28,.10),0_16px_30px_rgba(20,22,28,.10)]"
                  style={{ width: displayW, height: displayH, touchAction: 'none' }}
                >
                  {preview?.image ? (
                    <img
                      src={preview.image}
                      alt="Prévia do cartão"
                      draggable={false}
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-6 text-center">
                      {previewError ? (
                        <>
                          <AlertTriangle size={22} className="text-danger-500" aria-hidden />
                          <p className="max-w-[240px] text-[11px] text-danger-600 dark:text-danger-300">{previewError}</p>
                          <Button size="sm" variant="secondary" onClick={() => setRefreshKey((k) => k + 1)}>
                            Tentar novamente
                          </Button>
                        </>
                      ) : (
                        <>
                          <Loader2 size={22} className="animate-spin text-brand-500" aria-hidden />
                          <p className="text-[11px] text-gray-500">Gerando prévia…</p>
                        </>
                      )}
                    </div>
                  )}

                  <div className="absolute inset-0 z-0" onPointerDown={() => setSelected(null)} />

                  {grid && (
                    <div
                      className="pointer-events-none absolute inset-0 z-[1]"
                      style={{
                        backgroundImage:
                          'linear-gradient(to right, rgba(23,105,255,.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(23,105,255,.14) 1px, transparent 1px)',
                        backgroundSize: `${10 * pxPerMm}px ${10 * pxPerMm}px`,
                      }}
                      aria-hidden
                    />
                  )}

                  {showMargin && (
                    <div
                      className="pointer-events-none absolute z-[2] border border-dashed border-brand-500/70"
                      style={{
                        top: `${(margin / pageH) * 100}%`,
                        bottom: `${(margin / pageH) * 100}%`,
                        left: `${(margin / pageW) * 100}%`,
                        right: `${(margin / pageW) * 100}%`,
                      }}
                      aria-hidden
                    />
                  )}

                  {/* Blocos de questões: caixas de seleção/arraste */}
                  {blocks.map((b, i) => {
                    if (b.hidden) return null;
                    const g = blockBounds(i);
                    if (!g) return null;
                    const isSelected = selectedBlockIndex === i;
                    return (
                      <div
                        key={`block-${i}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${blockName(b, i)}${b.locked ? ' (bloqueado)' : ''}`}
                        onPointerDown={(e) => startBlockDrag(e, i)}
                        onKeyDown={(e) => { if (e.key === 'Enter') selectBlock(i); }}
                        className={`absolute z-10 rounded-[3px] border-2 transition-colors ${
                          isSelected
                            ? 'border-brand-500 bg-brand-500/[0.06]'
                            : 'border-brand-500/35 bg-brand-500/[0.02] hover:border-brand-500/80'
                        } ${b.locked ? 'cursor-default' : 'cursor-move'}`}
                        style={{
                          left: `${(g.x / pageW) * 100}%`,
                          top: `${(g.y / pageH) * 100}%`,
                          width: `${(g.w / pageW) * 100}%`,
                          height: `${(g.h / pageH) * 100}%`,
                          touchAction: 'none',
                        }}
                      >
                        <span className={`pointer-events-none absolute -top-[18px] left-0 inline-flex max-w-full items-center gap-1 truncate rounded-t bg-brand-500 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white ${isSelected ? '' : 'opacity-70'}`}>
                          {b.locked && <Lock size={9} aria-hidden />}
                          {blockName(b, i)}
                        </span>
                        {isSelected && !b.locked && (
                          <>
                            {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeDir[]).map((dir) => {
                              const style: React.CSSProperties = {
                                left: dir.includes('w') ? 0 : dir.includes('e') ? '100%' : '50%',
                                top: dir.includes('n') ? 0 : dir.includes('s') ? '100%' : '50%',
                                transform: 'translate(-50%, -50%)',
                                cursor: `${dir}-resize`,
                              };
                              return (
                                <button
                                  key={dir}
                                  type="button"
                                  aria-label={`Redimensionar ${dir}`}
                                  onPointerDown={(e) => startBlockResize(e, i, dir)}
                                  className="absolute z-20 h-2.5 w-2.5 rounded-[2px] border border-brand-500 bg-white shadow-sm"
                                  style={style}
                                />
                              );
                            })}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Elementos decorativos: caixas de arraste */}
                  {elements.map((el, i) => {
                    if (el.hidden) return null;
                    const isSelected = selectedElementIndex === i;
                    return (
                      <div
                        key={`element-${i}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${el.kind === 'text' ? 'Texto' : 'Linha'} ${i + 1}${el.locked ? ' (bloqueado)' : ''}`}
                        onPointerDown={(e) => startElementDrag(e, i)}
                        onKeyDown={(e) => { if (e.key === 'Enter') selectElement(i); }}
                        className={`absolute z-20 rounded-[2px] border border-dashed transition-colors ${
                          isSelected
                            ? 'border-brand-500 bg-brand-500/[0.05]'
                            : 'border-transparent hover:border-brand-400/70'
                        } ${el.locked ? 'cursor-default' : 'cursor-move'}`}
                        style={{
                          left: `${el.x * 100}%`,
                          top: `${el.y * 100}%`,
                          width: `${Math.max(el.w * 100, 1)}%`,
                          height: `${Math.max(el.h * 100, 0.4)}%`,
                          minHeight: 10,
                          touchAction: 'none',
                        }}
                      >
                        {isSelected && (
                          <span className="pointer-events-none absolute -top-[16px] left-0 inline-flex items-center gap-1 rounded bg-brand-500 px-1 py-0.5 text-[8.5px] font-semibold leading-none text-white">
                            {el.locked && <Lock size={8} aria-hidden />}
                            {el.kind === 'text' ? 'Texto' : 'Linha'} {i + 1}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line bg-white px-3 py-1.5 text-[10.5px] text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            <span className="min-w-0 truncate">
              {selectedLabel === 'Documento'
                ? 'Selecione um bloco ou elemento para editar as propriedades.'
                : `Selecionado: ${selectedLabel}`}
            </span>
            <span className="shrink-0">
              {pageW.toFixed(0)} × {pageH.toFixed(0)} mm · {Math.round(zoom * 100)}%
            </span>
          </div>
        </section>

        <aside className="hidden w-[328px] shrink-0 lg:block">{renderProps()}</aside>
      </div>

      {/* Barra mobile */}
      <div className="flex shrink-0 items-center gap-1 border-t border-line bg-white p-1.5 dark:border-gray-800 dark:bg-gray-900 lg:hidden">
        <button type="button" onClick={() => setMobilePanel('tools')} className="btn btn-secondary btn-sm flex-1">
          <Layers size={14} aria-hidden /> Ferramentas
        </button>
        <button type="button" onClick={() => setMobilePanel('props')} className="btn btn-secondary btn-sm flex-1">
          <PanelRight size={14} aria-hidden /> Propriedades
        </button>
      </div>

      {/* Gavetas mobile */}
      {mobilePanel && (
        <div className="absolute inset-0 z-40 flex bg-navy-950/35 lg:hidden" onClick={() => setMobilePanel(null)}>
          <div
            className={`relative flex h-full w-[86%] max-w-[320px] bg-white shadow-modal dark:bg-gray-900 ${
              mobilePanel === 'props' ? 'ml-auto' : ''
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {mobilePanel === 'tools' ? renderTools(true) : renderProps(true)}
          </div>
        </div>
      )}
    </div>
  );
}

function LayerAction({
  title, onClick, icon, disabled,
}: {
  title: string;
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex h-4 w-4 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-navy-900 disabled:opacity-25 dark:hover:bg-gray-700 dark:hover:text-white"
    >
      {icon}
    </button>
  );
}

function ToolbarToggle({
  title, active, onClick, icon,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`btn-icon !min-h-[30px] !min-w-[30px] ${active ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-200' : ''}`}
    >
      {icon}
    </button>
  );
}
