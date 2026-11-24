import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, CircleDot,
  Copy, Crosshair, Eye, EyeOff, FileDown, FileText, Focus, Grid3x3, Info, LayoutGrid,
  Layers, ListChecks, Loader2, Lock, Maximize2, MessageSquare, Minus, MousePointer2,
  Move, PanelLeft, PanelRight, Plus, QrCode, Redo2, RefreshCw, RotateCcw, Ruler,
  Scaling, ShieldCheck, Sparkles, Trash2, Type, Undo2, Unlock, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { Exam } from '../../types';
import { syncExam } from '../../utils/api';
import {
  activateCustomTemplate,
  generateCustomTemplateFromSpec,
  previewGeneratedCard,
  type CardBlockSpec,
  type CardElementSpec,
  type CardSpec,
  type CornerName,
  type CustomTemplateDetail,
  type GeneratePreviewResult,
} from '../../utils/custom-template-api';
import { type Rect } from '../../utils/custom-template-edit';
import {
  clampRectMm, findSnapMm, fitZoom, resizeRectMm, rulerTicks, snapResizeMm,
  snapToGridWithin, squareResizeMm, zoomStep, GRID_MM, MM_PX,
  type RectMm,
} from '../../utils/sheet-geometry';
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
    title: 'Padrão livre',
    desc: 'A4 com 20 questões e identificação livre.',
    tag: 'Livre',
    name: 'Cartão-resposta',
    spec: {
      title: 'Cartão-resposta',
      subtitle: '',
      // O modelo "livre" evita campos/instruções fixos: tudo pode ser
      // adicionado depois no editor, mas o cartão continua válido sozinho.
      fields: [],
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
type SelectionKind = 'block' | 'element' | 'anchor' | 'qr';
type Selection = { kind: SelectionKind; index: number };
type ToolMode = 'select' | 'move' | 'resize';
type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const ANCHOR_CORNERS: CornerName[] = ['TL', 'TR', 'BR', 'BL'];

const ANCHOR_LABELS: Record<CornerName, string> = {
  TL: 'Âncora superior esquerda',
  TR: 'Âncora superior direita',
  BR: 'Âncora inferior direita',
  BL: 'Âncora inferior esquerda',
};

const COMPACT = '!min-h-[38px] !py-1.5 text-xs';

const STEP_LABELS = ['Modelo inicial', 'Editor da folha', 'Validar e gerar'];

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

interface DragItem {
  kind: SelectionKind;
  index: number;
  /** Retângulo de partida, em milímetros. */
  rect: RectMm;
}

type DragState =
  | {
      kind: 'move';
      startX: number;
      startY: number;
      items: DragItem[];
      orig: RectMm;
      moved?: boolean;
    }
  | {
      kind: 'resize';
      target: Selection;
      dir: ResizeDir;
      startX: number;
      startY: number;
      orig: RectMm;
      moved?: boolean;
    }
  | {
      kind: 'marquee';
      startX: number;
      startY: number;
      start: RectMm;
      additive: boolean;
      moved?: boolean;
      box?: RectMm;
    }
  | {
      kind: 'pan';
      startX: number;
      startY: number;
      scrollLeft: number;
      scrollTop: number;
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

/** Converte `font_mm` de modelos antigos no equivalente em pontos (1 pt = 1/72"). */
function fontMmToPt(fontMm: number | undefined): number {
  return Math.max(4, Math.round(((fontMm ?? 4) / 25.4) * 72));
}

/**
 * Tamanho da fonte em pontos tipográficos (pt). Vazio = `auto`, que mantém o
 * tamanho padrão do gerador (derivado de mm), então modelos antigos continuam
 * iguais.
 */
function FontPtField({ label, value, onChange }: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div>
      <span className="mb-0.5 block text-[10px] text-gray-400">{label}</span>
      <Input
        type="number" min={4} max={200} step={0.5}
        className={COMPACT}
        value={value ?? ''}
        placeholder="auto"
        aria-label={`Tamanho da fonte de ${label} em pontos`}
        onChange={(e) => onChange(numOrUndefined(e.target.value))}
      />
    </div>
  );
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

/** Um bloco tem posição livre quando todas as quatro medidas estão definidas. */
function hasBlockPos(b: CardBlockSpec): b is CardBlockSpec & {
  x_mm: number; y_mm: number; w_mm: number; h_mm: number;
} {
  return b.x_mm != null && b.y_mm != null && b.w_mm != null && b.h_mm != null;
}

/** Remove um item da seleção e reindexa os que vinham depois dele. */
function dropFromSelection(list: Selection[], kind: 'block' | 'element', index: number): Selection[] {
  return list
    .filter((s) => !(s.kind === kind && s.index === index))
    .map((s) => (s.kind === kind && s.index > index ? { ...s, index: s.index - 1 } : s));
}

/** Digitação em campo de formulário não deve disparar atalhos do editor. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

function rectsIntersect(a: RectMm, b: RectMm): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function mergeSelection(base: Selection[], extra: Selection[]): Selection[] {
  const out = [...base];
  for (const item of extra) {
    if (!out.some((s) => s.kind === item.kind && s.index === item.index)) out.push(item);
  }
  return out;
}

function bboxOf(rects: RectMm[]): RectMm {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

// ─── Componentes internos ─────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.09em] text-gray-500 dark:text-gray-400">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500 dark:text-gray-400">{hint}</p>}
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
  const options = kind === 'survey' ? 5 : kind === 'exam' ? 5 : 4;
  const columns = kind === 'survey' || kind === 'blank' ? 1 : kind === 'exam' ? 3 : 2;
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
              <span className="mb-0.5 block text-[10px] text-gray-400">Fonte (pt)</span>
              <Input
                type="number" min={4} max={200} step={0.5}
                value={element.font_pt ?? fontMmToPt(element.font_mm)}
                className={COMPACT}
                aria-label="Tamanho da fonte do texto em pontos"
                onChange={(e) => onChange({ font_pt: numOrUndefined(e.target.value), font_mm: undefined }, `el-${index}-font`)}
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

/**
 * Tamanhos de fonte do cartão, em pixels da imagem. Não são por bloco porque
 * valem para a folha inteira; ficam num painel dedicado no fim das propriedades.
 */
function CardFontsPanel({
  spec, mutate,
}: {
  spec: CardSpec;
  mutate: (patch: Partial<CardSpec>, coalesce: string) => void;
}) {
  return (
    <Section title="Tamanho das fontes" hint="Em pontos tipográficos (pt); use auto para o padrão.">
      <div className="grid grid-cols-2 gap-2">
        <FontPtField label="Título" value={spec.title_font_pt}
                     onChange={(v) => mutate({ title_font_pt: v }, 'font-title')} />
        <FontPtField label="Subtítulo" value={spec.subtitle_font_pt}
                     onChange={(v) => mutate({ subtitle_font_pt: v }, 'font-subtitle')} />
        <FontPtField label="Escola" value={spec.school_font_pt}
                     onChange={(v) => mutate({ school_font_pt: v }, 'font-school')} />
        <FontPtField label="Professor(a)" value={spec.teacher_font_pt}
                     onChange={(v) => mutate({ teacher_font_pt: v }, 'font-teacher')} />
        <FontPtField label="Instruções" value={spec.instructions_font_pt}
                     onChange={(v) => mutate({ instructions_font_pt: v }, 'font-instr')} />
        <FontPtField label="Rótulos dos campos" value={spec.field_font_pt}
                     onChange={(v) => mutate({ field_font_pt: v }, 'font-field')} />
        <FontPtField label="Título dos blocos" value={spec.block_title_font_pt}
                     onChange={(v) => mutate({ block_title_font_pt: v }, 'font-block-title')} />
        <FontPtField label="Número das questões" value={spec.question_font_pt}
                     onChange={(v) => mutate({ question_font_pt: v }, 'font-question')} />
        <FontPtField label="Letras das alternativas" value={spec.label_font_pt}
                     onChange={(v) => mutate({ label_font_pt: v }, 'font-label')} />
      </div>
      <p className="text-[10px] text-gray-400">
        O valor <strong>auto</strong> mantém o tamanho padrão do gerador, calculado a
        partir das bolhas — bom ponto de partida antes de ajustar no olho. Pontos são
        a unidade do papel: 1 pt = 1/72 de polegada, então o texto sai do mesmo
        tamanho na impressão, independente da resolução do cartão.
      </p>
    </Section>
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

  const [selection, setSelection] = useState<Selection[]>([]);
  const [tool, setTool] = useState<ToolMode>('select');
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [marquee, setMarquee] = useState<RectMm | null>(null);
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

  // A folha é desenhada em milímetros reais (96 dpi) e o zoom é só escala.
  const displayW = pageW * MM_PX * zoom;
  const displayH = pageH * MM_PX * zoom;
  const pxPerMm = MM_PX * zoom;

  const primary = selection.length ? selection[selection.length - 1] : null;
  const selectedBlockIndex = primary?.kind === 'block' && primary.index < blocks.length
    ? primary.index : null;
  const selectedElementIndex = primary?.kind === 'element' && primary.index < elements.length
    ? primary.index : null;
  const selectedAnchorIndex = primary?.kind === 'anchor' && primary.index < ANCHOR_CORNERS.length
    ? primary.index : null;
  const selectedQr = primary?.kind === 'qr';
  const isSelected = useCallback(
    (kind: SelectionKind, index: number) =>
      selection.some((s) => s.kind === kind && s.index === index),
    [selection],
  );

  // ─── Histórico ─────────────────────────────────────────────────────────────

  const pushHistory = useCallback((coalesce?: string) => {
    const now = Date.now();
    const same = coalesce
      && lastCoalesce.current?.key === coalesce
      && now - lastCoalesce.current.at < 950;
    if (!same) {
      past.current = [...past.current.slice(-44), { spec, nome }];
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
    past.current = [...past.current.slice(-44), { spec, nome }];
    setSpec(next.spec);
    setNome(next.nome);
    lastCoalesce.current = null;
    setHistoryTick((n) => n + 1);
  }, [spec, nome]);

  // (Atalhos do editor: registrados depois que as ações estão definidas.)

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
    setSelection([]);
    setTool('select');
    setGuides({ x: [], y: [] });
    setMarquee(null);
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
      // O botão promete ativar: gerar só grava como validado/rascunho.
      try {
        const act = await activateCustomTemplate(d.id);
        notify('Cartão gerado e ativado.', 'success');
        onCreated({ ...d, status: act.status as CustomTemplateDetail['status'] });
      } catch (e) {
        notify(
          `Cartão gerado, mas não foi possível ativar: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
          'info',
        );
        onCreated(d);
      }
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
      // Posições em mm não fazem sentido no novo formato/tamanho de página.
      anchor_layout: undefined,
      qr_layout: undefined,
    }));
  };

  const resetCodePositions = () => {
    pushHistory();
    setSpec((prev) => ({ ...prev, anchor_layout: undefined, qr_layout: undefined }));
    setSelection([]);
    notify('Âncoras e QR voltaram às posições padrão.', 'info');
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

  /** Congela o layout automático dos blocos (mm) antes de uma edição livre. */
  const freezeBlockPositions = useCallback((list: CardBlockSpec[]): CardBlockSpec[] =>
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
    }), [preview]);

  const blockBounds = useCallback((index: number): Rect & { w: number; h: number } | null => {
    const b = blocks[index];
    if (!b) return null;
    if (hasBlockPos(b)) {
      return { x: b.x_mm, y: b.y_mm, w: b.w_mm, h: b.h_mm };
    }
    const l = preview?.layout?.find((item) => item.index === index);
    if (!l) return null;
    return { x: l.x_mm, y: l.y_mm, w: l.w_mm, h: l.h_mm };
  }, [blocks, preview]);

  /** Retângulo da âncora (mm): layout do spec, prévia ou canto padrão. */
  const anchorRectMm = useCallback((corner: CornerName): RectMm | null => {
    if (spec.anchors === false) return null;
    const local = spec.anchor_layout?.[corner];
    if (local) {
      return { x: local.x_mm, y: local.y_mm, w: local.size_mm, h: local.size_mm };
    }
    const fromPreview = preview?.anchors_layout?.find((a) => a.corner === corner);
    if (fromPreview) {
      return { x: fromPreview.x_mm, y: fromPreview.y_mm, w: fromPreview.size_mm, h: fromPreview.size_mm };
    }
    const size = spec.anchor_mm ?? 10;
    const m = spec.margin_mm ?? 10;
    return {
      x: corner === 'TL' || corner === 'BL' ? m : pageW - m - size,
      y: corner === 'TL' || corner === 'TR' ? m : pageH - m - size,
      w: size,
      h: size,
    };
  }, [spec.anchors, spec.anchor_layout, spec.anchor_mm, spec.margin_mm, preview, pageW, pageH]);

  /** Retângulo do QR (mm): layout do spec, prévia ou canto superior direito. */
  const qrRectMm = useCallback((): RectMm | null => {
    if (spec.qr === false) return null;
    const local = spec.qr_layout;
    if (local) {
      return { x: local.x_mm, y: local.y_mm, w: local.w_mm, h: local.h_mm };
    }
    const fromPreview = preview?.qr_layout;
    if (fromPreview) {
      return { x: fromPreview.x_mm, y: fromPreview.y_mm, w: fromPreview.w_mm, h: fromPreview.h_mm };
    }
    const size = spec.qr_mm ?? 22;
    const m = spec.margin_mm ?? 10;
    const pad = spec.anchors === false ? 0 : (spec.anchor_mm ?? 10) + 3;
    return { x: pageW - m - pad - size, y: m + pad, w: size, h: size };
  }, [spec.qr, spec.qr_layout, spec.qr_mm, spec.anchors, spec.anchor_mm, spec.margin_mm, preview, pageW]);

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
    setSelection([{ kind: 'block', index: newIndex }]);
    setPropsTab('questoes');
  };

  const updateBlock = (index: number, patch: Partial<CardBlockSpec>, coalesce: string) => {
    mutate({ blocks: blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) }, coalesce);
  };

  const removeBlock = (index: number) => {
    if (blocks.length <= 1) return;
    mutate({ blocks: blocks.filter((_, i) => i !== index) }, 'blocks');
    setSelection((prev) => dropFromSelection(prev, 'block', index));
  };

  const addElement = (kind: CardElementSpec['kind']) => {
    const base: CardElementSpec = kind === 'text'
      ? { kind, text: 'Novo texto', x: 0.08, y: 0.12, w: 0.5, h: 0.05, font_pt: 11, align: 'left' }
      : { kind, x: 0.08, y: 0.5, w: 0.84, h: 0.006 };
    const newIndex = elements.length;
    mutate({ elements: [...elements, base] }, 'elements');
    setSelection([{ kind: 'element', index: newIndex }]);
    setPropsTab('elementos');
  };

  const updateElement = (index: number, patch: Partial<CardElementSpec>, coalesce: string) => {
    mutate({ elements: elements.map((e, i) => (i === index ? { ...e, ...patch } : e)) }, coalesce);
  };

  const removeElement = (index: number) => {
    mutate({ elements: elements.filter((_, i) => i !== index) }, 'elements');
    setSelection((prev) => dropFromSelection(prev, 'element', index));
  };

  /**
   * Resolve a seleção depois de um clique. Sem Shift, clicar num item já
   * selecionado mantém a seleção múltipla (para arrastar o grupo, como no
   * protótipo); com Shift, alterna o item.
   */
  const resolveSelection = (item: Selection, additive: boolean): Selection[] => {
    const exists = isSelected(item.kind, item.index);
    if (additive) {
      return exists
        ? selection.filter((s) => !(s.kind === item.kind && s.index === item.index))
        : [...selection, item];
    }
    return exists ? selection : [item];
  };

  const selectBlock = (index: number, additive = false) => {
    setSelection(resolveSelection({ kind: 'block', index }, additive));
    setPropsTab('questoes');
  };

  const selectElement = (index: number, additive = false) => {
    setSelection(resolveSelection({ kind: 'element', index }, additive));
    setPropsTab('elementos');
  };

  const clearSelection = useCallback(() => setSelection([]), []);

  const selectAll = useCallback(() => {
    const all: Selection[] = [];
    blocks.forEach((b, index) => {
      if (!b.hidden) all.push({ kind: 'block', index });
    });
    elements.forEach((el, index) => {
      if (!el.hidden) all.push({ kind: 'element', index });
    });
    if (spec.anchors !== false) {
      ANCHOR_CORNERS.forEach((_, index) => all.push({ kind: 'anchor', index }));
    }
    if (spec.qr !== false) all.push({ kind: 'qr', index: 0 });
    setSelection(all);
  }, [blocks, elements, spec.anchors, spec.qr]);

  const deleteSelection = useCallback(() => {
    if (!selection.length) return;
    const blockIdx = new Set(selection.filter((s) => s.kind === 'block').map((s) => s.index));
    const elementIdx = new Set(selection.filter((s) => s.kind === 'element').map((s) => s.index));
    // Âncoras e QR não são excluídos — desligue-os no painel de elementos.
    if (!blockIdx.size && !elementIdx.size) return;
    // O cartão precisa de pelo menos um bloco visível para ter questões.
    const visibleLeft = blocks.filter((b, i) => !blockIdx.has(i) && !b.hidden).length;
    if (visibleLeft === 0 && blocks.some((b) => !b.hidden)) {
      notify('Mantenha pelo menos um bloco visível para o cartão ter questões.', 'info');
      return;
    }
    pushHistory();
    setSpec((prev) => ({
      ...prev,
      blocks: (prev.blocks ?? []).filter((_, i) => !blockIdx.has(i)),
      elements: (prev.elements ?? []).filter((_, i) => !elementIdx.has(i)),
    }));
    setSelection([]);
  }, [selection, blocks, notify, pushHistory]);

  const duplicateSelection = useCallback(() => {
    if (!selection.length) return;
    const OFFSET = 4;
    const frozen = freezeBlockPositions(blocks);
    const blockAdds: CardBlockSpec[] = [];
    const elementAdds: CardElementSpec[] = [];
    const blockStart = frozen.length;
    const elementStart = elements.length;

    for (const item of selection) {
      if (item.kind === 'block') {
        const b = frozen[item.index];
        const g = blockBounds(item.index);
        if (!b || !g) continue;
        blockAdds.push({
          ...b,
          title: b.title ? `${b.title} (cópia)` : b.title,
          x_mm: round1(clamp(g.x + OFFSET, 0, Math.max(0, pageW - g.w))),
          y_mm: round1(clamp(g.y + OFFSET, 0, Math.max(0, pageH - g.h))),
          w_mm: round1(g.w),
          h_mm: round1(g.h),
        });
      } else if (item.kind === 'element') {
        const el = elements[item.index];
        if (!el) continue;
        elementAdds.push({
          ...el,
          x: round4(clamp(el.x + OFFSET / pageW, 0, Math.max(0, 1 - el.w))),
          y: round4(clamp(el.y + OFFSET / pageH, 0, Math.max(0, 1 - el.h))),
        });
      }
    }

    if (!blockAdds.length && !elementAdds.length) return;
    pushHistory();
    setSpec((prev) => ({
      ...prev,
      // Congela também os originais: o backend só respeita posições livres
      // quando TODOS os blocos têm x/y (senão volta ao fluxo automático).
      blocks: [...frozen, ...blockAdds],
      elements: [...(prev.elements ?? []), ...elementAdds],
    }));
    setSelection([
      ...blockAdds.map((_, k) => ({ kind: 'block' as const, index: blockStart + k })),
      ...elementAdds.map((_, k) => ({ kind: 'element' as const, index: elementStart + k })),
    ]);
  }, [selection, blocks, elements, freezeBlockPositions, blockBounds, pageW, pageH, pushHistory]);

  /** Move a seleção com as setas: 0,5 mm (5 mm com Shift), como no protótipo. */
  const nudgeSelection = useCallback((
    key: 'arrowleft' | 'arrowright' | 'arrowup' | 'arrowdown',
    stepMm: number,
  ) => {
    if (!selection.length) return;
    const dx = key === 'arrowleft' ? -stepMm : key === 'arrowright' ? stepMm : 0;
    const dy = key === 'arrowup' ? -stepMm : key === 'arrowdown' ? stepMm : 0;
    const blockIdx = new Set(selection.filter((s) => s.kind === 'block').map((s) => s.index));
    const elementIdx = new Set(selection.filter((s) => s.kind === 'element').map((s) => s.index));
    const anchorIdx = new Set(selection.filter((s) => s.kind === 'anchor').map((s) => s.index));
    const moveQr = selection.some((s) => s.kind === 'qr');
    const anchorStarts = new Map<number, RectMm>();
    for (const i of anchorIdx) {
      const corner = ANCHOR_CORNERS[i];
      const r = corner ? anchorRectMm(corner) : null;
      if (r) anchorStarts.set(i, r);
    }
    const qrStart = moveQr ? qrRectMm() : null;

    pushHistory(`nudge-${key}`);
    setSpec((prev) => {
      const moveBlocks = blockIdx.size > 0;
      const frozen = moveBlocks ? freezeBlockPositions(prev.blocks ?? []) : (prev.blocks ?? []);
      let anchorLayout = prev.anchor_layout;
      if (anchorStarts.size) {
        anchorLayout = { ...(prev.anchor_layout ?? {}) };
        for (const [i, r] of anchorStarts) {
          const corner = ANCHOR_CORNERS[i];
          if (!corner) continue;
          anchorLayout[corner] = {
            x_mm: round1(clamp(r.x + dx, 0, Math.max(0, pageW - r.w))),
            y_mm: round1(clamp(r.y + dy, 0, Math.max(0, pageH - r.h))),
            size_mm: round1(r.w),
          };
        }
      }
      const qrLayout = qrStart
        ? {
            x_mm: round1(clamp(qrStart.x + dx, 0, Math.max(0, pageW - qrStart.w))),
            y_mm: round1(clamp(qrStart.y + dy, 0, Math.max(0, pageH - qrStart.h))),
            w_mm: round1(qrStart.w),
            h_mm: round1(qrStart.h),
          }
        : prev.qr_layout;
      return {
        ...prev,
        anchor_layout: anchorLayout,
        qr_layout: qrLayout,
        blocks: moveBlocks
          ? frozen.map((b, i) => {
              if (!blockIdx.has(i) || b.x_mm == null || b.y_mm == null) return b;
              return {
                ...b,
                x_mm: round1(clamp(b.x_mm + dx, 0, Math.max(0, pageW - (b.w_mm ?? 0)))),
                y_mm: round1(clamp(b.y_mm + dy, 0, Math.max(0, pageH - (b.h_mm ?? 0)))),
              };
            })
          : prev.blocks,
        elements: (prev.elements ?? []).map((el, i) => (
          elementIdx.has(i)
            ? {
                ...el,
                x: round4(clamp(el.x + dx / pageW, 0, Math.max(0, 1 - el.w))),
                y: round4(clamp(el.y + dy / pageH, 0, Math.max(0, 1 - el.h))),
              }
            : el
        )),
      };
    });
  }, [selection, pushHistory, freezeBlockPositions, pageW, pageH, anchorRectMm, qrRectMm]);

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
    setSelection((prev) => prev.map((s) => {
      if (s.kind !== kind) return s;
      if (s.index === index) return { ...s, index: target };
      if (s.index === target) return { ...s, index };
      return s;
    }));
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

  // ─── Geometria e arraste no canvas ─────────────────────────────────────────

  const elementRectMm = useCallback((el: CardElementSpec): RectMm => ({
    x: el.x * pageW,
    y: el.y * pageH,
    w: el.w * pageW,
    h: el.h * pageH,
  }), [pageW, pageH]);

  const visibleRectsMm = (exclude?: Set<string>): RectMm[] => {
    const rects: RectMm[] = [];
    blocks.forEach((b, i) => {
      if (b.hidden || exclude?.has(`block:${i}`)) return;
      const g = blockBounds(i);
      if (g) rects.push(g);
    });
    elements.forEach((el, i) => {
      if (el.hidden || exclude?.has(`element:${i}`)) return;
      rects.push(elementRectMm(el));
    });
    if (spec.anchors !== false) {
      ANCHOR_CORNERS.forEach((corner, i) => {
        if (exclude?.has(`anchor:${i}`)) return;
        const g = anchorRectMm(corner);
        if (g) rects.push(g);
      });
    }
    if (spec.qr !== false && !exclude?.has('qr:0')) {
      const g = qrRectMm();
      if (g) rects.push(g);
    }
    return rects;
  };

  /** Itens selecionados que podem ser arrastados agora (bloqueados ficam fora). */
  const dragItemsFor = (list: Selection[]): DragItem[] => {
    const items: DragItem[] = [];
    for (const item of list) {
      if (item.kind === 'block') {
        const b = blocks[item.index];
        const g = blockBounds(item.index);
        if (!b || b.hidden || b.locked || !g) continue;
        items.push({ kind: 'block', index: item.index, rect: { ...g } });
      } else if (item.kind === 'element') {
        const el = elements[item.index];
        if (!el || el.hidden || el.locked) continue;
        items.push({ kind: 'element', index: item.index, rect: elementRectMm(el) });
      } else if (item.kind === 'anchor') {
        const corner = ANCHOR_CORNERS[item.index];
        const g = corner ? anchorRectMm(corner) : null;
        if (g) items.push({ kind: 'anchor', index: item.index, rect: { ...g } });
      } else if (item.kind === 'qr') {
        const g = qrRectMm();
        if (g) items.push({ kind: 'qr', index: 0, rect: { ...g } });
      }
    }
    return items;
  };

  const applyMove = (items: DragItem[], dx: number, dy: number) => {
    const blockRects = new Map<number, RectMm>();
    const elementRects = new Map<number, RectMm>();
    const anchorRects = new Map<number, RectMm>();
    let qrRect: RectMm | null = null;
    for (const item of items) {
      const next = { ...item.rect, x: item.rect.x + dx, y: item.rect.y + dy };
      if (item.kind === 'block') blockRects.set(item.index, next);
      else if (item.kind === 'element') elementRects.set(item.index, next);
      else if (item.kind === 'anchor') anchorRects.set(item.index, next);
      else qrRect = next;
    }
    setSpec((prev) => {
      const anchorLayout = anchorRects.size
        ? { ...(prev.anchor_layout ?? {}) }
        : prev.anchor_layout;
      if (anchorLayout) {
        for (const [i, r] of anchorRects) {
          const corner = ANCHOR_CORNERS[i];
          if (corner) {
            anchorLayout[corner] = {
              x_mm: round1(r.x),
              y_mm: round1(r.y),
              size_mm: round1(r.w),
            };
          }
        }
      }
      return {
        ...prev,
        blocks: blockRects.size
          ? (prev.blocks ?? []).map((b, i) => {
              const n = blockRects.get(i);
              return n ? { ...b, x_mm: round1(n.x), y_mm: round1(n.y) } : b;
            })
          : prev.blocks,
        elements: elementRects.size
          ? (prev.elements ?? []).map((el, i) => {
              const n = elementRects.get(i);
              return n
                ? { ...el, x: round4(n.x / pageW), y: round4(n.y / pageH) }
                : el;
            })
          : prev.elements,
        anchor_layout: anchorLayout,
        qr_layout: qrRect
          ? {
              x_mm: round1(qrRect.x),
              y_mm: round1(qrRect.y),
              w_mm: round1(qrRect.w),
              h_mm: round1(qrRect.h),
            }
          : prev.qr_layout,
      };
    });
  };

  const onPagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;

    if (d.kind === 'pan') {
      const sc = canvasScrollRef.current;
      if (!sc) return;
      sc.scrollLeft = d.scrollLeft - (e.clientX - d.startX);
      sc.scrollTop = d.scrollTop - (e.clientY - d.startY);
      return;
    }

    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;

    const dxMm = ((e.clientX - d.startX) / rect.width) * pageW;
    const dyMm = ((e.clientY - d.startY) / rect.height) * pageH;

    if (d.kind === 'marquee') {
      const x1 = clamp(d.start.x, 0, pageW);
      const y1 = clamp(d.start.y, 0, pageH);
      const x2 = clamp(d.start.x + dxMm, 0, pageW);
      const y2 = clamp(d.start.y + dyMm, 0, pageH);
      const box: RectMm = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      };
      d.moved = box.w > 0.5 || box.h > 0.5;
      d.box = box;
      setMarquee(box);
      return;
    }

    if (d.kind === 'move') {
      let dx = dxMm;
      let dy = dyMm;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const bounded = clampRectMm(
        { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy },
        pageW,
        pageH,
      );
      dx = bounded.x - d.orig.x;
      dy = bounded.y - d.orig.y;

      if (grid) {
        // Com a grade visível o arraste trava nos quadradinhos de 5 mm. As
        // guias de alinhamento ficam de fora para não contradizer a grade.
        dx = snapToGridWithin(d.orig.x + dx, pageW - d.orig.w) - d.orig.x;
        dy = snapToGridWithin(d.orig.y + dy, pageH - d.orig.h) - d.orig.y;
        setGuides({ x: [], y: [] });
      } else if (snap) {
        const exclude = new Set(d.items.map((it) => `${it.kind}:${it.index}`));
        const s = findSnapMm(
          { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy },
          visibleRectsMm(exclude),
          pageW,
          pageH,
        );
        dx += s.dx;
        dy += s.dy;
        setGuides({ x: s.guidesX, y: s.guidesY });
      } else {
        setGuides({ x: [], y: [] });
      }

      // O ímã nunca pode empurrar o grupo para fora da folha.
      const finalBox = clampRectMm(
        { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy },
        pageW,
        pageH,
      );
      dx = finalBox.x - d.orig.x;
      dy = finalBox.y - d.orig.y;

      if (!d.moved) {
        d.moved = true;
        pushHistory(`drag:${d.items.map((it) => `${it.kind}${it.index}`).join(',')}`);
        // O primeiro arraste congela o layout automático em mm. Antes disso o
        // gerador reorganiza os blocos sozinho a cada mudança.
        setSpec((prev) => ({ ...prev, blocks: freezeBlockPositions(prev.blocks ?? []) }));
      }
      applyMove(d.items, dx, dy);
      return;
    }

    // Redimensionamento (blocos 18×14 mm; elementos 2×2 mm; âncoras/QR
    // quadrados com mínimo próprio).
    const target = d.target;
    const targetKind = target.kind;
    const targetIndex = target.index;
    const isBlock = targetKind === 'block';
    const isAnchor = targetKind === 'anchor';
    const isQr = targetKind === 'qr';
    const minW = isBlock ? 18 : isAnchor ? 6 : isQr ? 10 : 2;
    const minH = isBlock ? 14 : isAnchor ? 6 : isQr ? 10 : 2;
    let next = resizeRectMm(d.orig, d.dir, dxMm, dyMm, minW, minH, pageW, pageH);

    // Trava de proporção (Shift) e travamento na grade são mutuamente
    // exclusivos: seguir a proporção exata deixa o retângulo fora dos
    // quadradinhos, então a proporção tem prioridade.
    const ratioLock = e.shiftKey && targetKind === 'element' && d.dir.length === 2 && d.orig.h > 0;
    if (ratioLock) {
      const ratio = d.orig.w / d.orig.h;
      const h = next.w / ratio;
      next = d.dir.includes('n')
        ? { ...next, y: Math.max(0, d.orig.y + d.orig.h - h), h }
        : { ...next, h };
      next = clampRectMm(next, pageW, pageH);
    } else if (grid) {
      // Com a grade visível as alças encaixam nos quadradinhos de 5 mm; só a
      // aresta que a alça mexe é movida, a oposta continua onde estava.
      next = snapResizeMm(next, d.dir, minW, minH, pageW, pageH);
    }

    if (isAnchor || isQr) {
      // Marcador ArUco e QR precisam continuar quadrados.
      next = squareResizeMm(next, d.orig, d.dir, Math.max(minW, minH), pageW, pageH);
    }

    if (!d.moved) {
      d.moved = true;
      pushHistory(`resize:${targetKind}${targetIndex}`);
      setSpec((prev) => ({ ...prev, blocks: freezeBlockPositions(prev.blocks ?? []) }));
    }
    setSpec((prev) => {
      if (isBlock) {
        return {
          ...prev,
          blocks: (prev.blocks ?? []).map((b, i) => (
            i === targetIndex
              ? {
                  ...b,
                  x_mm: round1(next.x),
                  y_mm: round1(next.y),
                  w_mm: round1(next.w),
                  h_mm: round1(next.h),
                }
              : b
          )),
        };
      }
      if (isAnchor) {
        const corner = ANCHOR_CORNERS[targetIndex];
        if (!corner) return prev;
        return {
          ...prev,
          anchor_layout: {
            ...(prev.anchor_layout ?? {}),
            [corner]: {
              x_mm: round1(next.x),
              y_mm: round1(next.y),
              size_mm: round1(next.w),
            },
          },
        };
      }
      if (isQr) {
        return {
          ...prev,
          qr_layout: {
            x_mm: round1(next.x),
            y_mm: round1(next.y),
            w_mm: round1(next.w),
            h_mm: round1(next.h),
          },
        };
      }
      return {
        ...prev,
        elements: (prev.elements ?? []).map((el, i) => (
          i === targetIndex
            ? {
                ...el,
                x: round4(next.x / pageW),
                y: round4(next.y / pageH),
                w: round4(next.w / pageW),
                h: round4(next.h / pageH),
              }
            : el
        )),
      };
    });
  };

  const onPagePointerUp = () => {
    const d = dragRef.current;

    if (d?.kind === 'marquee' && d.moved && d.box) {
      const picked: Selection[] = [];
      blocks.forEach((b, i) => {
        if (b.hidden) return;
        const g = blockBounds(i);
        if (g && rectsIntersect(d.box!, g)) picked.push({ kind: 'block', index: i });
      });
      elements.forEach((el, i) => {
        if (el.hidden) return;
        if (rectsIntersect(d.box!, elementRectMm(el))) picked.push({ kind: 'element', index: i });
      });
      if (spec.anchors !== false) {
        ANCHOR_CORNERS.forEach((corner, i) => {
          const g = anchorRectMm(corner);
          if (g && rectsIntersect(d.box!, g)) picked.push({ kind: 'anchor', index: i });
        });
      }
      if (spec.qr !== false) {
        const g = qrRectMm();
        if (g && rectsIntersect(d.box!, g)) picked.push({ kind: 'qr', index: 0 });
      }
      setSelection((prev) => (d.additive ? mergeSelection(prev, picked) : picked));
      const last = picked[picked.length - 1];
      if (last) setPropsTab(last.kind === 'block' ? 'questoes' : 'elementos');
    }

    setMarquee(null);
    setGuides({ x: [], y: [] });
    dragRef.current = null;
  };

  /** Clique na folha vazia: marquee (ferramenta selecionar) ou pan (mover). */
  const onSheetPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();

    if (tool === 'move') {
      const sc = canvasScrollRef.current;
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: sc?.scrollLeft ?? 0,
        scrollTop: sc?.scrollTop ?? 0,
      };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captura indisponível */ }
      return;
    }

    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    if (!e.shiftKey) clearSelection();

    const x = ((e.clientX - rect.left) / rect.width) * pageW;
    const y = ((e.clientY - rect.top) / rect.height) * pageH;
    dragRef.current = {
      kind: 'marquee',
      startX: e.clientX,
      startY: e.clientY,
      start: { x, y, w: 0, h: 0 },
      additive: e.shiftKey,
    };
    setMarquee({ x, y, w: 0, h: 0 });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captura indisponível */ }
  };

  const startResizeOf = (
    e: ReactPointerEvent<HTMLElement>,
    target: Selection,
    dir: ResizeDir = 'se',
  ) => {
    let orig: RectMm | null;
    if (target.kind === 'block') {
      orig = blockBounds(target.index);
    } else if (target.kind === 'element') {
      orig = elements[target.index] ? elementRectMm(elements[target.index]) : null;
    } else if (target.kind === 'anchor') {
      const corner = ANCHOR_CORNERS[target.index];
      orig = corner ? anchorRectMm(corner) : null;
    } else {
      orig = qrRectMm();
    }
    if (!orig) return;
    dragRef.current = {
      kind: 'resize',
      target,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      orig,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captura indisponível */ }
  };

  const startMove = (e: ReactPointerEvent<HTMLDivElement>, item: Selection) => {
    e.preventDefault();
    e.stopPropagation();
    const wasSelected = isSelected(item.kind, item.index);
    const next = resolveSelection(item, e.shiftKey);
    setSelection(next);
    setPropsTab(item.kind === 'block' ? 'questoes' : 'elementos');

    // Shift + clique num item já selecionado apenas o remove do grupo; não
    // começa um arraste com o restante da seleção.
    if (e.shiftKey && wasSelected) return;

    const clicked = item.kind === 'block'
      ? blocks[item.index]
      : item.kind === 'element'
        ? elements[item.index]
        : { hidden: item.kind === 'anchor' ? spec.anchors === false : spec.qr === false, locked: false };
    if (!clicked || clicked.hidden) return;
    if (clicked.locked) {
      notify('Elemento bloqueado. Desbloqueie no painel de camadas para mover.', 'info');
      return;
    }

    if (tool === 'resize') {
      startResizeOf(e, item, 'se');
      return;
    }

    const items = dragItemsFor(next);
    if (!items.length) return;
    dragRef.current = {
      kind: 'move',
      startX: e.clientX,
      startY: e.clientY,
      items,
      orig: bboxOf(items.map((it) => it.rect)),
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captura indisponível */ }
  };

  const startBlockDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    startMove(e, { kind: 'block', index });
  };

  const startBlockResize = (
    e: ReactPointerEvent<HTMLButtonElement>, index: number, dir: ResizeDir,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (blocks[index]?.locked) return;
    setSelection([{ kind: 'block', index }]);
    startResizeOf(e, { kind: 'block', index }, dir);
  };

  const startElementDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    startMove(e, { kind: 'element', index });
  };

  const startElementResize = (
    e: ReactPointerEvent<HTMLButtonElement>, index: number, dir: ResizeDir,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (elements[index]?.locked) return;
    setSelection([{ kind: 'element', index }]);
    startResizeOf(e, { kind: 'element', index }, dir);
  };

  const startAnchorDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    startMove(e, { kind: 'anchor', index });
  };

  const startAnchorResize = (
    e: ReactPointerEvent<HTMLButtonElement>, index: number, dir: ResizeDir,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelection([{ kind: 'anchor', index }]);
    startResizeOf(e, { kind: 'anchor', index }, dir);
  };

  const startQrDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    startMove(e, { kind: 'qr', index: 0 });
  };

  const startQrResize = (e: ReactPointerEvent<HTMLButtonElement>, dir: ResizeDir) => {
    e.preventDefault();
    e.stopPropagation();
    setSelection([{ kind: 'qr', index: 0 }]);
    startResizeOf(e, { kind: 'qr', index: 0 }, dir);
  };

  const fitToScreen = useCallback(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    setZoom(fitZoom(el.clientWidth, el.clientHeight, pageW, pageH));
    // "Ajustar à tela" é uma ação explícita: libera o re-ajuste automático.
    zoomManualRef.current = false;
  }, [pageH, pageW]);

  const zoomBy = useCallback((dir: 1 | -1) => {
    zoomManualRef.current = true;
    setZoom((z) => zoomStep(z, dir));
  }, []);

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
        setZoom(fitZoom(el.clientWidth, el.clientHeight, pageW, pageH));
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [step, pageH, pageW]);

  // Ctrl + roda do mouse anda pelos níveis discretos de zoom. O wheel é
  // não-passivo para poder cancelar o zoom do navegador.
  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomManualRef.current = true;
      setZoom((z) => zoomStep(z, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [step]);

  // Atalhos do editor (só na etapa 2 e fora de campos de texto).
  useEffect(() => {
    if (step !== 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey) return;
      const meta = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (meta && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (meta && k === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && k === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (meta && k === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (meta && k === '0') {
        e.preventDefault();
        fitToScreen();
        return;
      }
      if (meta) return;

      if (k === 'escape') {
        if (mobilePanel) {
          setMobilePanel(null);
          return;
        }
        clearSelection();
        return;
      }
      if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (k === 'v') { setTool('select'); return; }
      if (k === 'm') { setTool('move'); return; }
      if (k === 'r') { setTool('resize'); return; }
      if (k === '+' || k === '=') { zoomBy(1); return; }
      if (k === '-') { zoomBy(-1); return; }
      if (k.startsWith('arrow') && selection.length) {
        e.preventDefault();
        nudgeSelection(k as 'arrowleft' | 'arrowright' | 'arrowup' | 'arrowdown', e.shiftKey ? 5 : 0.5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    step, undo, redo, selectAll, duplicateSelection, deleteSelection, clearSelection,
    nudgeSelection, fitToScreen, zoomBy, selection, mobilePanel,
  ]);

  // ─── Rótulos de seleção ────────────────────────────────────────────────────

  const selectedLabel = selectedBlockIndex != null
    ? blockName(blocks[selectedBlockIndex], selectedBlockIndex)
    : selectedElementIndex != null
      ? `${elements[selectedElementIndex]?.kind === 'text' ? 'Texto' : 'Linha'} ${selectedElementIndex + 1}`
      : selectedAnchorIndex != null
        ? ANCHOR_LABELS[ANCHOR_CORNERS[selectedAnchorIndex]]
        : selectedQr
          ? 'QR Code'
          : 'Documento';

  const selectedRectMm = primary
    ? primary.kind === 'block'
      ? blockBounds(primary.index)
      : primary.kind === 'element'
        ? (elements[primary.index] ? elementRectMm(elements[primary.index]) : null)
        : primary.kind === 'anchor'
          ? (ANCHOR_CORNERS[primary.index] ? anchorRectMm(ANCHOR_CORNERS[primary.index]) : null)
          : qrRectMm()
    : null;

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

        <Section title="Seleção" hint="Vale para o que está selecionado na folha ou nas camadas.">
          <div className="grid grid-cols-2 gap-1.5">
            <ToolButton
              icon={<Copy size={16} aria-hidden />}
              label="Duplicar"
              onClick={duplicateSelection}
              disabled={!selection.length}
              title="Duplicar seleção (Ctrl+D)"
            />
            <ToolButton
              icon={<Trash2 size={16} aria-hidden />}
              label="Excluir"
              onClick={deleteSelection}
              disabled={!selection.length}
              title="Excluir seleção (Delete)"
            />
          </div>
        </Section>

        <Section title="Camadas" hint="Do topo para a base. Shift seleciona vários.">
          <div className="space-y-0.5">
            {blocks.length === 0 && elements.length === 0 && (
              <p className="rounded-md border border-dashed border-line p-2 text-center text-[10.5px] text-gray-400 dark:border-gray-700">
                Nenhum elemento ainda.
              </p>
            )}
            {[...blocks.keys()].reverse().map((i) => {
              const b = blocks[i];
              const rowSelected = isSelected('block', i);
              return (
                <div
                  key={`block-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => selectBlock(i, e.shiftKey)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectBlock(i); }}
                  className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10.5px] ${
                    rowSelected
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
              const rowSelected = isSelected('element', i);
              return (
                <div
                  key={`element-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => selectElement(i, e.shiftKey)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectElement(i); }}
                  className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10.5px] ${
                    rowSelected
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

            <Section title="Códigos e âncoras" hint="Arraste as caixas na folha para mover; puxe as alças para redimensionar. A leitura usa as âncoras para alinhar a foto.">
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
                  <p className="text-[11px] text-gray-400">Quatro marcadores; o ideal é um por canto.</p>
                </div>
                <input type="checkbox" checked={spec.anchors !== false}
                       onChange={(e) => mutate({ anchors: e.target.checked }, 'anchors')} />
              </div>
              {spec.anchors !== false && (
                <Field label="Tamanho padrão da âncora (mm)" htmlFor="gen-anchor-mm">
                  <Input id="gen-anchor-mm" type="number" min={5} max={25} step={0.5}
                         className={COMPACT} value={spec.anchor_mm ?? ''}
                         onChange={(e) => mutate({ anchor_mm: numOrUndefined(e.target.value) }, 'anchor-mm')} />
                </Field>
              )}

              {(spec.anchor_layout || spec.qr_layout) && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <span>Posições personalizadas ativas.</span>
                  <Button size="sm" variant="secondary" icon={<RotateCcw size={13} aria-hidden />}
                          onClick={resetCodePositions}>
                    Padrão
                  </Button>
                </div>
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

            <CardFontsPanel spec={spec} mutate={mutate} />

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
                elementos depois. Nada é gravado até clicar em <strong>Gerar e ativar</strong>.
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
                  Gerar e ativar
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
            Gerar e ativar
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
            <ToolbarToggle title="Selecionar e arrastar (V)" active={tool === 'select'} onClick={() => setTool('select')} icon={<MousePointer2 size={15} aria-hidden />} />
            <ToolbarToggle title="Mover a folha (M)" active={tool === 'move'} onClick={() => setTool('move')} icon={<Move size={15} aria-hidden />} />
            <ToolbarToggle title="Redimensionar (R)" active={tool === 'resize'} onClick={() => setTool('resize')} icon={<Scaling size={15} aria-hidden />} />
            <span className="mx-1 h-5 w-px bg-line dark:bg-gray-700" aria-hidden />
            <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={() => zoomBy(-1)} aria-label="Diminuir zoom" title="Diminuir zoom (ou Ctrl + roda do mouse)">
              <ZoomOut size={15} aria-hidden />
            </button>
            <span className="w-10 text-center text-[11px] font-semibold text-gray-500">{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={() => zoomBy(1)} aria-label="Aumentar zoom" title="Aumentar zoom (ou Ctrl + roda do mouse)">
              <ZoomIn size={15} aria-hidden />
            </button>
            <button type="button" className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={fitToScreen} aria-label="Ajustar à tela" title="Ajustar à tela (Ctrl+0)">
              <Maximize2 size={15} aria-hidden />
            </button>
            <span className="mx-1 hidden h-5 w-px bg-line dark:bg-gray-700 sm:block" aria-hidden />
            <ToolbarToggle title="Réguas" active={rulers} onClick={() => setRulers((v) => !v)} icon={<Ruler size={15} aria-hidden />} />
            <ToolbarToggle title="Grade 5 mm (o arraste encaixa nos quadradinhos)" active={grid} onClick={() => setGrid((v) => !v)} icon={<Grid3x3 size={15} aria-hidden />} />
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
                    {rulerTicks(pageW, 5, 10, zoom < 0.5 ? 20 : 10).map(({ mm, major, label }) => (
                      <span key={mm}>
                        <span className="absolute top-0 w-px bg-[#B7C4D6]" style={{ left: mm * pxPerMm, height: major ? 8 : 4 }} />
                        {label && mm < pageW && (
                          <span className="absolute top-[10px] -translate-x-1/2 text-[7.5px] leading-none text-[#7C8DA6]" style={{ left: mm * pxPerMm }}>
                            {mm}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {rulers && (
                  <div className="relative overflow-hidden border border-line bg-[#FBFCFE] dark:border-gray-700 dark:bg-gray-900" style={{ width: 21, height: displayH }} aria-hidden>
                    {rulerTicks(pageH, 5, 10, zoom < 0.5 ? 20 : 10).map(({ mm, major, label }) => (
                      <span key={mm}>
                        <span className="absolute left-0 h-px bg-[#B7C4D6]" style={{ top: mm * pxPerMm, width: major ? 8 : 4 }} />
                        {label && mm < pageH && (
                          <span
                            className="absolute left-[10px] text-[7.5px] leading-none text-[#7C8DA6]"
                            style={{ top: mm * pxPerMm, transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'center' }}
                          >
                            {mm}
                          </span>
                        )}
                      </span>
                    ))}
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

                  <div
                    className={`absolute inset-0 z-0 ${tool === 'move' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                    onPointerDown={onSheetPointerDown}
                  />

                  {grid && (
                    <div
                      className="pointer-events-none absolute inset-0 z-[1]"
                      style={{
                        backgroundImage:
                          'linear-gradient(to right, rgba(23,105,255,.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(23,105,255,.14) 1px, transparent 1px)',
                        backgroundSize: `${GRID_MM * pxPerMm}px ${GRID_MM * pxPerMm}px`,
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

                  {/* Guias de alinhamento (mm → px) */}
                  {guides.x.map((gx) => (
                    <div
                      key={`guide-x-${gx}`}
                      className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-brand-500/80"
                      style={{ left: gx * pxPerMm }}
                      aria-hidden
                    />
                  ))}
                  {guides.y.map((gy) => (
                    <div
                      key={`guide-y-${gy}`}
                      className="pointer-events-none absolute left-0 right-0 z-30 h-px bg-brand-500/80"
                      style={{ top: gy * pxPerMm }}
                      aria-hidden
                    />
                  ))}

                  {/* Retângulo de seleção por arrasto */}
                  {marquee && (
                    <div
                      className="pointer-events-none absolute z-30 border border-brand-500 bg-brand-500/10"
                      style={{
                        left: marquee.x * pxPerMm,
                        top: marquee.y * pxPerMm,
                        width: marquee.w * pxPerMm,
                        height: marquee.h * pxPerMm,
                      }}
                      aria-hidden
                    />
                  )}

                  {/* Blocos de questões: caixas de seleção/arraste */}
                  {blocks.map((b, i) => {
                    if (b.hidden) return null;
                    const g = blockBounds(i);
                    if (!g) return null;
                    const blockSelected = isSelected('block', i);
                    const isPrimary = selectedBlockIndex === i && selection.length === 1;
                    return (
                      <div
                        key={`block-${i}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${blockName(b, i)}${b.locked ? ' (bloqueado)' : ''}`}
                        onPointerDown={(e) => startBlockDrag(e, i)}
                        onKeyDown={(e) => { if (e.key === 'Enter') selectBlock(i); }}
                        className={`absolute z-10 rounded-[3px] border-2 transition-colors ${
                          blockSelected
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
                        <span className={`pointer-events-none absolute -top-[18px] left-0 inline-flex max-w-full items-center gap-1 truncate rounded-t bg-brand-500 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white ${blockSelected ? '' : 'opacity-70'}`}>
                          {b.locked && <Lock size={9} aria-hidden />}
                          {blockName(b, i)}
                        </span>
                        {isPrimary && !b.locked && (
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
                    const elementSelected = isSelected('element', i);
                    const isPrimary = selectedElementIndex === i && selection.length === 1;
                    return (
                      <div
                        key={`element-${i}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${el.kind === 'text' ? 'Texto' : 'Linha'} ${i + 1}${el.locked ? ' (bloqueado)' : ''}`}
                        onPointerDown={(e) => startElementDrag(e, i)}
                        onKeyDown={(e) => { if (e.key === 'Enter') selectElement(i); }}
                        className={`absolute z-20 rounded-[2px] border border-dashed transition-colors ${
                          elementSelected
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
                        {elementSelected && (
                          <span className="pointer-events-none absolute -top-[16px] left-0 inline-flex items-center gap-1 rounded bg-brand-500 px-1 py-0.5 text-[8.5px] font-semibold leading-none text-white">
                            {el.locked && <Lock size={8} aria-hidden />}
                            {el.kind === 'text' ? 'Texto' : 'Linha'} {i + 1}
                          </span>
                        )}
                        {isPrimary && !el.locked && (
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
                                  onPointerDown={(e) => startElementResize(e, i, dir)}
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

                  {/* Âncoras ArUco: caixas de arraste/redimensionamento */}
                  {spec.anchors !== false && ANCHOR_CORNERS.map((corner, i) => {
                    const g = anchorRectMm(corner);
                    if (!g) return null;
                    const anchorSelected = isSelected('anchor', i);
                    const isPrimary = selectedAnchorIndex === i && selection.length === 1;
                    return (
                      <div
                        key={`anchor-${corner}`}
                        role="button"
                        tabIndex={0}
                        aria-label={ANCHOR_LABELS[corner]}
                        title="Arraste para reposicionar · puxe as alças para redimensionar"
                        onPointerDown={(e) => startAnchorDrag(e, i)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSelection([{ kind: 'anchor', index: i }]);
                            setPropsTab('elementos');
                          }
                        }}
                        className={`absolute z-20 rounded-[3px] border-2 transition-colors cursor-move ${
                          anchorSelected
                            ? 'border-warning-500 bg-warning-500/[0.08]'
                            : 'border-warning-500/40 bg-warning-500/[0.02] hover:border-warning-500/80'
                        }`}
                        style={{
                          left: `${(g.x / pageW) * 100}%`,
                          top: `${(g.y / pageH) * 100}%`,
                          width: `${(g.w / pageW) * 100}%`,
                          height: `${(g.h / pageH) * 100}%`,
                          touchAction: 'none',
                        }}
                      >
                        <span className={`pointer-events-none absolute -top-[18px] left-0 inline-flex max-w-full items-center gap-1 truncate rounded-t bg-warning-600 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white ${anchorSelected ? '' : 'opacity-70'}`}>
                          {corner} · âncora
                        </span>
                        {isPrimary && (
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
                                  aria-label={`Redimensionar âncora ${corner} (${dir})`}
                                  onPointerDown={(e) => startAnchorResize(e, i, dir)}
                                  className="absolute z-20 h-2.5 w-2.5 rounded-[2px] border border-warning-600 bg-white shadow-sm"
                                  style={style}
                                />
                              );
                            })}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* QR Code: caixa de arraste/redimensionamento */}
                  {spec.qr !== false && (() => {
                    const g = qrRectMm();
                    if (!g) return null;
                    const qrSelected = isSelected('qr', 0);
                    const isPrimary = selectedQr && selection.length === 1;
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="QR Code"
                        title="Arraste para reposicionar · puxe as alças para redimensionar"
                        onPointerDown={startQrDrag}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSelection([{ kind: 'qr', index: 0 }]);
                            setPropsTab('elementos');
                          }
                        }}
                        className={`absolute z-20 rounded-[3px] border-2 transition-colors cursor-move ${
                          qrSelected
                            ? 'border-success-500 bg-success-500/[0.08]'
                            : 'border-success-500/40 bg-success-500/[0.02] hover:border-success-500/80'
                        }`}
                        style={{
                          left: `${(g.x / pageW) * 100}%`,
                          top: `${(g.y / pageH) * 100}%`,
                          width: `${(g.w / pageW) * 100}%`,
                          height: `${(g.h / pageH) * 100}%`,
                          touchAction: 'none',
                        }}
                      >
                        <span className={`pointer-events-none absolute -top-[18px] left-0 inline-flex max-w-full items-center gap-1 truncate rounded-t bg-success-700 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white ${qrSelected ? '' : 'opacity-70'}`}>
                          QR Code
                        </span>
                        {isPrimary && (
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
                                  aria-label={`Redimensionar QR Code (${dir})`}
                                  onPointerDown={(e) => startQrResize(e, dir)}
                                  className="absolute z-20 h-2.5 w-2.5 rounded-[2px] border border-success-700 bg-white shadow-sm"
                                  style={style}
                                />
                              );
                            })}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line bg-white px-3 py-1.5 text-[10.5px] text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            <span className="min-w-0 truncate">
              {selection.length > 1
                ? `${selection.length} elementos selecionados · arraste para mover em conjunto`
                : selectedLabel === 'Documento'
                  ? 'Selecione um bloco ou elemento para editar as propriedades.'
                  : selectedRectMm
                    ? `${selectedLabel} · x ${round1(selectedRectMm.x)} · y ${round1(selectedRectMm.y)} · ${round1(selectedRectMm.w)} × ${round1(selectedRectMm.h)} mm`
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
