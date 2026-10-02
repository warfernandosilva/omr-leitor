// ─── Cliente do Laboratório OMR (/api/lab) ───
//
// Espelha 1:1 o backend (routers/lab.py). O Lab é onde se avalia a leitura
// com gabarito, sem tocar em produção: as fotos passam pelo MESMO motor de
// omr/reader*.py, e aqui só persistimos e medimos.
//
// Tudo autenticado: o token vai em `Authorization: Bearer` (via utils/api.ts),
// inclusive nas imagens — por isso a retificada é baixada como Blob e não por
// <img src> (que não envia header).

import { apiBlob, apiForm, apiJson, apiJsonBody, saveBlob } from './api';

export type LabTemplate = 'padrao' | 'sae' | 'colar' | 'saev' | 'herby';

export const LAB_TEMPLATES: { value: LabTemplate; label: string; qps: number }[] = [
  { value: 'padrao', label: 'Padrão (ArUco)', qps: 22 },
  { value: 'sae', label: 'Avaliação Contínua (SAE)', qps: 26 },
  { value: 'saev', label: 'Gabarito SAEV (quadrado)', qps: 22 },
  { value: 'herby', label: 'Gabarito Herby', qps: 22 },
  { value: 'colar', label: 'Colar em Avaliação', qps: 26 },
];

/** Classificação do motor por questão (como vem de reader.classify_question). */
export type LabStatus = 'ok' | 'low' | 'duplicate' | 'blank';

export const LAB_STATUS_LABEL: Record<LabStatus, string> = {
  ok: 'marcada',
  low: 'AMBIGUA',
  duplicate: 'AMBIGUA',
  blank: 'BRANCO',
};

export function labStatusTone(status: string): 'success' | 'warning' | 'info' {
  if (status === 'ok') return 'success';
  if (status === 'blank') return 'info';
  return 'warning';
}

// ─── Sessões ───

export interface LabSessionSummary {
  id: number;
  nome: string;
  descricao: string | null;
  template: string;
  questions_per_subject: number;
  layout_mode: 'dual' | 'single';
  adaptive: boolean;
  n_images: number;
  n_erro: number;
}

export interface LabSessionDetail {
  id: number;
  nome: string;
  descricao: string | null;
  template: string;
  questions_per_subject: number;
  layout_mode: 'dual' | 'single';
  adaptive: boolean;
  ground_truth: Record<string, string> | null;
  images: LabImage[];
}

export interface LabSessionCreated {
  id: number;
  nome: string;
  template: string;
  questions_per_subject: number;
  layout_mode: string;
  adaptive: boolean;
  ground_truth: Record<string, string> | null;
}

/** Total de questões que a sessão deve ter (dual = 2 disciplinas). */
export function labTotalQuestions(s: Pick<LabSessionSummary, 'questions_per_subject' | 'layout_mode'>): number {
  return s.layout_mode === 'dual' ? s.questions_per_subject * 2 : s.questions_per_subject;
}

export async function labListSessions(): Promise<LabSessionSummary[]> {
  const j = await apiJson<{ sessions: LabSessionSummary[] }>('/api/lab/sessions');
  return j.sessions;
}

export async function labCreateSession(payload: {
  nome: string;
  descricao?: string | null;
  template: LabTemplate;
  questions_per_subject: number;
  layout_mode: 'dual' | 'single';
  adaptive: boolean;
}): Promise<LabSessionCreated> {
  return apiJsonBody<LabSessionCreated>('/api/lab/sessions', 'POST', payload);
}

export async function labGetSession(sid: number): Promise<LabSessionDetail> {
  return apiJson<LabSessionDetail>(`/api/lab/sessions/${sid}`);
}

export async function labPatchSession(
  sid: number,
  payload: { nome?: string; descricao?: string | null; ground_truth?: Record<string, string> },
): Promise<{ ok: boolean; id: number }> {
  return apiJsonBody(`/api/lab/sessions/${sid}`, 'PATCH', payload);
}

export async function labDeleteSession(sid: number): Promise<{ ok: boolean }> {
  return apiJsonBody(`/api/lab/sessions/${sid}`, 'DELETE', undefined);
}

export async function labSaveGroundTruth(sid: number, truth: Record<string, string>): Promise<{ ok: boolean; n_questoes: number }> {
  return apiJsonBody(`/api/lab/sessions/${sid}/ground-truth`, 'POST', { ground_truth: truth });
}

// ─── Imagens ───

export interface LabOptionScore {
  option: string;
  score: number;
  mean_intensity: number;
  dark_ratio: number;
  contrast: number;
  otsu_threshold: number;
}

export interface LabQuestionView {
  question: number;
  status: LabStatus;
  label: string;
  detected: string | null;
  truth: string | null;
  duplicate_marks: string[] | null;
  options?: LabOptionScore[];
}

export interface LabImage {
  id: number;
  filename: string;
  status: 'processed' | 'error';
  error: string | null;
  template_used: string;
  qr_id: string | null;
  total_questions: number | null;
  floor_used: number | null;
  floor_source: string | null;
  t_detect: number | null;
  t_warp: number | null;
  t_qr: number | null;
  t_score: number | null;
  answers: Record<string, string>;
  questions: LabQuestionView[];
  rectified_url: string | null;
}

export interface LabUploadResultItem {
  filename: string;
  status: 'processed' | 'error';
  error?: string;
  saved?: string | null;
  image_id: number;
  template_used?: string;
  qr_id?: string | null;
  total_questions?: number;
  floor_used?: number | null;
  floor_source?: string | null;
  answers?: Record<string, string>;
}

export async function labUploadImages(
  sid: number,
  files: File[],
  adaptive = false,
): Promise<{ n_arquivos: number; results: LabUploadResultItem[] }> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  form.append('adaptive', adaptive ? 'true' : 'false');
  return apiForm(`/api/lab/sessions/${sid}/images`, form, 300000);
}

export async function labGetImage(iid: number): Promise<LabImage> {
  return apiJson<LabImage>(`/api/lab/images/${iid}`);
}

/** Blob PNG da retificada (endpoint protegido — <img src> não manda o token). */
export async function labFetchRectified(iid: number): Promise<Blob> {
  return apiBlob(`/api/lab/images/${iid}/rectified`, {}, 60000);
}

// ─── Métricas / reclassificação / calibração ───

export interface LabMetrics {
  total_questoes: number;
  com_gabarito: number;
  acertos: number;
  erros: number;
  brancos: number;
  ambiguas: number;
  respondidas: number;
  taxa_acerto: number | null;
  taxa_erro: number | null;
  taxa_branco: number | null;
  taxa_ambigua: number | null;
  [k: string]: unknown;
}

export interface LabSessionMetrics extends LabMetrics {
  session_id: number;
  nome: string;
  template: string;
  n_images: number;
  n_erro_processamento: number;
}

export interface LabReclassifyQuestion {
  question: number;
  status: LabStatus;
  label: string;
  detected: string | null;
  truth: string | null;
  confidence: number;
  duplicate_marks: string[] | null;
}

export interface LabReclassifyResult {
  persist: boolean;
  metrics: LabMetrics;
  questions: LabReclassifyQuestion[];
}

export async function labSessionMetrics(sid: number): Promise<LabSessionMetrics> {
  return apiJson<LabSessionMetrics>(`/api/lab/sessions/${sid}/metrics`);
}

export async function labReclassify(sid: number, payload: {
  floor: number;
  margin: number;
  weights?: number[] | null;
  low_conf_threshold?: number | null;
  persist?: boolean;
}): Promise<LabReclassifyResult> {
  return apiJsonBody(`/api/lab/sessions/${sid}/reclassify`, 'POST', {
    persist: false,
    ...payload,
  });
}

export interface LabCandidate extends LabMetrics {
  floor: number;
  margin: number;
  weights: number[];
  low_conf_threshold?: number | null;
}

export interface LabCalibrationResult {
  run_id: number;
  n_itens: number;
  best: LabCandidate | null;
  results: LabCandidate[];
}

export async function labCalibrate(sid: number, payload: {
  floor_grid?: number[];
  margin_grid?: number[];
  weights_grid?: number[][];
  low_conf_threshold?: number | null;
  notes?: string | null;
}): Promise<LabCalibrationResult> {
  return apiJsonBody(`/api/lab/sessions/${sid}/calibration`, 'POST', payload);
}

// ─── Export ───

export interface LabExportSheets {
  session: { id: number; nome: string; template: string };
  sheets: Record<string, string[][]>;
}

export async function labExportJson(sid: number): Promise<LabExportSheets> {
  return apiJson<LabExportSheets>(`/api/lab/sessions/${sid}/export?format=json`);
}

export async function labExportCsv(sid: number, filename: string): Promise<void> {
  const blob = await apiBlob(`/api/lab/sessions/${sid}/export?format=csv`);
  saveBlob(blob, filename);
}

// ─── Configurações (versionamento + publicação) ───

export interface LabConfig {
  id: number;
  nome: string;
  template: string | null;
  params: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  ativa: boolean;
  notes: string | null;
  created_at: string | null;
  published_at: string | null;
}

export interface LabConfigList {
  /** Conteúdo de data/active_config.json (null = motor no default). */
  active_file: Record<string, unknown> | null;
  configs: LabConfig[];
}

export async function labListConfigs(): Promise<LabConfigList> {
  return apiJson<LabConfigList>('/api/lab/configs');
}

export async function labCreateConfig(payload: {
  nome: string;
  template?: string | null;
  params: Record<string, unknown>;
  metrics?: Record<string, unknown> | null;
  source_session_id?: number | null;
  source_run_id?: number | null;
  notes?: string | null;
}): Promise<{ id: number; nome: string; ativa: boolean }> {
  return apiJsonBody('/api/lab/configs', 'POST', payload);
}

export async function labPublishConfig(cid: number): Promise<{ id: number; nome: string; ativa: boolean; published_at: string }> {
  return apiJsonBody(`/api/lab/configs/${cid}/publish`, 'POST', undefined);
}

export async function labRollbackConfig(cid: number): Promise<{ id: number; nome: string; ativa: boolean }> {
  return apiJsonBody(`/api/lab/configs/${cid}/rollback`, 'POST', undefined);
}

/** Remove a config publicada (volta ao default). Restrito a admin no backend. */
export async function labDeactivateConfig(): Promise<{ ok: boolean; ativa: null }> {
  return apiJsonBody('/api/lab/configs/deactivate', 'POST', undefined);
}