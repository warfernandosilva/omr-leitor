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
  anchors: CustomAnchor[];
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

export function replaceCustomImage(id: number, file: File): Promise<CustomTemplateDetail> {
  const form = new FormData();
  form.append('file', file);
  return apiForm(`/api/custom-templates/${id}/image`, form);
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

export function customTemplateImage(id: number): Promise<Blob> {
  return apiBlob(`/api/custom-templates/${id}/image`);
}

export async function customBubbles(id: number): Promise<{ bubbles: ExpandedBubble[] }> {
  return apiJson(`/api/custom-templates/${id}/bubbles`);
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

// ─── Utilidades do editor ───

export function emptyConfig(pageW: number, pageH: number): CustomConfig {
  return {
    schema_version: 1,
    page_w: pageW,
    page_h: pageH,
    anchors: [],
    qr: null,
    info_regions: [],
    questions: [],
    print_fields: [],
    omr_params: {},
  };
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

export function configQuestionCount(cfg: CustomConfig): number {
  const nums = new Set<number>();
  cfg.questions.forEach((b) => expandBlock(b).forEach((x) => nums.add(x.question)));
  return nums.size;
}
