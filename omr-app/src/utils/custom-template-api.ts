// ─── Cliente do Gabarito Personalizado (/api/custom-templates) ───
//
// O usuário importa a imagem de um cartão-resposta próprio, desenha as
// regiões (âncoras, QR, campos informativos, blocos de questões) e o
// backend passa a ler esse modelo com o MESMO motor OMR de produção.
//
// Coordenadas são NORMALIZADAS (0..1) relativas à imagem importada.

import { apiBlob, apiForm, apiJson, apiJsonBody, saveBlob } from './api';

export type CornerName = 'TL' | 'TR' | 'BR' | 'BL';

export interface CustomAnchor {
  id: string;
  type: 'aruco' | 'quad';
  corner: CornerName | null;
  aruco_id: number | null;
  // Multi-página (mesma folha): cada página tem o próprio conjunto de âncoras.
  page?: number;
  x: number;
  y: number;
  size: number;
  tolerance: number;
  required: boolean;
}

export interface CustomQr {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  purpose: string;
  field: string;
}

export interface CustomInfoRegion {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CustomBlock {
  id: string;
  type: 'bubble_block';
  // Multi-página (mesma folha): bloco pertence a uma página do modelo.
  page?: number;
  first_x: number;
  first_y: number;
  option_step_x: number;
  question_step_y: number;
  column_step_x: number | null;
  columns: number;
  n_questions: number;
  labels: string[];
  radius: number;
  shape: 'circle' | 'square';
  start_question: number;
  distribution: 'column' | 'row';
  multi_answer: boolean;
  multi_marks_min: number | null;
  multi_marks_max: number | null;
  points: number;
  annulled: boolean;
  pick_darkest_mark: boolean;
  darkest_mark_threshold: number | null;
  fallback_on_empty: boolean;
  fallback_floor: number | null;
  mark_style: 'filled' | 'marks';
  overrides: Record<string, Record<string, { x?: number; y?: number }>>;
}

export interface CustomPrintField {
  region_id: string;
  source: string;
  font_size: number;
  align: 'left' | 'center' | 'right';
}

export interface CustomConfig {
  schema_version: number;
  page_w: number;
  page_h: number;
  // Multi-página (mesma folha): 1 = modelo de 1 página (default).
  n_pages?: number;
  // Imagem própria por página: { "1": "img_<12 hex>" }. Página 0 é a base.
  page_images?: Record<string, string>;
  anchors: CustomAnchor[];
  // Cantos da FOLHA dentro da imagem do modelo (normalizados, TL/TR/BR/BL).
  // Usados como DESTINO do alinhamento quando o modelo não tem as 4 âncoras
  // de canto (não são cantos da foto capturada).
  page_corners?: { x: number; y: number }[] | null;
  qr: CustomQr | null;
  info_regions: CustomInfoRegion[];
  questions: CustomBlock[];
  print_fields: CustomPrintField[];
  omr_params: {
    floor?: number | null;
    margin?: number | null;
    low_conf_threshold?: number | null;
    adaptive?: boolean;
  };
}

export interface CustomTemplateSummary {
  id: number;
  nome: string;
  version: number;
  status: 'rascunho' | 'validado' | 'ativo';
  avaliacao_id: number | null;
  image_w: number;
  image_h: number;
  config_summary: {
    n_anchors: number;
    has_qr: boolean;
    n_info_regions: number;
    n_blocks: number;
    n_questions: number;
    n_print_fields: number;
    n_pages: number;
    page_w: number;
    page_h: number;
  };
  created_at: string | null;
  updated_at: string | null;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  region_id: string | null;
}

export interface CustomTemplateDetail extends CustomTemplateSummary {
  config: CustomConfig;
  issues: ValidationIssue[] | null;
  image_url: string;
  preview_url: string;
  page_images: PageImage[];
}

export interface PageImage {
  page: number;
  image_w: number;
  image_h: number;
  image_url: string;
  own_image: boolean;
}

export interface ExpandedBubble {
  question: number;
  option: string;
  x: number;
  y: number;
  r: number;
  shape: 'circle' | 'square';
}

export interface CustomTestAlignment {
  ok: boolean;
  method: string;
  centers?: number;
  matched?: number;
  precision?: number | null;
  enrichment?: number | null;
  ink_frac?: number | null;
  tol_px?: number;
  anchor_method?: string | null;
  inferred_corners?: string[];
  detail?: string;
}

export interface CustomTestResult {
  success: boolean;
  error?: string;
  failure?: { reason?: string | null; detail?: string | null };
  alignment?: CustomTestAlignment | null;
  answers?: Record<string, string>;
  blank_questions?: number[];
  duplicate_questions?: number[];
  duplicate_marks?: Record<string, string[]>;
  multi_marks?: Record<string, string[]>;
  low_confidence?: number[];
  darkest_marks?: number[];
  fallback_marks?: number[];
  all_ratios?: Record<string, Record<string, number>>;
  qr_id?: string | null;
  floor_used?: number;
  floor_source?: string;
  timings_ms?: Record<string, number>;
  rectified_image?: string | null;
  overlay_image?: string | null;
  comparison?: {
    evaluated: number;
    correct: number;
    accuracy: number | null;
    mismatches: { question: string; expected: string; got: string | null }[];
    blank_expected: string[];
    false_positives: { question: string; expected: string; got: string | null }[];
  };
}

export const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  validado: 'Validado',
  ativo: 'Ativo',
};

export const PRINT_SOURCES = [
  { value: 'student_name', label: 'Nome do aluno' },
  { value: 'matricula', label: 'Matrícula' },
  { value: 'turma', label: 'Turma' },
  { value: 'exam_title', label: 'Título da prova' },
  { value: 'subject', label: 'Disciplina' },
  { value: 'date', label: 'Data' },
  { value: 'code', label: 'Código do cartão' },
];

// ─── CRUD ───

export function listCustomTemplates(): Promise<{ templates: CustomTemplateSummary[] }> {
  return apiJson('/api/custom-templates');
}

export function getCustomTemplate(id: number): Promise<CustomTemplateDetail> {
  return apiJson(`/api/custom-templates/${id}`);
}

export function createCustomTemplate(file: File, nome: string, avaliacaoExternalId?: string): Promise<CustomTemplateDetail> {
  const form = new FormData();
  form.append('file', file);
  form.append('nome', nome);
  if (avaliacaoExternalId) form.append('avaliacao_external_id', avaliacaoExternalId);
  return apiForm('/api/custom-templates', form);
}

export function updateCustomTemplate(
  id: number,
  patch: { nome?: string; config?: Partial<CustomConfig> },
): Promise<CustomTemplateDetail> {
  return apiJsonBody(`/api/custom-templates/${id}`, 'PUT', patch);
}

export function replaceCustomImage(id: number, file: File, page = 0): Promise<CustomTemplateDetail> {
  const form = new FormData();
  form.append('file', file);
  const q = page > 0 ? `?page=${page}` : '';
  return apiForm(`/api/custom-templates/${id}/image${q}`, form);
}

export function deleteCustomTemplate(id: number): Promise<{ deleted: number }> {
  return apiJsonBody(`/api/custom-templates/${id}`, 'DELETE', {});
}

// ─── Validação / ativação ───

export function validateCustomTemplate(id: number): Promise<{
  ok: boolean;
  issues: ValidationIssue[];
  status: string;
  summary: CustomTemplateSummary['config_summary'];
}> {
  return apiJsonBody(`/api/custom-templates/${id}/validate`, 'POST', {});
}

export function activateCustomTemplate(id: number): Promise<{ ok: boolean; status: string; version_id: number; version: number }> {
  return apiJsonBody(`/api/custom-templates/${id}/activate`, 'POST', {});
}

export function listCustomVersions(id: number): Promise<{ versions: { id: number; version: number; created_at: string; summary: unknown }[] }> {
  return apiJson(`/api/custom-templates/${id}/versions`);
}

// ─── Imagem / bolhas ───

export function customTemplateImage(id: number, page = 0): Promise<Blob> {
  const q = page > 0 ? `?page=${page}` : '';
  return apiBlob(`/api/custom-templates/${id}/image${q}`);
}

export async function customBubbles(id: number, page?: number): Promise<{ bubbles: ExpandedBubble[]; n_pages?: number }> {
  const q = page == null ? '' : `?page=${page}`;
  return apiJson(`/api/custom-templates/${id}/bubbles${q}`);
}

// ─── Auto-detecção de grade (sugestão para o editor) ───

/** Bloco sugerido pela detecção (campos de geometria; defaults no editor). */
export interface DetectedBlock {
  id: string;
  type: 'bubble_block';
  page?: number;
  first_x: number;
  first_y: number;
  option_step_x: number;
  question_step_y: number;
  columns: number;
  n_questions: number;
  labels: string[];
  radius: number;
  shape: 'circle' | 'square';
  start_question: number;
  distribution: 'column' | 'row';
}

export interface DetectGridResult {
  ok: boolean;
  blocks: DetectedBlock[];
  reason: string | null;
  candidates: number;
  rows: number;
  columns: number;
  radius_px: number;
}

export function detectCustomGrid(id: number, page = 0): Promise<DetectGridResult> {
  return apiJsonBody(`/api/custom-templates/${id}/detect-grid?page=${page}`, 'POST', {});
}

export interface PageCornersResult {
  ok: boolean;
  corners: { x: number; y: number }[] | null;
  count: number;
  /** true quando os cantos são estimados (não detectados) — ajuste manual. */
  inferred?: boolean;
  /** Aviso quando a config não corresponde à imagem atual (tamanho diferente). */
  warning?: string | null;
}

export function detectPageCorners(id: number, page = 0): Promise<PageCornersResult> {
  return apiJsonBody(`/api/custom-templates/${id}/detect-page-corners?page=${page}`, 'POST', {});
}

export interface DetectAnchorsResult {
  ok: boolean;
  anchors: CustomAnchor[];
  count: number;
}

export function detectCustomAnchors(id: number, page = 0): Promise<DetectAnchorsResult> {
  return apiJsonBody(`/api/custom-templates/${id}/detect-anchors?page=${page}`, 'POST', {});
}

// ─── Teste ───

export function testCustomTemplate(
  id: number,
  file: File,
  groundTruth?: Record<string, string>,
  adaptive = false,
): Promise<CustomTestResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('adaptive', String(adaptive));
  form.append('debug', 'true');
  if (groundTruth && Object.keys(groundTruth).length) {
    form.append('ground_truth', JSON.stringify(groundTruth));
  }
  return apiForm(`/api/custom-templates/${id}/test`, form);
}

// ─── Impressão ───

export interface PrintStudent {
  nome: string;
  matricula?: string;
  codigo?: string;
}

export async function printCustomTemplate(
  id: number,
  mode: 'blank' | 'students' | 'avaliacao',
  format: 'PDF' | 'PNG',
  students?: PrintStudent[],
): Promise<void> {
  const blob = await apiBlob(`/api/custom-templates/${id}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, format, students }),
  }, 180000);
  saveBlob(blob, `gabarito-personalizado-${id}.${format === 'PNG' ? 'png' : 'pdf'}`);
}

// ─── Prévia do lote (não gera arquivo nem grava gabaritos) ───

export interface PrintPreviewPage {
  title: string;
  code: string;
  image: string; // data URL (JPEG)
}

export interface PrintPreviewResult {
  ok: boolean;
  error: string | null;
  count: number;
  shown: number;
  mode: string;
  pages: PrintPreviewPage[];
}

export function printPreviewCustomTemplate(
  id: number,
  mode: 'blank' | 'students' | 'avaliacao',
  format: 'PDF' | 'PNG',
  students?: PrintStudent[],
  limit = 6,
): Promise<PrintPreviewResult> {
  return apiJsonBody(`/api/custom-templates/${id}/print-preview?limit=${limit}`, 'POST',
    { mode, format, students });
}

// ─── Utilidades do editor ───

export function emptyConfig(pageW: number, pageH: number): CustomConfig {
  return {
    schema_version: 1,
    page_w: pageW,
    page_h: pageH,
    n_pages: 1,
    anchors: [],
    qr: null,
    info_regions: [],
    questions: [],
    print_fields: [],
    omr_params: {},
  };
}

/** Remove a página `idx` do mapa de imagens e reindexa as seguintes. */
export function removePageImage(
  pageImages: Record<string, string> | undefined, idx: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, id] of Object.entries(pageImages ?? {})) {
    const p = Number(k);
    if (p === idx) continue;
    out[String(p > idx ? p - 1 : p)] = id;
  }
  return out;
}

/** Expande as bolhas de um bloco em coordenadas normalizadas (espelha o backend). */
export function expandBlock(block: CustomBlock): ExpandedBubble[] {
  const labels = block.labels?.length ? block.labels : ['A', 'B', 'C', 'D'];
  const nQ = Math.max(0, Math.floor(block.n_questions || 0));
  const columns = Math.max(1, Math.floor(block.columns || 1));
  const osx = block.option_step_x || 0;
  const qsy = block.question_step_y || 0;
  const csx = block.column_step_x || osx * labels.length;
  const start = Math.max(1, Math.floor(block.start_question || 1));
  const out: ExpandedBubble[] = [];
  if (!nQ || !labels.length) return out;
  const rows = Math.ceil(nQ / columns);
  for (let idx = 0; idx < nQ; idx++) {
    let row: number;
    let col: number;
    if (block.distribution === 'row') {
      row = Math.floor(idx / columns);
      col = idx % columns;
    } else {
      row = idx % rows;
      col = Math.floor(idx / rows);
    }
    const q = start + idx;
    labels.forEach((label, i) => {
      let x = block.first_x + col * csx + i * osx;
      let y = block.first_y + row * qsy;
      const ov = block.overrides?.[String(q)]?.[label];
      if (ov) {
        if (typeof ov.x === 'number') x = ov.x;
        if (typeof ov.y === 'number') y = ov.y;
      }
      out.push({ question: q, option: label, x, y, r: block.radius, shape: block.shape });
    });
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Desloca os ajustes individuais junto com o bloco. Os overrides são posições
 * absolutas (x/y normalizados), então mover o bloco precisa mover as bolhas
 * ajustadas na mesma direção.
 */
export function shiftOverrides(
  overrides: CustomBlock['overrides'],
  dx: number,
  dy: number,
): CustomBlock['overrides'] {
  if ((!dx && !dy) || !overrides) return overrides ?? {};
  const out: CustomBlock['overrides'] = {};
  for (const [q, opts] of Object.entries(overrides)) {
    const next: Record<string, { x?: number; y?: number }> = {};
    for (const [label, p] of Object.entries(opts)) {
      next[label] = {
        ...p,
        ...(typeof p.x === 'number' ? { x: clamp01(p.x + dx) } : {}),
        ...(typeof p.y === 'number' ? { y: clamp01(p.y + dy) } : {}),
      };
    }
    out[q] = next;
  }
  return out;
}

/** Move o início do bloco e leva os ajustes individuais junto. */
export function moveBlockTo(block: CustomBlock, x: number, y: number): CustomBlock {
  return {
    ...block,
    first_x: x,
    first_y: y,
    overrides: shiftOverrides(block.overrides, x - block.first_x, y - block.first_y),
  };
}

/** Fixa uma bolha numa posição absoluta (override por questão/alternativa). */
export function withBubbleOverride(
  block: CustomBlock, question: number, option: string, x: number, y: number,
): CustomBlock {
  const qKey = String(question);
  const prev = block.overrides?.[qKey] ?? {};
  return {
    ...block,
    overrides: {
      ...(block.overrides ?? {}),
      [qKey]: { ...prev, [option]: { x, y } },
    },
  };
}

/** Remove o ajuste de uma bolha, devolvendo-a à grade do bloco. */
export function withoutBubbleOverride(
  block: CustomBlock, question: number, option: string,
): CustomBlock {
  const qKey = String(question);
  const next = { ...(block.overrides ?? {}) };
  const opts = { ...(next[qKey] ?? {}) };
  delete opts[option];
  if (Object.keys(opts).length) next[qKey] = opts;
  else delete next[qKey];
  return { ...block, overrides: next };
}

export function configQuestionCount(cfg: CustomConfig): number {
  const nums = new Set<number>();
  cfg.questions.forEach((b) => expandBlock(b).forEach((x) => nums.add(x.question)));
  return nums.size;
}
