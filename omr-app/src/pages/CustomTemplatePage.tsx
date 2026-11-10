import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Trash2,
  Upload, Eye, EyeOff, Printer, FlaskConical, Crosshair, PenSquare,
  Square, Info, QrCode, Boxes, AlertTriangle, CheckCircle2, ImageIcon, ScanSearch, Plus, Move,
  History, Wand2, LayoutTemplate,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  Grid3x3, Magnet, Lock, Copy, Type, Minus, ImagePlus, Bold, Hash, Frame, FileJson,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import Tabs from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { saveBlob, syncExam } from '../utils/api';
import { getExams } from '../utils/storage';
import type { Exam } from '../types';
import {
  CustomAnchor, CustomBlock, CustomConfig, CustomElement, CustomIdGrid, CustomInfoRegion,
  CustomPrintField, CustomQr,
  CustomTemplateDetail, CustomTemplateSummary, CustomTestResult,
  PRINT_SOURCES, STATUS_LABEL, ValidationIssue, activateCustomTemplate,
  autoConfigureCustomTemplate, createCustomTemplate, customTemplateAsset, customTemplateImage,
  customTemplateReadingModel,
  deleteCustomTemplate, detectCustomGrid, detectCustomAnchors, detectPageCorners, expandBlock,
  getCustomTemplate, getCustomVersion, listCustomTemplates, listCustomVersions,
  moveBlockTo, printCustomTemplate, printPreviewCustomTemplate,
  replaceCustomImage,
  removePageImage,
  shiftOverrides, testCustomTemplate, updateCustomTemplate, uploadCustomAsset,
  validateCustomTemplate,
  withBubbleOverride, withoutBubbleOverride,
} from '../utils/custom-template-api';
import {
  AlignMode, alignRects, alignToMargin, clampRect, distributeRects,
  organizeRects, snapDelta,
} from '../utils/custom-template-edit';
import type { CustomVersionRow, PrintPreviewResult } from '../utils/custom-template-api';
import { makeAnchor, nextArucoId } from '../utils/custom-template-anchor';
import { idGridBubbles } from '../utils/id-grid';
import { pageWarnings } from '../utils/template-warnings';
import type { TemplatePageWarning } from '../utils/template-warnings';
import StatusBar from '../components/custom/StatusBar';
import CardGeneratorForm from '../components/custom/CardGeneratorForm';
import EditorShell from '../components/custom/EditorShell';
import EditorTopBar from '../components/custom/editor/EditorTopBar';
import EditorMobilePanels, { type EditorMobileTab } from '../components/custom/editor/EditorMobilePanels';

type RegionType = 'anchor' | 'qr' | 'info' | 'block' | 'element' | 'idgrid';
type Tool = 'select' | 'anchor' | 'qr' | 'info' | 'place-block' | 'bubble' | 'text' | 'line' | 'idgrid';
type Selection = { kind: RegionType; id: string } | null;
type Selected = { kind: RegionType; id: string };

const LAYER_LABELS = { anchors: 'Âncoras', qr: 'QR', info: 'Info', bubbles: 'Bolhas', elements: 'Elementos' } as const;

interface Rect { x: number; y: number; w: number; h: number }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rnd = () => Math.random().toString(36).slice(2, 8);

/** Gestos de pan do editor: botão do meio, Alt+arrastar ou Shift+botão direito. */
const isPanGesture = (e: { button: number; altKey: boolean; shiftKey: boolean }) =>
  e.button === 1 || e.altKey || (e.button === 2 && e.shiftKey);

/** Bloco de questões com todos os campos do esquema (defaults + overrides). */
function defaultBlock(id: string, start: number, over: Partial<CustomBlock> = {}): CustomBlock {
  return {
    id, type: 'bubble_block',
    first_x: 0.3, first_y: 0.3,
    option_step_x: 0.06, question_step_y: 0.035, column_step_x: null,
    columns: 1, n_questions: 10, labels: ['A', 'B', 'C', 'D'], radius: 0.012,
    shape: 'circle', start_question: Math.max(1, start), distribution: 'column',
    multi_answer: false, multi_marks_min: null, multi_marks_max: null,
    points: 1, annulled: false, overrides: {},
    pick_darkest_mark: false, darkest_mark_threshold: null,
    fallback_on_empty: false, fallback_floor: null, mark_style: 'filled',
    page: 0,
    ...over,
  };
}

/** Envolve o notify do ToastProvider na forma { success, error, info }. */
function useNotify() {
  const { notify } = useToast();
  return useMemo(
    () => ({
      success: (m: string) => notify(m, 'success'),
      error: (m: string) => notify(m, 'error'),
      info: (m: string) => notify(m, 'info'),
    }),
    [notify],
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Página (lista de modelos → editor)
// ───────────────────────────────────────────────────────────────────────────

export default function CustomTemplatePage() {
  const toast = useNotify();
  const [templates, setTemplates] = useState<CustomTemplateSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [detail, setDetail] = useState<CustomTemplateDetail | null>(null);
  // Editor "do zero" aberto: a página vira área de trabalho (sem cabeçalho).
  const [creating, setCreating] = useState(false);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await listCustomTemplates();
      setTemplates(res.templates);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao listar os gabaritos');
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const openTemplate = useCallback(async (id: number) => {
    try {
      setDetail(await getCustomTemplate(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir o gabarito');
    }
  }, [toast]);

  if (detail) {
    return (
      <EditorShell>
        <TemplateEditor
          detail={detail}
          onClose={() => { setDetail(null); void refreshList(); }}
          onSaved={setDetail}
        />
      </EditorShell>
    );
  }

  if (creating) {
    return (
      <EditorShell>
        <TemplateList
          templates={templates}
          loading={loadingList}
          onOpen={openTemplate}
          onChanged={refreshList}
          creating
          onStartCreating={() => setCreating(true)}
          onCancelCreating={() => setCreating(false)}
        />
      </EditorShell>
    );
  }

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Gabarito personalizado"
        subtitle="Importe a imagem de um cartão-resposta próprio, marque as regiões e leia com o motor OMR do sistema."
      />
      <TemplateList
        templates={templates}
        loading={loadingList}
        onOpen={openTemplate}
        onChanged={refreshList}
        creating={creating}
        onStartCreating={() => setCreating(true)}
        onCancelCreating={() => setCreating(false)}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Lista + criação
// ───────────────────────────────────────────────────────────────────────────

function TemplateList({
  templates, loading, onOpen, onChanged,
  creating, onStartCreating, onCancelCreating,
}: {
  templates: CustomTemplateSummary[];
  loading: boolean;
  onOpen: (id: number) => void;
  onChanged: () => void;
  /** Editor "do zero" aberto (o componente ocupa toda a área de trabalho). */
  creating: boolean;
  onStartCreating: () => void;
  onCancelCreating: () => void;
}) {
  const toast = useNotify();
  const { user } = useAuth();
  const userId = user?.id;
  const fileRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState('');
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  useEffect(() => {
    try {
      setExams(getExams(userId));
    } catch {
      setExams([]);
    }
  }, [userId]);

  const handleCreate = async (file: File) => {
    setBusy(true);
    try {
      const exam = exams.find((e) => e.id === examId);
      if (exam) {
        // Garante que a avaliação exista no backend antes de vincular o cartão.
        await syncExam(exam).catch(() => undefined);
      }
      const d = await createCustomTemplate(
        file,
        nome.trim() || file.name.replace(/\.[^.]+$/, ''),
        exam?.id,
      );
      toast.success(
        exam
          ? `Modelo importado e vinculado à prova "${exam.name}".`
          : 'Modelo importado. Marque as regiões do cartão.',
      );
      setNome('');
      onOpen(d.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar a imagem');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCustomTemplate(id);
      toast.success('Modelo excluído.');
      setConfirmId(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir');
    }
  };

  return (
    <>
      {creating ? (
        <CardGeneratorForm
          exams={exams}
          onCreated={(d) => { onCancelCreating(); onOpen(d.id); }}
          onCancel={onCancelCreating}
        />
      ) : (
        <>
          <div className="card w-full max-w-6xl">
            <p className="text-sm text-[#71809A] dark:text-gray-300 mb-3">
              Envie uma imagem (PNG/JPG) do seu cartão-resposta. Depois você desenha as
              âncoras, o QR e as bolhas no editor visual.
            </p>
            <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
              <Field label="Nome do modelo" htmlFor="ct-nome">
                <Input id="ct-nome" value={nome} placeholder="Ex.: Cartão da escola"
                       onChange={(e) => setNome(e.target.value)} />
              </Field>
              <Button loading={busy} icon={<Upload size={16} aria-hidden />}
                      onClick={() => fileRef.current?.click()}>
                Importar imagem
              </Button>
              <Button variant="secondary" icon={<LayoutTemplate size={16} aria-hidden />}
                      onClick={onStartCreating}>
                Criar do zero
              </Button>
            </div>
            {exams.length > 0 && (
              <Field label="Vincular à prova (opcional)" htmlFor="ct-exam" className="mt-3"
                     helper="O gabarito é salvo vinculado à avaliação escolhida.">
                <Select id="ct-exam" value={examId} onChange={(e) => setExamId(e.target.value)}>
                  <option value="">Nenhuma</option>
                  {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
                   className="hidden"
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCreate(f); }} />
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Carregando…</p>
          ) : templates.length === 0 ? (
            <EmptyState
              title="Nenhum gabarito personalizado"
              description="Importe uma imagem acima ou crie um cartão do zero."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {templates.map((t) => (
                <div key={t.id} className="card card-hover flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-[#172B4D] dark:text-white truncate">{t.nome}</h3>
                    <span className={`badge ${t.status === 'ativo' ? 'badge-success' : 'badge-info'}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#71809A] dark:text-gray-400">
                    {t.config_summary.n_blocks} bloco(s) · {t.config_summary.n_questions} questão(ões) ·
                    {' '}{t.config_summary.n_anchors} âncora(s){t.config_summary.has_qr ? ' · QR' : ''}
                  </p>
                  <div className="flex gap-2 mt-1">
                    <Button size="sm" onClick={() => onOpen(t.id)} icon={<PenSquare size={15} aria-hidden />}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(t.id)}
                            icon={<Trash2 size={15} aria-hidden />}>
                      Excluir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Excluir modelo?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmId(null)}>Cancelar</Button>
            <Button variant="danger" onClick={() => confirmId !== null && void handleDelete(confirmId)}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          O modelo e a imagem importada serão removidos. Cartões já impressos continuam válidos.
        </p>
      </Modal>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Editor
// ───────────────────────────────────────────────────────────────────────────

type MoveItem =
  | { kind: 'anchor' | 'qr' | 'info' | 'element' | 'idgrid'; id: string; orig: Rect }
  | { kind: 'block'; id: string; orig: { x: number; y: number } };

type DragState =
  | { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'move'; start: { x: number; y: number }; items: MoveItem[]; snap: boolean; others: Rect[] }
  | { kind: 'resize'; region: Exclude<RegionType, 'block'>; id: string; handle: string; orig: Rect }
  | { kind: 'bubble'; blockId: string; question: number; option: string; start: { x: number; y: number }; orig: { x: number; y: number } }
  | { kind: 'pagecorner'; index: number; start: { x: number; y: number }; orig: { x: number; y: number } };

interface CreateBox { x0: number; y0: number; x1: number; y1: number }

function TemplateEditor({
  detail, onClose, onSaved,
}: {
  detail: CustomTemplateDetail;
  onClose: () => void;
  onSaved: (d: CustomTemplateDetail) => void;
}) {
  const toast = useNotify();
  const [config, setConfig] = useState<CustomConfig>(() => clone(detail.config));
  const [issues, setIssues] = useState<ValidationIssue[]>(detail.issues ?? []);
  const [status, setStatus] = useState(detail.status);
  const [selection, setSelectionState] = useState<Selection>(null);
  // Multi-seleção: `selection` continua sendo o item primário (painel de
  // propriedades); `selected` é o grupo usado nas ações (mover, alinhar...).
  const [selected, setSelected] = useState<Selected[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(0.5);
  const [show, setShow] = useState({ anchors: true, qr: true, info: true, bubbles: true, elements: true });
  const [showGrid, setShowGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [anchorType, setAnchorType] = useState<'aruco' | 'quad'>('quad');
  const [anchorArucoId, setAnchorArucoId] = useState(0);
  const [anchorSize, setAnchorSize] = useState(0.05);
  const [creating, setCreating] = useState<CreateBox | null>(null);
  const [dragKind, setDragKind] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectingAnchors, setDetectingAnchors] = useState(false);
  const [detectingPageCorners, setDetectingPageCorners] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  // Multi-página (mesma folha): página do modelo atualmente editada.
  const [pageIdx, setPageIdx] = useState(0);
  // Cópia de configuração de outro modelo
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyCandidates, setCopyCandidates] = useState<CustomTemplateSummary[]>([]);
  const [copyFromId, setCopyFromId] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  // Painel direito: uma aba por vez evita empilhar propriedades + diagnóstico + ações.
  const [rightTab, setRightTab] = useState<'props' | 'diag' | 'actions'>('props');
  // Em telas pequenas, os painéis laterais viram abas dentro de um bottom sheet.
  const [mobilePanel, setMobilePanel] = useState<EditorMobileTab | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  /** O usuário ajustou o zoom manualmente: não re-ajustar sozinho ao redimensionar. */
  const zoomManualRef = useRef(false);

  // Seleção: clique simples substitui; Shift/Ctrl alterna dentro do grupo.
  const setSelection = (s: Selection, additive = false) => {
    if (!s) { setSelected([]); setSelectionState(null); return; }
    if (additive) {
      const exists = selected.some((x) => x.kind === s.kind && x.id === s.id);
      const next = exists
        ? selected.filter((x) => !(x.kind === s.kind && x.id === s.id))
        : [...selected, s];
      setSelected(next);
      setSelectionState(next.length ? next[next.length - 1] : null);
      return;
    }
    setSelected([s]);
    setSelectionState(s);
  };
  const selectMany = (list: Selected[]) => {
    setSelected(list);
    setSelectionState(list.length ? list[list.length - 1] : null);
  };

  // Logos dos elementos: id opaco → object URL local para o canvas.
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = Array.from(new Set(
      (config.elements ?? []).map((e) => e.asset).filter((a): a is string => !!a),
    )).filter((a) => !assetUrls[a]);
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      const loaded: Record<string, string> = {};
      for (const id of ids) {
        try {
          loaded[id] = URL.createObjectURL(await customTemplateAsset(detail.id, id));
        } catch { /* logo ausente: a validação avisa ao salvar */ }
      }
      if (!cancelled && Object.keys(loaded).length) setAssetUrls((m) => ({ ...m, ...loaded }));
    })();
    return () => { cancelled = true; };
  }, [config.elements, detail.id, assetUrls]);

  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  const [past, setPast] = useState<CustomConfig[]>([]);
  const [future, setFuture] = useState<CustomConfig[]>([]);

  const pushHistory = useCallback((snap: CustomConfig) => {
    setPast((p) => [...p.slice(-49), snap]);
    setFuture([]);
    setDirty(true);
  }, []);

  const apply = useCallback((next: CustomConfig) => {
    pushHistory(clone(configRef.current));
    setConfig(next);
  }, [pushHistory]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [clone(configRef.current), ...f]);
      setConfig(prev);
      setDirty(true);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, clone(configRef.current)]);
      setConfig(next);
      setDirty(true);
      return f.slice(1);
    });
  }, []);

  // Imagem de fundo (uma por página: 0 = base, demais = imagem própria)
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgVersion, setImgVersion] = useState(0);
  const nPages = Math.max(1, config.n_pages ?? 1);
  // Avisos de completude por página (não bloqueiam salvar/ativar).
  const warnings = useMemo(() => pageWarnings(config), [config]);
  // Página efetivamente editada (clampada ao número disponível).
  const currentPage = Math.min(pageIdx, nPages - 1);
  const pageMeta = detail.page_images?.find((p) => p.page === currentPage);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await customTemplateImage(detail.id, currentPage);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImgUrl(url);
      } catch {
        /* preview é opcional */
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [detail.id, currentPage, imgVersion]);

  const baseW = pageMeta?.image_w || config.page_w || detail.image_w || 1000;
  const baseH = pageMeta?.image_h || config.page_h || detail.image_h || 1400;

  // Troca/atribui a imagem da página editada (página 0 = imagem base).
  const pageImageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPageImage, setUploadingPageImage] = useState(false);
  const handlePageImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingPageImage(true);
    try {
      const d = await replaceCustomImage(detail.id, file, currentPage);
      onSaved(d);
      // A imagem já foi gravada no servidor: mantém a referência no config
      // local para o próximo "Salvar" não apagar o vínculo.
      setConfig((c) => ({ ...c, page_images: d.config.page_images }));
      setImgVersion((v) => v + 1);
      toast.success(`Imagem da página ${currentPage + 1} atualizada.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar a imagem');
    } finally {
      setUploadingPageImage(false);
    }
  };

  // Selecionar uma região (canvas ou lista) traz as propriedades para a frente.
  useEffect(() => {
    if (selection) setRightTab('props');
  }, [selection]);

  /** Zoom que faz o cartão inteiro caber na área visível, centralizado. */
  const fitToScreen = useCallback(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const pad = 24;
    const z = clamp(Math.min((el.clientWidth - pad) / baseW, (el.clientHeight - pad) / baseH), 0.1, 4);
    setZoom(z);
    // Centralização é do CSS (margin auto): quando o cartão cabe, não há barra.
    el.scrollLeft = 0;
    el.scrollTop = 0;
    // "Ajustar à tela" é uma ação explícita: libera o re-ajuste automático.
    zoomManualRef.current = false;
  }, [baseW, baseH]);

  // A área do editor muda de tamanho (janela, barras, troca de página):
  // re-ajusta o zoom para o cartão continuar cabendo — a menos que o usuário
  // tenha escolhido um zoom manualmente.
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (zoomManualRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (zoomManualRef.current) return;
        const pad = 24;
        const z = clamp(Math.min((el.clientWidth - pad) / baseW, (el.clientHeight - pad) / baseH), 0.1, 4);
        setZoom(z);
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [baseW, baseH]);

  // Ctrl + roda do mouse aproxima/afasta o cartão. O wheel é não-passivo para
  // poder cancelar o zoom do navegador, que encolheria a página inteira.
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomManualRef.current = true;
      setZoom((z) => {
        const next = z - e.deltaY * 0.0005;
        return Math.min(4, Math.max(0.1, Math.round(next * 1000) / 1000));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Config recortada à página atual: o canvas/overlay/lista mostram só as
  // regiões dessa página. QR, info e print_fields são compartilhados.
  const pageConfig = useMemo<CustomConfig>(
    () => ({
      ...config,
      anchors: config.anchors.filter((a) => (a.page ?? 0) === currentPage),
      questions: config.questions.filter((b) => (b.page ?? 0) === currentPage),
      elements: (config.elements ?? []).filter((e) => (e.page ?? 0) === currentPage),
    }),
    [config, currentPage],
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const snapRef = useRef<CustomConfig | null>(null);
  const creatingRef = useRef<CreateBox | null>(null);
  const createCtxRef = useRef<{ tool: 'anchor' | 'qr' | 'info' | 'text' | 'line' | 'idgrid'; anchorType: 'aruco' | 'quad'; arucoId: number; anchorSize: number; page: number }>(
    { tool: 'anchor', anchorType: 'quad', arucoId: 0, anchorSize: 0.05, page: 0 },
  );
  const pendingBlockRef = useRef<CustomBlock | null>(null);

  const bubbles = useMemo(
    () => pageConfig.questions.flatMap((b) => expandBlock(b)),
    [pageConfig.questions],
  );

  const toBase = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return {
      x: clamp((clientX - r.left) * (baseW / (r.width || 1)), 0, baseW),
      y: clamp((clientY - r.top) * (baseH / (r.height || 1)), 0, baseH),
    };
  }, [baseW, baseH]);

  // drag global (move/redimensiona/cria)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (creatingRef.current) {
        const p = toBase(e.clientX, e.clientY);
        creatingRef.current = { ...creatingRef.current, x1: p.x, y1: p.y };
        setCreating(creatingRef.current);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'pan') {
        const el = canvasWrapRef.current;
        if (el) {
          el.scrollLeft = d.origX - (e.clientX - d.startX);
          el.scrollTop = d.origY - (e.clientY - d.startY);
        }
        return;
      }
      const p = toBase(e.clientX, e.clientY);
      if (d.kind === 'move') {
        let dx = (p.x - d.start.x) / baseW;
        let dy = (p.y - d.start.y) / baseH;
        const primary = d.items[0];
        if (d.snap && primary && primary.kind !== 'block') {
          const moved = { ...primary.orig, x: primary.orig.x + dx, y: primary.orig.y + dy };
          const s = snapDelta(moved, d.others, 0.005, 0.004);
          dx += s.dx;
          dy += s.dy;
          setGuides({ x: s.guidesX, y: s.guidesY });
        }
        setConfig((cfg) => {
          let next = cfg;
          for (const it of d.items) {
            if (it.kind === 'block') {
              next = setBlockStart(next, it.id, clamp(it.orig.x + dx, 0, 1), clamp(it.orig.y + dy, 0, 1));
            } else {
              next = setRect(next, it.kind, it.id, {
                x: clamp(it.orig.x + dx, 0, 1 - it.orig.w),
                y: clamp(it.orig.y + dy, 0, 1 - it.orig.h),
                w: it.orig.w,
                h: it.orig.h,
              });
            }
          }
          return next;
        });
      } else if (d.kind === 'resize') {
        setConfig((cfg) => setRect(cfg, d.region, d.id, resizeRect(d.orig, d.handle, p.x / baseW, p.y / baseH)));
      } else if (d.kind === 'bubble') {
        const dx = (p.x - d.start.x) / baseW;
        const dy = (p.y - d.start.y) / baseH;
        const nx = clamp(d.orig.x + dx, 0, 1);
        const ny = clamp(d.orig.y + dy, 0, 1);
        setConfig((cfg) => ({
          ...cfg,
          questions: cfg.questions.map((b) => (
            b.id === d.blockId ? withBubbleOverride(b, d.question, d.option, nx, ny) : b
          )),
        }));
      } else if (d.kind === 'pagecorner') {
        const dx = (p.x - d.start.x) / baseW;
        const dy = (p.y - d.start.y) / baseH;
        setConfig((cfg) => setPageCorner(cfg, d.index, clamp(d.orig.x + dx, 0, 1), clamp(d.orig.y + dy, 0, 1)));
      }
    };

    const onUp = () => {
      if (creatingRef.current) {
        const c = creatingRef.current;
        creatingRef.current = null;
        setCreating(null);
        const ctx = createCtxRef.current;
        setTool('select');
        let w = Math.abs(c.x1 - c.x0) / baseW;
        let h = Math.abs(c.y1 - c.y0) / baseH;
        if (w < 0.012 || h < 0.012) {
          // Texto/linha aceitam clique sem arrasto (tamanho padrão).
          if (ctx.tool !== 'text' && ctx.tool !== 'line' && ctx.tool !== 'idgrid') return;
          // A matrícula precisa de 10 linhas: clique simples dá um tamanho útil.
          w = Math.max(w, ctx.tool === 'line' ? 0.3 : ctx.tool === 'idgrid' ? 0.25 : 0.2);
          h = Math.max(h, ctx.tool === 'line' ? 0.004 : ctx.tool === 'idgrid' ? 0.16 : 0.05);
        }
        const rect: Rect = {
          x: Math.min(c.x0, c.x1) / baseW,
          y: Math.min(c.y0, c.y1) / baseH,
          w, h,
        };
        const snap = clone(configRef.current);
        const created = buildCreate(configRef.current, ctx.tool, rect, ctx.anchorType, ctx.arucoId, ctx.anchorSize, ctx.page);
        if (created) {
          setConfig(created.config);
          pushHistory(snap);
          setSelection(created.selection);
        }
        return;
      }
      const d = dragRef.current;
      /* Nada estava sendo arrastado: sai sem mexer em estado. Um setGuides()
         aqui criava um objeto novo a cada pointerup e re-renderizava a página
         inteira — inclusive o Modal aberto, cujo efeito refocava o botão de
         fechar e derrubava a lista do <select> no meio da escolha. */
      if (!d) return;
      dragRef.current = null;
      setDragKind(null);
      setGuides({ x: [], y: [] });
      if (d.kind === 'pan') return;
      if (snapRef.current) {
        pushHistory(snapRef.current);
        snapRef.current = null;
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // `setSelection` é recriado a cada render (depende da seleção atual). Aqui
    // ele só é usado no fim de uma criação; reinstalar os listeners a cada
    // seleção não muda nada e atrapalha o arrasto em andamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseW, baseH, toBase, pushHistory, currentPage]);

  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // O pan é tratado no contêiner do editor (funciona também na área cinza).
    if (isPanGesture(e)) return;
    // Clique direito sem Shift apenas abre o menu de contexto.
    if (e.button !== 0) return;
    if (tool === 'select') { setSelection(null); return; }
    if (tool === 'place-block' || tool === 'bubble') return;
    const p = toBase(e.clientX, e.clientY);
    createCtxRef.current = { tool, anchorType, arucoId: anchorArucoId, anchorSize, page: currentPage };
    creatingRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    setCreating(creatingRef.current);
  };

  const onSvgClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (tool !== 'place-block') return;
    const p = toBase(e.clientX, e.clientY);
    const block = pendingBlockRef.current;
    if (block) {
      apply({
        ...configRef.current,
        questions: [...configRef.current.questions, { ...block, first_x: p.x / baseW, first_y: p.y / baseH, page: currentPage }],
      });
      setSelection({ kind: 'block', id: block.id });
      toast.success('Bloco de questões posicionado.');
    }
    pendingBlockRef.current = null;
    setTool('select');
  };

  const startDragRegion = (e: ReactPointerEvent<SVGElement>, kind: RegionType, id: string) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    setSelection({ kind, id }, additive);
    const cfg = configRef.current;
    const already = selected.some((s) => s.kind === kind && s.id === id);
    const group: Selected[] = already && !additive ? selected : [{ kind, id }];
    const items: MoveItem[] = [];
    for (const s of group) {
      if (isLocked(cfg, s.kind, s.id)) continue;
      if (s.kind === 'block') {
        const b = cfg.questions.find((x) => x.id === s.id);
        if (b) items.push({ kind: 'block', id: s.id, orig: { x: b.first_x, y: b.first_y } });
      } else {
        const orig = rectOf(cfg, s.kind, s.id);
        if (orig) items.push({ kind: s.kind, id: s.id, orig });
      }
    }
    if (!items.length) return;
    const ids = new Set(items.map((it) => `${it.kind}:${it.id}`));
    // Guias: bordas/centros das outras regiões desta página.
    const others: Rect[] = [
      ...cfg.anchors.filter((a) => (a.page ?? 0) === currentPage && !ids.has(`anchor:${a.id}`))
        .map((a) => ({ x: a.x - a.size / 2, y: a.y - a.size / 2, w: a.size, h: a.size })),
      ...(cfg.qr && !ids.has(`qr:${cfg.qr.id}`) ? [{ x: cfg.qr.x, y: cfg.qr.y, w: cfg.qr.w, h: cfg.qr.h }] : []),
      ...cfg.info_regions.filter((i) => !ids.has(`info:${i.id}`))
        .map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })),
      ...(cfg.elements ?? []).filter((el) => (el.page ?? 0) === currentPage && !ids.has(`element:${el.id}`))
        .map((el) => ({ x: el.x, y: el.y, w: el.w, h: el.h })),
    ];
    snapRef.current = clone(cfg);
    dragRef.current = {
      kind: 'move', start: toBase(e.clientX, e.clientY), items,
      snap: snapEnabled, others,
    };
    setDragKind('move');
  };

  const startBubbleDrag = (
    e: ReactPointerEvent<SVGElement>, blockId: string, question: number, option: string,
    x: number, y: number,
  ) => {
    // Alt+arrasto continua sendo pan da página, mesmo sobre uma bolha.
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    if (isLocked(configRef.current, 'block', blockId)) return;
    setSelection({ kind: 'block', id: blockId });
    snapRef.current = clone(configRef.current);
    const p = toBase(e.clientX, e.clientY);
    dragRef.current = { kind: 'bubble', blockId, question, option, start: p, orig: { x, y } };
    setDragKind('bubble');
  };

  const startResize = (e: ReactPointerEvent<SVGElement>, kind: Exclude<RegionType, 'block'>, id: string, handle: string, orig: Rect) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    if (isLocked(configRef.current, kind, id)) return;
    snapRef.current = clone(configRef.current);
    dragRef.current = { kind: 'resize', region: kind, id, handle, orig };
    setDragKind('resize');
  };

  const startPageCornerDrag = (e: ReactPointerEvent<SVGElement>, index: number) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    const pc = configRef.current.page_corners;
    if (!pc || pc.length !== 4) return;
    snapRef.current = clone(configRef.current);
    const p = toBase(e.clientX, e.clientY);
    dragRef.current = { kind: 'pagecorner', index, start: p, orig: { x: pc[index].x, y: pc[index].y } };
    setDragKind('pagecorner');
  };

  /** Cria/redefine os 4 cantos da folha para ajuste manual (âncoras ou borda). */
  const startManualPageCorners = () => {
    const cfg = configRef.current;
    const anchors = cfg.anchors.filter((a) => (a.page ?? 0) === currentPage && a.corner);
    const fromAnchors = anchors.length === 4
      ? (['TL', 'TR', 'BR', 'BL'] as const).map((c) => {
          const a = anchors.find((x) => x.corner === c)!;
          return { x: a.x, y: a.y };
        })
      : null;
    apply({
      ...cfg,
      page_corners: fromAnchors ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    });
    toast.info('Cantos da folha prontos para ajuste — arraste os 4 pontos.');
  };

  const removePageCorners = () => {
    apply({ ...configRef.current, page_corners: null });
    toast.info('Cantos da folha removidos.');
  };

  const addBlock = () => {
    const id = `blk_${rnd()}`;
    const start = config.questions.reduce((m, b) => Math.max(m, b.start_question + b.n_questions), 1);
    pendingBlockRef.current = defaultBlock(id, start);
    setTool('place-block');
    toast.info('Clique no cartão para posicionar a 1ª alternativa (A) da 1ª questão.');
  };

  /** Adiciona uma âncora clicável (próximo canto livre) sem precisar desenhar. */
  const addAnchor = () => {
    const anchor = makeAnchor({
      id: `anc_${rnd()}`,
      type: anchorType,
      arucoId: anchorArucoId,
      size: anchorSize,
      page: currentPage,
      anchors: configRef.current.anchors,
    });
    apply({ ...configRef.current, anchors: [...configRef.current.anchors, anchor] });
    setSelection({ kind: 'anchor', id: anchor.id });
    if (anchor.type === 'aruco' && anchor.aruco_id != null) {
      setAnchorArucoId(anchor.aruco_id + 1);
    }
    toast.success('Âncora adicionada. Arraste para posicionar e edite tipo/tamanho na barra lateral.');
  };

  // Analisa a imagem importada e sugere bloco(s) de bolhas (ação no undo).
  const detectGrid = async () => {
    setDetecting(true);
    try {
      const res = await detectCustomGrid(detail.id, currentPage);
      if (!res.ok || !res.blocks.length) {
        toast.info('Não encontrei uma grade de bolhas nesta imagem — posicione o bloco manualmente.');
        return;
      }
      const blocks = res.blocks.map((b) =>
        defaultBlock(b.id || `blk_${rnd()}`, b.start_question, { ...b, page: b.page ?? currentPage }));
      apply({ ...configRef.current, questions: [...configRef.current.questions, ...blocks] });
      setSelection({ kind: 'block', id: blocks[0].id });
      toast.success(`Grade detectada: ${blocks.length} bloco(s) de questões. Ajuste se precisar.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao detectar a grade');
    } finally {
      setDetecting(false);
    }
  };

  const detectAnchors = async () => {
    setDetectingAnchors(true);
    try {
      const res = await detectCustomAnchors(detail.id, currentPage);
      if (!res.ok || !res.anchors.length) {
        toast.info('Não encontrei âncoras nesta imagem — marque-as manualmente.');
        return;
      }
      const others = configRef.current.anchors.filter((a) => (a.page ?? 0) !== currentPage);
      apply({ ...configRef.current, anchors: [...others, ...res.anchors] });
      toast.success(`${res.count} âncora(s) detectada(s) e centralizada(s). Ajuste se precisar.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao detectar as âncoras');
    } finally {
      setDetectingAnchors(false);
    }
  };

  const handleDetectPageCorners = async () => {
    setDetectingPageCorners(true);
    try {
      const res = await detectPageCorners(detail.id, currentPage);
      if (!res.ok || !res.corners || res.corners.length !== 4) {
        toast.info('Não encontrei os cantos da folha — marque-os manualmente.');
        return;
      }
      apply({ ...configRef.current, page_corners: res.corners });
      if (res.warning) {
        toast.error(res.warning);
      } else if (res.inferred) {
        toast.info('Cantos estimados (baixa confiança) — confira e ajuste os pontos se necessário.');
      } else {
        toast.success('Cantos da folha detectados. Ajuste se precisar.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao detectar os cantos da folha');
    } finally {
      setDetectingPageCorners(false);
    }
  };

  // Páginas do cartão: adiciona uma página nova (copia as âncoras da 1ª página
  // que as tenha, como ponto de partida) e remove a página atual. Cada página
  // pode receber a própria imagem; até lá repete a imagem base.
  const addPage = () => {
    const idx = nPages;
    const srcPage: number | null = config.anchors.length
      ? (config.anchors.find((a) => (a.page ?? 0) === 0) ? 0
         : (config.anchors[0].page ?? 0))
      : null;
    const copied = srcPage == null
      ? []
      : config.anchors.filter((a) => (a.page ?? 0) === (srcPage as number))
          .map((a) => ({ ...a, id: `anc_${rnd()}`, page: idx }));
    apply({ ...configRef.current, n_pages: nPages + 1,
            anchors: [...configRef.current.anchors, ...copied] });
    setPageIdx(idx);
    setSelection(null);
    toast.info(copied.length
      ? `Página ${idx + 1} criada com as âncoras da página ${(srcPage ?? 0) + 1}. Envie a imagem desta página se ela for diferente.`
      : `Página ${idx + 1} criada.`);
  };
  const removePage = () => {
    if (nPages <= 1) return;
    const idx = currentPage;
    const cfg = configRef.current;
    apply({
      ...cfg,
      n_pages: nPages - 1,
      // Reindexa as imagens próprias junto com as regiões (o servidor
      // descarta chaves >= n_pages ao salvar).
      page_images: removePageImage(cfg.page_images, idx),
      anchors: cfg.anchors
        .filter((a) => (a.page ?? 0) !== idx)
        .map((a) => ((a.page ?? 0) > idx ? { ...a, page: (a.page ?? 0) - 1 } : a)),
      questions: cfg.questions
        .filter((b) => (b.page ?? 0) !== idx)
        .map((b) => ((b.page ?? 0) > idx ? { ...b, page: (b.page ?? 0) - 1 } : b)),
      elements: (cfg.elements ?? [])
        .filter((e) => (e.page ?? 0) !== idx)
        .map((e) => ((e.page ?? 0) > idx ? { ...e, page: (e.page ?? 0) - 1 } : e)),
    });
    setPageIdx(Math.max(0, idx - 1));
    setSelection(null);
  };

  const openCopy = async () => {
    try {
      const res = await listCustomTemplates();
      setCopyCandidates((res.templates ?? []).filter((t) => t.id !== detail.id));
      setCopyFromId(null);
      setCopyOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao listar modelos');
    }
  };
  const doCopy = async () => {
    if (!copyFromId) return;
    setCopying(true);
    try {
      const src = await getCustomTemplate(copyFromId);
      const c = src.config;
      // Clona regiões com novos ids (evita colisão com o modelo atual).
      const infoIdMap = new Map<string, string>();
      const infoRegions = (c.info_regions ?? []).map((r) => {
        const id = `info_${rnd()}`;
        infoIdMap.set(r.id, id);
        return { ...r, id };
      });
      const cloned: CustomConfig = {
        ...c,
        anchors: (c.anchors ?? []).map((a) => ({ ...a, id: `anc_${rnd()}` })),
        qr: c.qr ? { ...c.qr, id: `qr_${rnd()}` } : null,
        info_regions: infoRegions,
        questions: (c.questions ?? []).map((b) => ({ ...b, id: `blk_${rnd()}` })),
        elements: (c.elements ?? []).map((e) => ({ ...e, id: `el_${rnd()}` })),
        // Os campos impressos referenciam o id da região informativa: sem o
        // remapeamento eles ficariam órfãos (e deixariam de ser impressos).
        print_fields: (c.print_fields ?? []).map((f) => ({
          ...f, region_id: infoIdMap.get(f.region_id) ?? f.region_id,
        })),
      };
      apply(cloned);
      setCopyOpen(false);
      toast.success('Configuração copiada. Revise e salve.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao copiar configuração');
    } finally {
      setCopying(false);
    }
  };

  const save = useCallback(async (silent = false): Promise<boolean> => {
    setSaving(true);
    try {
      const d = await updateCustomTemplate(detail.id, { config });
      onSaved(d);
      const v = await validateCustomTemplate(detail.id);
      setIssues(v.issues);
      setStatus(v.status as typeof status);
      setDirty(false);
      if (!silent) toast.success('Modelo salvo.');
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar');
      return false;
    } finally {
      setSaving(false);
    }
  }, [config, detail.id, onSaved, toast]);

  // Autosave: 1,5 s depois da última alteração. Falha mantém "não salvo".
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => { void saveRef.current(true); }, 1500);
    return () => window.clearTimeout(t);
  }, [config, dirty]);

  const runValidate = async () => {
    try {
      const v = await validateCustomTemplate(detail.id);
      setIssues(v.issues);
      setStatus(v.status as typeof status);
      toast[v.ok ? 'success' : 'error'](v.ok ? 'Configuração válida.' : 'Há erros a corrigir.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na validação');
    }
  };

  // Configura a página de uma vez (âncoras → cantos da folha → grade).
  // Salva antes: o servidor parte da config salva, e assim alterações
  // pendentes das outras páginas não são descartadas.
  const autoConfigure = async () => {
    if (dirty && !(await save())) return;
    setAutoBusy(true);
    try {
      const res = await autoConfigureCustomTemplate(detail.id, currentPage);
      if (!res.ok) {
        toast.info('Não encontrei âncoras nem grade nesta imagem — configure manualmente.');
        return;
      }
      apply(res.config);
      setIssues(res.issues);
      setSelection(null);
      const r = res.report;
      const parts = [
        r.anchors ? `${r.anchors} âncora(s)` : 'sem âncoras',
        r.blocks ? `${r.blocks} bloco(s) · ${r.questions} questão(ões)` : 'sem grade',
        r.page_corners ? (r.page_corners_inferred ? 'cantos estimados' : 'cantos da folha') : 'sem cantos da folha',
      ];
      toast.success(`Página ${currentPage + 1}: ${parts.join(' · ')}. Revise e salve.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao configurar automaticamente');
    } finally {
      setAutoBusy(false);
    }
  };

  const activate = async () => {
    if (dirty && !(await save())) return;
    try {
      const r = await activateCustomTemplate(detail.id);
      setStatus('ativo');
      toast.success(`Modelo ativado (versão ${r.version}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ativar (corrija os erros)');
    }
  };

  const updateField = useCallback((patch: Partial<CustomConfig>) => {
    apply({ ...configRef.current, ...patch });
  }, [apply]);

  // ── Paleta: imagem/logo ───────────────────────────────────────────────────
  const assetInputRef = useRef<HTMLInputElement>(null);
  const assetTargetRef = useRef<string | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const pickAsset = (elementId: string | null) => {
    assetTargetRef.current = elementId;
    assetInputRef.current?.click();
  };
  const handleAssetFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAsset(true);
    try {
      const { asset, w, h } = await uploadCustomAsset(detail.id, file);
      const target = assetTargetRef.current;
      assetTargetRef.current = null;
      if (target) {
        updateField({
          elements: (configRef.current.elements ?? []).map((el) => (el.id === target ? { ...el, asset } : el)),
        });
      } else {
        // Mantém a proporção da imagem no papel (w/h normalizados).
        const ew = 0.2;
        const eh = clamp(ew * (baseW / baseH) * (w && h ? h / w : 1), 0.01, 1);
        const el: CustomElement = {
          id: `el_${rnd()}`, kind: 'image', page: currentPage, x: 0.1, y: 0.1, w: ew, h: eh,
          text: '', font_size: 40, align: 'left', bold: false, asset,
        };
        apply({ ...configRef.current, elements: [...(configRef.current.elements ?? []), el] });
        setSelection({ kind: 'element', id: el.id });
      }
      toast.success('Imagem adicionada ao cartão.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar a imagem');
    } finally {
      setUploadingAsset(false);
    }
  };

  // ── Ações sobre a seleção ─────────────────────────────────────────────────
  const duplicateSelected = () => {
    const cfg = configRef.current;
    const d = 0.02;
    let next = cfg;
    const created: Selected[] = [];
    for (const s of selected) {
      if (s.kind === 'qr') continue; // só existe um QR por cartão
      if (s.kind === 'anchor') {
        const a = cfg.anchors.find((x) => x.id === s.id);
        if (!a) continue;
        const c = { ...a, id: `anc_${rnd()}`, x: clamp(a.x + d, 0, 1), y: clamp(a.y + d, 0, 1) };
        next = { ...next, anchors: [...next.anchors, c] };
        created.push({ kind: 'anchor', id: c.id });
      } else if (s.kind === 'info') {
        const i = cfg.info_regions.find((x) => x.id === s.id);
        if (!i) continue;
        const c = { ...i, id: `info_${rnd()}`, x: clamp(i.x + d, 0, 1 - i.w), y: clamp(i.y + d, 0, 1 - i.h) };
        next = { ...next, info_regions: [...next.info_regions, c] };
        created.push({ kind: 'info', id: c.id });
      } else if (s.kind === 'element') {
        const el = (cfg.elements ?? []).find((x) => x.id === s.id);
        if (!el) continue;
        const c = { ...el, id: `el_${rnd()}`, x: clamp(el.x + d, 0, 1 - el.w), y: clamp(el.y + d, 0, 1 - el.h) };
        next = { ...next, elements: [...(next.elements ?? []), c] };
        created.push({ kind: 'element', id: c.id });
      } else {
        const b = cfg.questions.find((x) => x.id === s.id);
        if (!b) continue;
        const c = moveBlockTo({ ...b, id: `blk_${rnd()}` }, clamp(b.first_x + d, 0, 1), clamp(b.first_y + d, 0, 1));
        next = { ...next, questions: [...next.questions, c] };
        created.push({ kind: 'block', id: c.id });
      }
    }
    if (!created.length) return;
    apply(next);
    selectMany(created);
  };

  const deleteSelected = () => {
    if (!selected.length) return;
    let next = configRef.current;
    for (const s of selected) next = removeRegion(next, s.kind, s.id);
    apply(next);
    setSelection(null);
  };

  const toggleLock = () => {
    if (!selected.length) return;
    const ids = new Set(selected.map((s) => `${s.kind}:${s.id}`));
    const flip = <T extends { id: string; locked?: boolean }>(kind: RegionType, item: T): T =>
      (ids.has(`${kind}:${item.id}`) ? { ...item, locked: !item.locked } : item) as T;
    const cfg = configRef.current;
    apply({
      ...cfg,
      anchors: cfg.anchors.map((a) => flip('anchor', a)),
      qr: cfg.qr ? flip('qr', cfg.qr) : null,
      info_regions: cfg.info_regions.map((i) => flip('info', i)),
      questions: cfg.questions.map((b) => flip('block', b)),
      elements: (cfg.elements ?? []).map((e) => flip('element', e)),
    });
  };

  const movableSelected = () => {
    const cfg = configRef.current;
    return selected
      .filter((s) => s.kind !== 'block' && !isLocked(cfg, s.kind, s.id))
      .map((s) => ({ s, r: rectOf(cfg, s.kind, s.id) }))
      .filter((x): x is { s: Selected; r: Rect } => !!x.r);
  };

  const alignSelected = (mode: AlignMode) => {
    const items = movableSelected();
    if (items.length < 2) return;
    const out = alignRects(items.map((x) => x.r), mode);
    let next = configRef.current;
    items.forEach((x, i) => {
      next = setRect(next, x.s.kind as Exclude<RegionType, 'block'>, x.s.id, clampRect(out[i]));
    });
    apply(next);
  };

  const distributeSelected = (axis: 'x' | 'y') => {
    const items = movableSelected();
    if (items.length < 3) return;
    const out = distributeRects(items.map((x) => x.r), axis);
    let next = configRef.current;
    items.forEach((x, i) => {
      next = setRect(next, x.s.kind as Exclude<RegionType, 'block'>, x.s.id, clampRect(out[i]));
    });
    apply(next);
  };

  /** Organizar alinha pela margem da PÁGINA, então vale com 1 elemento. */
  const applyToMovable = (fn: (rects: Rect[]) => Rect[], min = 1) => {
    const items = movableSelected();
    if (items.length < min) return;
    const out = fn(items.map((x) => x.r));
    let next = configRef.current;
    items.forEach((x, i) => {
      next = setRect(next, x.s.kind as Exclude<RegionType, 'block'>, x.s.id, clampRect(out[i]));
    });
    apply(next);
  };

  const organizeSelected = () =>
    applyToMovable((rects) => organizeRects(rects, 0.05, 0.02, 0.45));

  const alignToMarginSelected = (side: 'left' | 'right' | 'top' | 'bottom') =>
    applyToMovable((rects) => alignToMargin(rects, side, 0.05));

  // Atalhos do editor (ignora campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.length) { e.preventDefault(); deleteSelected(); }
        return;
      }
      if (e.key === 'Escape') { setSelection(null); setTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const renderLeftPanel = (visibleOnMobile: boolean) => (
    <div className={`card flex flex-col space-y-3 lg:h-full lg:min-h-0 overflow-y-auto ${visibleOnMobile ? 'hidden lg:flex' : 'flex'}`}>
          {/* Multi-página (mesma folha): abas de página */}
          {/* Multi-página (mesma folha): abas de página */}
          <div className="space-y-2">
            <p className="label">Páginas do cartão</p>
            <div className="flex flex-wrap items-center gap-1">
              {Array.from({ length: nPages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setPageIdx(i); setSelection(null); }}
                  className={`btn btn-sm min-h-[36px] px-3 ${i === currentPage ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {i + 1}
                </button>
              ))}
              <button type="button" onClick={addPage} title="Adicionar página (mesma folha)"
                      className="btn btn-sm min-h-[36px] px-2 btn-secondary">
                <Plus size={14} aria-hidden />
              </button>
              {nPages > 1 && (
                <button type="button" onClick={removePage} title="Excluir a página atual"
                        className="btn btn-sm min-h-[36px] px-2 btn-secondary text-red-600 dark:text-red-400">
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Página {currentPage + 1} de {nPages}
              {nPages > 1 ? ' · as regiões editadas pertencem a esta página' : ''}.
            </p>
            {warnings.length > 0 && (
              <ul className="space-y-1" aria-label="Avisos do modelo">
                {warnings.map((w) => (
                  <li key={`${w.page}-${w.code}`}>
                    <button
                      type="button"
                      onClick={() => { setPageIdx(w.page); setSelection(null); }}
                      className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-500/10"
                      title="Ir para esta página"
                    >
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                      <span>{w.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input ref={pageImageInputRef} type="file" accept="image/*" hidden
                   onChange={(e) => void handlePageImage(e)} />
            <input ref={assetInputRef} type="file" accept="image/*" hidden
                   onChange={(e) => void handleAssetFile(e)} />
            <Button variant="secondary" size="sm" loading={uploadingPageImage}
                    icon={<ImageIcon size={14} aria-hidden />}
                    onClick={() => pageImageInputRef.current?.click()}>
              {currentPage === 0 ? 'Trocar imagem base' : (pageMeta?.own_image ? 'Trocar imagem desta página' : 'Enviar imagem desta página')}
            </Button>
            {nPages > 1 && currentPage > 0 && !pageMeta?.own_image && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Sem imagem própria, esta página repete a imagem da página 1.
              </p>
            )}
          </div>
          <Toolbar tool={tool} setTool={(t) => {
                     setTool(t);
                     // A ferramenta de bolhas só faz sentido com a camada visível.
                     if (t === 'bubble') setShow((s) => ({ ...s, bubbles: true }));
                     if (t === 'text' || t === 'line') setShow((s) => ({ ...s, elements: true }));
                   }}
                   anchorType={anchorType} setAnchorType={setAnchorType}
                   anchorArucoId={anchorArucoId} setAnchorArucoId={setAnchorArucoId}
                   onAddBlock={addBlock}
                   anchorCount={pageConfig.anchors.length}
                   onAddAnchor={addAnchor}
                   onAddImage={() => pickAsset(null)}
                   uploadingAsset={uploadingAsset}
                   anchorSize={anchorSize} setAnchorSize={setAnchorSize}
                   onDetectGrid={() => void detectGrid()} detecting={detecting}
                    onAutoConfigure={() => void autoConfigure()} autoBusy={autoBusy}
                    onDetectAnchors={() => void detectAnchors()} detectingAnchors={detectingAnchors}
                    onDetectPageCorners={() => void handleDetectPageCorners()} detectingPageCorners={detectingPageCorners}
                    onManualPageCorners={startManualPageCorners}
                    onRemovePageCorners={removePageCorners}
                    hasPageCorners={Array.isArray(config.page_corners) && config.page_corners.length === 4} />

          <div>
            <p className="label">Camadas</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LAYER_LABELS) as (keyof typeof LAYER_LABELS)[]).map((k) => (
                <button key={k} type="button"
                        className={`btn btn-sm ${show[k] ? 'btn-secondary' : 'btn-ghost opacity-60'}`}
                        aria-pressed={show[k]}
                        title={`${show[k] ? 'Ocultar' : 'Mostrar'} ${LAYER_LABELS[k].toLowerCase()}`}
                        onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>
                  {show[k] ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span className="text-[11px]">{LAYER_LABELS[k]}</span>
                </button>
              ))}
            </div>
          </div>

          <RegionalList config={pageConfig} selection={selection} setSelection={setSelection}
                        onDelete={(kind, id) => {
                          apply(removeRegion(configRef.current, kind, id));
                          setSelection(null);
                        }} />

          {/* Cópia de configuração: ação secundária, depois dos elementos. */}
          <div className="space-y-2 border-t border-line dark:border-gray-800 pt-3">
            <button type="button" onClick={() => void openCopy()}
                    className="btn btn-ghost btn-sm w-full justify-start">
              Copiar configuração de outro modelo
            </button>
            {copyOpen && (
              <div className="space-y-2 rounded border border-gray-200 dark:border-gray-700 p-2">
                <Select value={copyFromId ?? ''} onChange={(e) => setCopyFromId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Selecione o modelo...</option>
                  {copyCandidates.map((t) => (
                    <option key={t.id} value={t.id}>{t.nome} (v{t.version})</option>
                  ))}
                </Select>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void doCopy()} loading={copying} disabled={!copyFromId}>
                    Copiar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCopyOpen(false)}>Cancelar</Button>
                </div>
                {copyCandidates.length === 0 && (
                  <p className="text-xs text-gray-500">Nenhum outro modelo disponível.</p>
                )}
              </div>
            )}
          </div>
        </div>
    );

  return (
    <div className="flex min-h-0 flex-col animate-fade-in pb-24 lg:pb-0">
      <EditorTopBar
        title={detail.nome}
        statusLabel={STATUS_LABEL[status] ?? status}
        statusDetail={saving ? 'salvando…' : dirty ? 'alterações não salvas' : 'salvo'}
        pendingVersion={detail.pending_version}
        version={detail.version}
        saving={saving}
        dirty={dirty}
        onClose={onClose}
        onSave={() => void save()}
        onValidate={() => void runValidate()}
        onActivate={() => void activate()}
      />

      {/* Disparo dos painéis laterais em telas pequenas */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-1 flex shrink-0 flex-wrap gap-2 border-t border-line glass px-4 py-2 lg:hidden">
        <Button size="sm" variant="secondary" onClick={() => setMobilePanel('ferramentas')}>
          Ferramentas
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMobilePanel('propriedades')}>
          Propriedades
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMobilePanel('diagnostico')}>
          Diagnóstico{issues.length + warnings.length > 0 ? ` · ${issues.length + warnings.length}` : ''}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMobilePanel('acoes')}>
          Ações
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[250px_minmax(0,1fr)_320px] lg:overflow-hidden">
        {/* Painel esquerdo */}
        {renderLeftPanel(true)}

        {/* Área central */}
        <div className="card p-2 flex flex-col gap-2 h-[78vh] lg:h-full lg:min-h-0">
          <div className="flex items-center flex-wrap gap-2">
            <Button size="icon" variant="ghost" title="Reduzir zoom (ou Ctrl + roda do mouse)" onClick={() => { zoomManualRef.current = true; setZoom((z) => Math.max(0.1, z - 0.05)); }}><ZoomOut size={16} /></Button>
            {/* h-6 (24px): alvo mínimo de clique/toque. */}
            <input type="number" min={10} max={400} step={1} value={Math.round(zoom * 100)}
                   aria-label="Zoom em porcentagem"
                   onChange={(e) => {
                     const v = Number(e.target.value);
                     if (!Number.isFinite(v)) return;
                     zoomManualRef.current = true;
                     setZoom(Math.max(0.1, Math.min(4, v / 100)));
                   }}
                   className="text-xs w-12 h-6 text-center border border-gray-300 dark:border-gray-700 rounded px-1 bg-transparent" />
            <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
            <Button size="icon" variant="ghost" title="Ampliar zoom (ou Ctrl + roda do mouse)" onClick={() => { zoomManualRef.current = true; setZoom((z) => Math.min(4, z + 0.05)); }}><ZoomIn size={16} /></Button>
            <Button size="icon" variant="ghost" title="Ajustar à tela"
                    onClick={fitToScreen}><Maximize size={16} /></Button>
            <span className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1" />
            <Button size="icon" variant={showGrid ? 'secondary' : 'ghost'} title="Grade (1%)"
                    aria-pressed={showGrid} onClick={() => setShowGrid((v) => !v)}><Grid3x3 size={16} /></Button>
            <Button size="icon" variant={snapEnabled ? 'secondary' : 'ghost'} title="Encaixar na grade e nas guias"
                    aria-pressed={snapEnabled} onClick={() => setSnapEnabled((v) => !v)}><Magnet size={16} /></Button>
            <span className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1" />
            <Button size="icon" variant="ghost" title="Desfazer" disabled={!past.length} onClick={undo}><Undo2 size={16} /></Button>
            <Button size="icon" variant="ghost" title="Refazer" disabled={!future.length} onClick={redo}><Redo2 size={16} /></Button>
            {tool !== 'select' && (
              <span className="text-xs text-brand-600 dark:text-brand-300 ml-2 inline-flex items-center gap-1">
                <Crosshair size={13} />
                {tool === 'bubble'
                  ? 'Arraste uma bolha para ajustar o alinhamento'
                  : tool === 'place-block'
                    ? 'Clique para posicionar o bloco'
                    : tool === 'text'
                      ? 'Arraste para criar a caixa de texto'
                      : tool === 'line'
                        ? 'Arraste para desenhar a linha'
                        : 'Arraste para criar a região'}
              </span>
            )}
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1">
              <span className="mr-1 text-[11px] text-gray-500 dark:text-gray-400">
                {selected.length} selecionado{selected.length > 1 ? 's' : ''}
              </span>
              <Button size="icon" variant="ghost" title="Duplicar (Ctrl+D)" onClick={duplicateSelected}><Copy size={15} /></Button>
              <Button size="icon" variant="ghost" title="Excluir (Del)" onClick={deleteSelected}><Trash2 size={15} /></Button>
              <Button size="icon" variant={selected.every((s) => isLocked(config, s.kind, s.id)) ? 'secondary' : 'ghost'}
                      title={selected.every((s) => isLocked(config, s.kind, s.id)) ? 'Desbloquear' : 'Travar posição'}
                      onClick={toggleLock}><Lock size={15} /></Button>
              <span className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1" />
              <Button size="icon" variant="ghost" title="Alinhar à esquerda" disabled={selected.length < 2}
                      onClick={() => alignSelected('left')}><AlignStartVertical size={15} /></Button>
              <Button size="icon" variant="ghost" title="Centralizar horizontalmente" disabled={selected.length < 2}
                      onClick={() => alignSelected('hcenter')}><AlignCenterVertical size={15} /></Button>
              <Button size="icon" variant="ghost" title="Alinhar à direita" disabled={selected.length < 2}
                      onClick={() => alignSelected('right')}><AlignEndVertical size={15} /></Button>
              <Button size="icon" variant="ghost" title="Alinhar ao topo" disabled={selected.length < 2}
                      onClick={() => alignSelected('top')}><AlignStartHorizontal size={15} /></Button>
              <Button size="icon" variant="ghost" title="Centralizar verticalmente" disabled={selected.length < 2}
                      onClick={() => alignSelected('vcenter')}><AlignCenterHorizontal size={15} /></Button>
              <Button size="icon" variant="ghost" title="Alinhar embaixo" disabled={selected.length < 2}
                      onClick={() => alignSelected('bottom')}><AlignEndHorizontal size={15} /></Button>
              <span className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1" />
              <Button size="icon" variant="ghost" title="Distribuir horizontalmente" disabled={selected.length < 3}
                      onClick={() => distributeSelected('x')}><AlignHorizontalDistributeCenter size={15} /></Button>
              <Button size="icon" variant="ghost" title="Distribuir verticalmente" disabled={selected.length < 3}
                      onClick={() => distributeSelected('y')}><AlignVerticalDistributeCenter size={15} /></Button>
              <span className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1" />
              <Button size="icon" variant="ghost" title="Organizar (empilhar a partir da margem)"
                      disabled={!selected.length} onClick={organizeSelected}><LayoutTemplate size={15} /></Button>
              <Button size="icon" variant="ghost" title="Alinhar à margem da página (esquerda)"
                      disabled={!selected.length} onClick={() => alignToMarginSelected('left')}><Frame size={15} /></Button>
            </div>
          )}

          <div ref={canvasWrapRef}
               className="relative min-h-0 flex-1 overflow-auto rounded-lg bg-gray-200 dark:bg-gray-800"
               style={{
                 cursor: dragKind === 'pan' ? 'grabbing' : (tool === 'select' || tool === 'bubble') ? 'default' : 'crosshair',
                 userSelect: 'none',
               }}
               onPointerDown={(e) => {
                 if (!isPanGesture(e)) return;
                 e.preventDefault();
                 const el = canvasWrapRef.current;
                 dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: el?.scrollLeft ?? 0, origY: el?.scrollTop ?? 0 };
                 setDragKind('pan');
               }}
               onContextMenu={(e) => { if (e.shiftKey) e.preventDefault(); }}>
            {/* Área rolável: o cartão fica no fluxo (centralizado quando cabe) para
                o navegador criar as barras quando o zoom passa do visor. */}
            <div className="flex min-h-full min-w-full">
              <div className="relative m-auto shrink-0" style={{ width: baseW * zoom, height: baseH * zoom }}>
                {imgUrl ? (
                  <img src={imgUrl} alt="Cartão importado" draggable={false}
                       style={{ width: baseW * zoom, height: baseH * zoom, userSelect: 'none' }} />
                ) : (
                  <div style={{ width: baseW * zoom, height: baseH * zoom }} className="bg-white flex items-center justify-center text-gray-400">
                    <ImageIcon size={32} />
                  </div>
                )}
                <svg ref={svgRef} width={baseW * zoom} height={baseH * zoom} viewBox={`0 0 ${baseW} ${baseH}`}
                     className="absolute inset-0" style={{ touchAction: 'none' }}
                     onPointerDown={onSvgPointerDown} onClick={onSvgClick}>
                  <OverlayRegions
                    config={pageConfig} show={show} selection={selection} selected={selected}
                    zoom={zoom} tool={tool} grid={showGrid} guides={guides} assetUrls={assetUrls}
                    onSelect={setSelection} onStartDrag={startDragRegion} onStartResize={startResize}
                    onStartBubbleDrag={startBubbleDrag}
                    onStartPageCorner={startPageCornerDrag}
                  />
                  {creating && (
                    <rect
                      x={Math.min(creating.x0, creating.x1)}
                      y={Math.min(creating.y0, creating.y1)}
                      width={Math.abs(creating.x1 - creating.x0)}
                      height={Math.abs(creating.y1 - creating.y0)}
                      fill="rgba(37,99,235,0.15)" stroke="#2563eb" strokeDasharray="6 4" strokeWidth={2 / zoom} />
                  )}
                </svg>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Página {currentPage + 1} de {nPages} · Role para navegar ou use Alt+arrastar, botão do meio ou Shift+botão direito.
            {' '}{bubbles.length} bolha(s) configurada(s).
            {Array.isArray(config.page_corners) && config.page_corners.length === 4 && (
              <> Cantos da folha (roxo) ativos — arraste os 4 pontos para ajustar. Usados como destino
              do alinhamento quando o modelo não tem as 4 âncoras de canto.</>
            )}
          </p>
        </div>

        {/* Painel direito: uma aba por vez (propriedades, diagnóstico, ações). */}
        <div className="hidden lg:flex card flex lg:h-full lg:min-h-0 flex-col overflow-hidden">
          <Tabs
            ariaLabel="Painel do modelo"
            active={rightTab}
            onChange={(id) => setRightTab(id as typeof rightTab)}
            tabs={[
              { id: 'props', label: 'Propriedades' },
              { id: 'diag', label: 'Diagnóstico', badge: issues.length + warnings.length || undefined },
              { id: 'actions', label: 'Ações' },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto pt-3">
            {rightTab === 'props' && (
              <PropertiesPanel config={config} selection={selection} updateField={updateField}
                               onPickAsset={(id) => pickAsset(id)} />
            )}
            {rightTab === 'diag' && <ValidationPanel issues={issues} warnings={warnings} onGoTo={setSelection} />}
            {rightTab === 'actions' && <ActionsPanel detailId={detail.id} onRestore={apply} />}
          </div>
        </div>
      </div>

      <EditorMobilePanels
        open={mobilePanel !== null}
        onClose={() => setMobilePanel(null)}
        tab={mobilePanel ?? 'ferramentas'}
        onTab={setMobilePanel}
        issueCount={issues.length + warnings.length}
        tools={renderLeftPanel(false)}
        properties={(
          <PropertiesPanel config={config} selection={selection} updateField={updateField}
                           onPickAsset={(id) => pickAsset(id)} />
        )}
        diagnostics={<ValidationPanel issues={issues} warnings={warnings} onGoTo={setSelection} />}
        actions={<ActionsPanel detailId={detail.id} onRestore={apply} />}
      />

      <StatusBar
        pendings={issues.length + warnings.length} zoom={zoom} pageIdx={currentPage} nPages={nPages}
        baseW={baseW} baseH={baseH} onDiagnosticoClick={() => setMobilePanel('diagnostico')}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers puros de edição da configuração
// ───────────────────────────────────────────────────────────────────────────

function buildCreate(
  cfg: CustomConfig, region: 'anchor' | 'qr' | 'info' | 'text' | 'line' | 'idgrid', rect: Rect,
  anchorType: 'aruco' | 'quad', arucoId: number,
  anchorSize: number = 0.05,
  page: number = 0,
): { config: CustomConfig; selection: Selection } | null {
  if (region === 'qr') {
    const qr: CustomQr = {
      id: `qr_${rnd()}`, x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      required: false, purpose: 'card', field: 'codigo_unico',
    };
    return { config: { ...cfg, qr }, selection: { kind: 'qr', id: qr.id } };
  }
  if (region === 'info') {
    const info: CustomInfoRegion = { id: `info_${rnd()}`, kind: 'info', ...rect };
    return { config: { ...cfg, info_regions: [...cfg.info_regions, info] }, selection: { kind: 'info', id: info.id } };
  }
  if (region === 'text' || region === 'line') {
    const el: CustomElement = {
      id: `el_${rnd()}`, kind: region, page, ...rect,
      text: region === 'text' ? 'Texto' : '',
      font_size: 40, align: 'left', bold: false, asset: null,
    };
    return {
      config: { ...cfg, elements: [...(cfg.elements ?? []), el] },
      selection: { kind: 'element', id: el.id },
    };
  }
  if (region === 'idgrid') {
    const grid: CustomIdGrid = {
      id: `idg_${rnd()}`, page, ...rect,
      digits: 8, radius: 0.014, shape: 'circle',
    };
    return {
      config: { ...cfg, idgrids: [...(cfg.idgrids ?? []), grid] },
      selection: { kind: 'idgrid', id: grid.id },
    };
  }
  const size = anchorSize;
  const anchor: CustomAnchor = {
    id: `anc_${rnd()}`, type: anchorType, corner: null,
    aruco_id: anchorType === 'aruco' ? arucoId : null,
    page,
    x: rect.x + rect.w / 2, y: rect.y + rect.h / 2,
    size, tolerance: 0.15, required: true,
  };
  return { config: { ...cfg, anchors: [...cfg.anchors, anchor] }, selection: { kind: 'anchor', id: anchor.id } };
}

function isLocked(cfg: CustomConfig, kind: RegionType, id: string): boolean {
  if (kind === 'anchor') return !!cfg.anchors.find((a) => a.id === id)?.locked;
  if (kind === 'qr') return !!cfg.qr?.locked;
  if (kind === 'info') return !!cfg.info_regions.find((r) => r.id === id)?.locked;
  if (kind === 'block') return !!cfg.questions.find((b) => b.id === id)?.locked;
  if (kind === 'idgrid') return !!(cfg.idgrids ?? []).find((g) => g.id === id)?.locked;
  return !!(cfg.elements ?? []).find((e) => e.id === id)?.locked;
}

function removeRegion(cfg: CustomConfig, kind: RegionType, id: string): CustomConfig {
  if (kind === 'anchor') return { ...cfg, anchors: cfg.anchors.filter((a) => a.id !== id) };
  if (kind === 'qr') return { ...cfg, qr: null };
  if (kind === 'info') return { ...cfg, info_regions: cfg.info_regions.filter((r) => r.id !== id) };
  if (kind === 'element') return { ...cfg, elements: (cfg.elements ?? []).filter((e) => e.id !== id) };
  if (kind === 'idgrid') return { ...cfg, idgrids: (cfg.idgrids ?? []).filter((g) => g.id !== id) };
  return { ...cfg, questions: cfg.questions.filter((b) => b.id !== id) };
}

function rectOf(cfg: CustomConfig, kind: RegionType, id: string): Rect | null {
  if (kind === 'qr' && cfg.qr) return { x: cfg.qr.x, y: cfg.qr.y, w: cfg.qr.w, h: cfg.qr.h };
  if (kind === 'info') {
    const r = cfg.info_regions.find((x) => x.id === id);
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  }
  if (kind === 'element') {
    const e = (cfg.elements ?? []).find((x) => x.id === id);
    return e ? { x: e.x, y: e.y, w: e.w, h: e.h } : null;
  }
  if (kind === 'idgrid') {
    const g = (cfg.idgrids ?? []).find((x) => x.id === id);
    return g ? { x: g.x, y: g.y, w: g.w, h: g.h } : null;
  }
  if (kind === 'anchor') {
    const a = cfg.anchors.find((x) => x.id === id);
    return a ? { x: a.x - a.size / 2, y: a.y - a.size / 2, w: a.size, h: a.size } : null;
  }
  return null;
}

function setRect(cfg: CustomConfig, kind: Exclude<RegionType, 'block'>, id: string, rect: Rect): CustomConfig {
  if (kind === 'qr' && cfg.qr) return { ...cfg, qr: { ...cfg.qr, ...rect } };
  if (kind === 'info') {
    return { ...cfg, info_regions: cfg.info_regions.map((i) => (i.id === id ? { ...i, ...rect } : i)) };
  }
  if (kind === 'element') {
    return { ...cfg, elements: (cfg.elements ?? []).map((e) => (e.id === id ? { ...e, ...rect } : e)) };
  }
  if (kind === 'idgrid') {
    return { ...cfg, idgrids: (cfg.idgrids ?? []).map((g) => (g.id === id ? { ...g, ...rect } : g)) };
  }
  return {
    ...cfg,
    anchors: cfg.anchors.map((a) =>
      a.id === id ? { ...a, x: rect.x + a.size / 2, y: rect.y + a.size / 2 } : a),
  };
}

function setBlockStart(cfg: CustomConfig, id: string, x: number, y: number): CustomConfig {
  return {
    ...cfg,
    questions: cfg.questions.map((b) => (b.id === id ? moveBlockTo(b, x, y) : b)),
  };
}

/** Atualiza um canto da folha (0..3, ordem TL/TR/BR/BL). */
function setPageCorner(cfg: CustomConfig, index: number, x: number, y: number): CustomConfig {
  const base = cfg.page_corners && cfg.page_corners.length === 4
    ? cfg.page_corners.map((p) => ({ x: p.x, y: p.y }))
    : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  base[index] = { x, y };
  return { ...cfg, page_corners: base };
}

function resizeRect(orig: Rect, handle: string, nx: number, ny: number): Rect {
  let { x, y, w, h } = orig;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes('w')) { x = clamp(nx, 0, right - 0.005); w = right - x; }
  if (handle.includes('e')) { w = clamp(nx - x, 0.005, 1 - x); }
  if (handle.includes('n')) { y = clamp(ny, 0, bottom - 0.005); h = bottom - y; }
  if (handle.includes('s')) { h = clamp(ny - y, 0.005, 1 - y); }
  return { x, y, w, h };
}

// ───────────────────────────────────────────────────────────────────────────
// Ferramentas
// ───────────────────────────────────────────────────────────────────────────

function Toolbar({
  tool, setTool, anchorType, setAnchorType, anchorArucoId, setAnchorArucoId, anchorSize, setAnchorSize,
  anchorCount, onAddAnchor, onAddImage, uploadingAsset,
  onAddBlock, onDetectGrid, onAutoConfigure, autoBusy,
  onDetectAnchors, onDetectPageCorners, onManualPageCorners, onRemovePageCorners,
  detecting, detectingAnchors, detectingPageCorners, hasPageCorners,
}: {
  tool: Tool; setTool: (t: Tool) => void;
  anchorType: 'aruco' | 'quad'; setAnchorType: (t: 'aruco' | 'quad') => void;
  anchorArucoId: number; setAnchorArucoId: (n: number) => void;
  anchorSize: number; setAnchorSize: (n: number) => void;
  anchorCount: number;
  onAddAnchor: () => void;
  onAddImage: () => void;
  uploadingAsset: boolean;
  onAddBlock: () => void;
  onDetectGrid: () => void;
  onAutoConfigure: () => void;
  autoBusy: boolean;
  onDetectAnchors: () => void;
  onDetectPageCorners: () => void;
  onManualPageCorners: () => void;
  onRemovePageCorners: () => void;
  detecting: boolean;
  detectingAnchors: boolean;
  detectingPageCorners: boolean;
  hasPageCorners: boolean;
}) {
  const tools: { id: Tool; label: string; icon: typeof PenSquare }[] = [
    { id: 'select', label: 'Selecionar', icon: Crosshair },
    { id: 'anchor', label: 'Âncora', icon: Square },
    { id: 'qr', label: 'QR Code', icon: QrCode },
    { id: 'info', label: 'Info', icon: Info },
    { id: 'text', label: 'Texto', icon: Type },
    { id: 'line', label: 'Linha', icon: Minus },
    { id: 'idgrid', label: 'ID do aluno', icon: Hash },
    { id: 'bubble', label: 'Ajustar bolhas', icon: Move },
  ];
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="label">Ferramentas</p>
        <div className="grid grid-cols-2 gap-2">
          {tools.map((t) => (
            <button key={t.id} type="button" onClick={() => setTool(t.id)}
                    aria-pressed={tool === t.id}
                    title={t.id === 'bubble' ? 'Arraste uma bolha no cartão para corrigir o alinhamento individual' : undefined}
                    className={`btn btn-sm min-h-[40px] justify-start ${t.id === 'bubble' ? 'col-span-2' : ''} ${tool === t.id ? 'btn-primary' : 'btn-secondary'}`}>
              <t.icon size={15} aria-hidden /> {t.label}
            </button>
          ))}
          <button type="button" onClick={onAddBlock}
                  aria-pressed={tool === 'place-block'}
                  className={`btn btn-sm min-h-[40px] justify-start col-span-2 ${tool === 'place-block' ? 'btn-primary' : 'btn-secondary'}`}>
            <Boxes size={15} aria-hidden /> Bloco de questões
          </button>
          <button type="button" onClick={onAddImage} disabled={uploadingAsset}
                  title="Envia uma logo/imagem e adiciona ao cartão (só na impressão)"
                  className="btn btn-secondary btn-sm min-h-[40px] justify-start col-span-2">
            <ImagePlus size={15} aria-hidden /> {uploadingAsset ? 'Enviando…' : 'Imagem / logo'}
          </button>
        </div>
      </div>

      {(tool === 'anchor' || anchorCount === 0) && (
        <div className="space-y-2 rounded border border-gray-200 dark:border-gray-800 p-2">
          {anchorCount === 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Nenhuma âncora neste cartão. Adicione ou use “Detectar âncoras”.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tipo" htmlFor="anc-type">
              <Select id="anc-type" value={anchorType} onChange={(e) => setAnchorType(e.target.value as 'aruco' | 'quad')}>
                <option value="quad">Quadrado</option>
                <option value="aruco">ArUco</option>
              </Select>
            </Field>
            {anchorType === 'aruco' && (
              <Field label="ID ArUco" htmlFor="anc-id">
                <Input id="anc-id" type="number" min={0} value={anchorArucoId}
                       onChange={(e) => setAnchorArucoId(Number(e.target.value))} />
              </Field>
            )}
            <Field label="Tamanho (%)" htmlFor="anc-size">
              <Input id="anc-size" type="number" min={1} max={20} step={0.5}
                     value={Math.round(anchorSize * 100)}
                     onChange={(e) => {
                       const v = Number(e.target.value);
                       if (!Number.isFinite(v)) return;
                       setAnchorSize(Math.max(0.01, Math.min(0.2, v / 100)));
                     }} />
            </Field>
          </div>
          <button type="button" onClick={onAddAnchor}
                  title="Adiciona uma âncora no próximo canto livre. Clique nela no cartão para editar tipo e tamanho."
                  className="btn btn-secondary btn-sm w-full justify-start">
            <Plus size={14} aria-hidden /> Adicionar no próximo canto livre
          </button>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Ou desenhe com a ferramenta Âncora. Clique numa âncora para editar.
          </p>
        </div>
      )}

      <div className="space-y-2 border-t border-line dark:border-gray-800 pt-3">
        <p className="label">Detectar automaticamente</p>
        <button type="button" onClick={onAutoConfigure} disabled={autoBusy}
                title="Detecta âncoras, cantos da folha e a grade desta página de uma vez (substitui âncoras e blocos desta página — dá para desfazer)"
                className="btn btn-primary btn-sm min-h-[40px] w-full justify-start">
          <Wand2 size={15} aria-hidden /> {autoBusy ? 'Configurando…' : 'Configurar automaticamente'}
        </button>
        <button type="button" onClick={onDetectGrid} disabled={detecting}
                title="Analisa a imagem importada e sugere os blocos de questões automaticamente"
                className="btn btn-secondary btn-sm min-h-[40px] w-full justify-start">
          <ScanSearch size={15} aria-hidden /> {detecting ? 'Detectando…' : 'Detectar grade'}
        </button>
        <button type="button" onClick={onDetectAnchors} disabled={detectingAnchors}
                title="Detecta e centraliza automaticamente as 4 âncoras de canto da imagem importada"
                className="btn btn-secondary btn-sm min-h-[40px] w-full justify-start">
          <Crosshair size={15} aria-hidden /> {detectingAnchors ? 'Detectando…' : 'Detectar âncoras'}
        </button>
        <details className="rounded border border-gray-200 dark:border-gray-800">
          <summary className="cursor-pointer select-none px-2 py-2 text-sm font-medium">
            Cantos da folha
          </summary>
          <div className="space-y-2 border-t border-gray-200 p-2 dark:border-gray-800">
            <button type="button" onClick={onDetectPageCorners} disabled={detectingPageCorners}
                    title="Detecta os 4 cantos da folha (marcadores de canto ou maior quadrilátero)"
                    className="btn btn-secondary btn-sm min-h-[40px] w-full justify-start">
              <Maximize size={15} aria-hidden /> {detectingPageCorners ? 'Detectando…' : 'Detectar cantos'}
            </button>
            <button type="button" onClick={onManualPageCorners}
                    title="Cria os 4 cantos da folha para ajuste manual (arraste os pontos no cartão)"
                    className="btn btn-secondary btn-sm min-h-[40px] w-full justify-start">
              <Move size={15} aria-hidden /> Ajustar manualmente
            </button>
            {hasPageCorners && (
              <button type="button" onClick={onRemovePageCorners}
                      title="Remove os cantos da folha do modelo"
                      className="btn btn-ghost btn-sm min-h-[40px] w-full justify-start text-red-600 dark:text-red-400">
                <Trash2 size={15} aria-hidden /> Remover cantos
              </button>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Overlay SVG
// ───────────────────────────────────────────────────────────────────────────

function OverlayRegions({
  config, show, selection, selected, zoom, tool, grid, guides, assetUrls,
  onSelect, onStartDrag, onStartResize, onStartBubbleDrag, onStartPageCorner,
}: {
  config: CustomConfig;
  show: { anchors: boolean; qr: boolean; info: boolean; bubbles: boolean; elements: boolean };
  selection: Selection;
  selected: Selected[];
  zoom: number;
  tool: Tool;
  grid: boolean;
  guides: { x: number[]; y: number[] };
  assetUrls: Record<string, string>;
  onSelect: (s: Selection, additive?: boolean) => void;
  onStartDrag: (e: ReactPointerEvent<SVGElement>, kind: RegionType, id: string) => void;
  onStartResize: (e: ReactPointerEvent<SVGElement>, kind: Exclude<RegionType, 'block'>, id: string, handle: string, orig: Rect) => void;
  onStartBubbleDrag: (e: ReactPointerEvent<SVGElement>, blockId: string, question: number, option: string, x: number, y: number) => void;
  onStartPageCorner: (e: ReactPointerEvent<SVGElement>, index: number) => void;
}) {
  const pw = config.page_w || 1;
  const ph = config.page_h || 1;
  const isSel = (kind: RegionType, id: string) =>
    selected.some((s) => s.kind === kind && s.id === id);
  const isPrimary = (kind: RegionType, id: string) =>
    selection?.kind === kind && selection?.id === id;
  const stroke = 2 / zoom;

  const pageCorners = config.page_corners && config.page_corners.length === 4
    ? config.page_corners
    : null;

  const handlesFor = (kind: Exclude<RegionType, 'block'>, id: string, rect: Rect) => {
    const hs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const size = 10 / zoom;
    return hs.map((h) => {
      const cx = (h.includes('w') ? rect.x : h.includes('e') ? rect.x + rect.w : rect.x + rect.w / 2) * pw;
      const cy = (h.includes('n') ? rect.y : h.includes('s') ? rect.y + rect.h : rect.y + rect.h / 2) * ph;
      return (
        <rect key={h} x={cx - size / 2} y={cy - size / 2} width={size} height={size}
              fill="#fff" stroke="#2563eb" strokeWidth={1.5 / zoom}
              style={{ cursor: `${h}-resize` }}
              onPointerDown={(e) => onStartResize(e, kind, id, h, rect)} />
      );
    });
  };

  return (
    <g>
      <defs>
        <pattern id="editor-grid" width={pw / 100} height={ph / 100} patternUnits="userSpaceOnUse">
          <path d={`M ${pw / 100} 0 L 0 0 0 ${ph / 100}`} fill="none"
                stroke="rgba(99,102,241,0.28)" strokeWidth={1 / zoom} />
        </pattern>
      </defs>
      {grid && (
        <rect x={0} y={0} width={pw} height={ph} fill="url(#editor-grid)" pointerEvents="none" />
      )}
      {show.anchors && config.anchors.map((a) => {
        const r: Rect = { x: a.x - a.size / 2, y: a.y - a.size / 2, w: a.size, h: a.size };
        return (
          <g key={a.id} onPointerDown={(e) => onStartDrag(e, 'anchor', a.id)} style={{ cursor: 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth={isSel('anchor', a.id) ? stroke * 1.6 : stroke} />
            <text x={r.x * pw} y={r.y * ph - 3 / zoom} fontSize={11 / zoom} fill="#b45309">
              {a.type}{a.type === 'aruco' ? ` #${a.aruco_id ?? '?'}` : ''}{a.corner ? ` ${a.corner}` : ''}
            </text>
            {isPrimary('anchor', a.id) && handlesFor('anchor', a.id, r)}
          </g>
        );
      })}

      {show.qr && config.qr && (() => {
        const q = config.qr;
        const r: Rect = { x: q.x, y: q.y, w: q.w, h: q.h };
        return (
          <g onPointerDown={(e) => onStartDrag(e, 'qr', q.id)} style={{ cursor: 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill="rgba(37,99,235,0.12)" stroke="#2563eb" strokeWidth={isSel('qr', q.id) ? stroke * 1.6 : stroke} />
            <text x={r.x * pw} y={r.y * ph - 3 / zoom} fontSize={11 / zoom} fill="#1d4ed8">QR</text>
            {isPrimary('qr', q.id) && handlesFor('qr', q.id, r)}
          </g>
        );
      })()}

      {show.info && config.info_regions.map((i) => {
        const r: Rect = { x: i.x, y: i.y, w: i.w, h: i.h };
        return (
          <g key={i.id} onPointerDown={(e) => onStartDrag(e, 'info', i.id)} style={{ cursor: 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill="rgba(16,185,129,0.12)" stroke="#10b981" strokeWidth={isSel('info', i.id) ? stroke * 1.6 : stroke} />
            <text x={r.x * pw} y={r.y * ph - 3 / zoom} fontSize={11 / zoom} fill="#047857">{i.kind}</text>
            {isPrimary('info', i.id) && handlesFor('info', i.id, r)}
          </g>
        );
      })}

      {(config.idgrids ?? []).map((g) => {
        const r: Rect = { x: g.x, y: g.y, w: g.w, h: g.h };
        const rPx = (g.radius || 0.014) * ph;
        return (
          <g key={g.id} onPointerDown={(e) => onStartDrag(e, 'idgrid', g.id)}
             style={{ cursor: g.locked ? 'not-allowed' : 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill="rgba(99,102,241,0.08)" stroke="#6366f1"
                  strokeWidth={isSel('idgrid', g.id) ? stroke * 1.6 : stroke}
                  strokeDasharray="4 2" />
            {idGridBubbles(g).map((b) => (
              <circle key={`${b.digit}-${b.value}`} cx={b.x * pw} cy={b.y * ph} r={rPx}
                      fill="none" stroke="#4f46e5" strokeWidth={1.2 / zoom} pointerEvents="none" />
            ))}
            <text x={r.x * pw} y={r.y * ph - 3 / zoom} fontSize={11 / zoom} fill="#4338ca"
                  pointerEvents="none">ID · {g.digits} dígitos</text>
            {isPrimary('idgrid', g.id) && handlesFor('idgrid', g.id, r)}
          </g>
        );
      })}

      {show.elements && (config.elements ?? []).map((el) => {
        const r: Rect = { x: el.x, y: el.y, w: el.w, h: el.h };
        const tx = el.align === 'center' ? (r.x + r.w / 2) * pw
          : el.align === 'right' ? (r.x + r.w) * pw : r.x * pw;
        const url = el.asset ? assetUrls[el.asset] : undefined;
        return (
          <g key={el.id} onPointerDown={(e) => onStartDrag(e, 'element', el.id)}
             style={{ cursor: el.locked ? 'not-allowed' : 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill={el.kind === 'line' ? 'rgba(17,24,39,0.85)' : 'rgba(14,165,233,0.08)'}
                  stroke={isSel('element', el.id) ? '#0284c7' : '#0ea5e9'}
                  strokeWidth={isSel('element', el.id) ? stroke * 1.6 : stroke}
                  strokeDasharray={el.kind === 'line' ? undefined : '4 2'} />
            {el.kind === 'text' && (
              <text x={tx} y={r.y * ph + el.font_size} fontSize={el.font_size}
                    fontWeight={el.bold ? 700 : 400} fill="#000" pointerEvents="none"
                    textAnchor={el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start'}>
                {el.text}
              </text>
            )}
            {el.kind === 'image' && url && (
              <image href={url} x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                     preserveAspectRatio="xMidYMid meet" pointerEvents="none" />
            )}
            {el.kind === 'image' && !url && (
              <text x={(r.x + r.w / 2) * pw} y={(r.y + r.h / 2) * ph} fontSize={11 / zoom}
                    fill="#0284c7" textAnchor="middle" pointerEvents="none">imagem</text>
            )}
            {isPrimary('element', el.id) && handlesFor('element', el.id, r)}
          </g>
        );
      })}

      {show.bubbles && config.questions.map((b) => {
        const bl = expandBlock(b);
        if (!bl.length) return null;
        const xs = bl.map((x) => x.x);
        const ys = bl.map((x) => x.y);
        // Raio em px consistente com o backend/overlay: r * MAIOR lado.
        const rPx = Math.max(1.5, b.radius * Math.max(pw, ph));
        const rx = rPx / pw;
        const ry = rPx / ph;
        const bx = Math.min(...xs) - rx;
        const by = Math.min(...ys) - ry;
        const bw = Math.max(...xs) + rx - bx;
        const bh = Math.max(...ys) + ry - by;
        const nOverrides = Object.values(b.overrides ?? {})
          .reduce((n, opts) => n + Object.keys(opts).length, 0);
        return (
          <g key={b.id}>
            <rect x={bx * pw} y={by * ph} width={bw * pw} height={bh * ph}
                  fill="rgba(239,68,68,0.06)"
                  stroke={isSel('block', b.id) ? '#dc2626' : '#ef4444'}
                  strokeWidth={isSel('block', b.id) ? stroke * 1.6 : stroke}
                  strokeDasharray="5 3"
                  style={{ cursor: tool === 'bubble' ? 'default' : 'move', pointerEvents: tool === 'bubble' ? 'none' : 'all' }}
                  onPointerDown={tool === 'bubble' ? undefined : (e) => {
                    // Botão direito (com Shift), botão do meio ou Alt+arrastar
                    // são pan: deixe o evento chegar ao contêiner do editor.
                    if (e.button !== 0 || e.altKey) return;
                    e.stopPropagation();
                    onSelect({ kind: 'block', id: b.id });
                    onStartDrag(e, 'block', b.id);
                  }} />
            {bl.map((x, k) => {
              const overridden = !!b.overrides?.[String(x.question)]?.[x.option];
              return (
                <g key={k}>
                  <circle cx={x.x * pw} cy={x.y * ph} r={rPx}
                          fill="none" stroke={overridden ? '#f59e0b' : '#ef4444'}
                          strokeWidth={(overridden ? 1.8 : 1.2) / zoom} pointerEvents="none" />
                  {tool === 'bubble' && (
                    <circle cx={x.x * pw} cy={x.y * ph} r={Math.max(rPx * 1.4, 6 / zoom)}
                            fill="transparent" stroke="none" style={{ cursor: 'grab' }}
                            onPointerDown={(e) => onStartBubbleDrag(e, b.id, x.question, x.option, x.x, x.y)} />
                  )}
                </g>
              );
            })}
            {isSel('block', b.id) && (
              <text x={bx * pw} y={by * ph - 4 / zoom} fontSize={12 / zoom} fill="#b91c1c"
                    pointerEvents="none">
                Q{b.start_question}–Q{b.start_question + b.n_questions - 1}
                {nOverrides ? ` · ${nOverrides} ajuste${nOverrides > 1 ? 's' : ''}` : ''}
              </text>
            )}
          </g>
        );
      })}

      {guides.x.map((x, i) => (
        <line key={`gx${i}`} x1={x * pw} y1={0} x2={x * pw} y2={ph} stroke="#ec4899"
              strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} pointerEvents="none" />
      ))}
      {guides.y.map((y, i) => (
        <line key={`gy${i}`} x1={0} y1={y * ph} x2={pw} y2={y * ph} stroke="#ec4899"
              strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} pointerEvents="none" />
      ))}

      {/* Cantos da folha por ÚLTIMO: os handles precisam ficar acima das
          âncoras/blocos, senão ficam inalcançáveis onde as regiões se
          sobrepõem (o pointerdown iria para a região de baixo). */}
      {pageCorners && (
        <g>
          <polygon
            points={pageCorners.map((p) => `${p.x * pw},${p.y * ph}`).join(' ')}
            fill="rgba(168,85,247,0.10)" stroke="#a855f7" strokeWidth={stroke}
            strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            style={{ cursor: 'move', pointerEvents: 'none' }} />
          {(['TL', 'TR', 'BR', 'BL'] as const).map((c, i) => {
            const p = pageCorners[i];
            const r = 6 / zoom;
            return (
              <g key={c}>
                <circle cx={p.x * pw} cy={p.y * ph} r={r}
                        fill="#a855f7" stroke="#fff" strokeWidth={1.5 / zoom}
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => onStartPageCorner(e, i)} />
                <text x={p.x * pw + r + 2 / zoom} y={p.y * ph + 4 / zoom}
                      fontSize={10 / zoom} fill="#7e22ce"
                      style={{ pointerEvents: 'none' }}>{c}</text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Lista lateral de elementos
// ───────────────────────────────────────────────────────────────────────────

function RegionalList({
  config, selection, setSelection, onDelete,
}: {
  config: CustomConfig;
  selection: Selection;
  setSelection: (s: Selection) => void;
  onDelete: (kind: RegionType, id: string) => void;
}) {
  const Item = ({ kind, id, label, color }: { kind: RegionType; id: string; label: string; color: string }) => (
    <div className={`flex items-center gap-2 rounded px-2 py-1 text-sm min-h-[28px] ${selection?.kind === kind && selection?.id === id ? 'bg-gray-100 dark:bg-gray-800' : ''}`}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <button type="button" className="flex-1 min-h-[24px] text-left truncate"
              onClick={() => setSelection({ kind, id })}>{label}</button>
      {/* 24×24 é o alvo mínimo (WCAG 2.5.8): o ícone fica menor, a área de
          clique não. Um botão de 14×14 é impossível de acertar com o dedo. */}
      <button type="button" className="grid place-items-center h-6 w-6 -mr-1 shrink-0 text-gray-400 hover:text-red-500"
              title="Excluir" onClick={() => onDelete(kind, id)}><Trash2 size={15} /></button>
    </div>
  );
  const empty = !config.anchors.length && !config.qr && !config.info_regions.length
    && !config.questions.length && !(config.idgrids ?? []).length
    && !(config.elements ?? []).length;
  const Group = ({ title, children }: { title: string; children: ReactNode }) => (
    <section className="space-y-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{title}</p>
      {children}
    </section>
  );
  return (
    <div className="space-y-2">
      <p className="label">Elementos</p>
      {empty && <p className="text-xs text-gray-400">Nada configurado ainda.</p>}
      {config.anchors.length > 0 && (
        <Group title={`Âncoras (${config.anchors.length})`}>
          {config.anchors.map((a) => (
            <Item key={a.id} kind="anchor" id={a.id} color="#f59e0b"
                  label={`Âncora ${a.type}${a.type === 'aruco' && a.aruco_id != null ? ` #${a.aruco_id}` : ''}`} />
          ))}
        </Group>
      )}
      {config.qr && (
        <Group title="QR Code">
          <Item kind="qr" id={config.qr.id} color="#2563eb" label="QR Code" />
        </Group>
      )}
      {config.info_regions.length > 0 && (
        <Group title={`Regiões informativas (${config.info_regions.length})`}>
          {config.info_regions.map((i) => (
            <Item key={i.id} kind="info" id={i.id} color="#10b981" label={`Info · ${i.kind}`} />
          ))}
        </Group>
      )}
      {config.questions.length > 0 && (
        <Group title={`Blocos de questões (${config.questions.length})`}>
          {config.questions.map((b) => (
            <Item key={b.id} kind="block" id={b.id} color="#ef4444"
                  label={`Q${b.start_question}–Q${b.start_question + b.n_questions - 1} (${b.n_questions}×${b.labels.length})`} />
          ))}
        </Group>
      )}
      {(config.idgrids ?? []).length > 0 && (
        <Group title={`Matrícula (${(config.idgrids ?? []).length})`}>
          {(config.idgrids ?? []).map((g) => (
            <Item key={g.id} kind="idgrid" id={g.id} color="#6366f1"
                  label={`ID · ${g.digits} dígitos`} />
          ))}
        </Group>
      )}
      {(config.elements ?? []).length > 0 && (
        <Group title={`Elementos (${(config.elements ?? []).length})`}>
          {(config.elements ?? []).map((e) => (
            <Item key={e.id} kind="element" id={e.id} color="#0ea5e9"
                  label={e.kind === 'text' ? (e.text.trim() || 'Texto') : e.kind === 'line' ? 'Linha' : 'Imagem'} />
          ))}
        </Group>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Propriedades
// ───────────────────────────────────────────────────────────────────────────

function PctInput({ label, value, onChange, id }: { label: string; value: number; onChange: (v: number) => void; id: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="number" step={0.01} value={Number((value * 100).toFixed(3))}
             onChange={(e) => onChange(Number(e.target.value) / 100)} />
    </Field>
  );
}

function PropertiesPanel({
  config, selection, updateField, onPickAsset,
}: {
  config: CustomConfig;
  selection: Selection;
  updateField: (patch: Partial<CustomConfig>) => void;
  onPickAsset: (id: string) => void;
}) {
  if (!selection) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Selecione uma região no cartão para editar as propriedades.</p>;
  }
  const { kind, id } = selection;

  if (kind === 'idgrid') {
    const g = (config.idgrids ?? []).find((x) => x.id === id);
    if (!g) return null;
    const upd = (patch: Partial<CustomIdGrid>) =>
      updateField({ idgrids: (config.idgrids ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    return (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Matrícula · {g.digits} dígitos</p>
        <div className="grid grid-cols-2 gap-2">
          <PctInput id="p-idg-x" label="X (%)" value={g.x} onChange={(v) => upd({ x: v })} />
          <PctInput id="p-idg-y" label="Y (%)" value={g.y} onChange={(v) => upd({ y: v })} />
          <PctInput id="p-idg-w" label="Largura (%)" value={g.w} onChange={(v) => upd({ w: v })} />
          <PctInput id="p-idg-h" label="Altura (%)" value={g.h} onChange={(v) => upd({ h: v })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Dígitos" htmlFor="p-idg-digits">
            <Input id="p-idg-digits" type="number" min={1} max={14} step={1} value={g.digits}
                   onChange={(e) => upd({ digits: Math.max(1, Math.min(14, Number(e.target.value) || 8)) })} />
          </Field>
          <Field label="Formato" htmlFor="p-idg-shape">
            <Select id="p-idg-shape" value={g.shape}
                    onChange={(e) => upd({ shape: e.target.value as 'circle' | 'square' })}>
              <option value="circle">Círculo</option>
              <option value="square">Quadrado</option>
            </Select>
          </Field>
        </div>
        <Field label="Tamanho da bolha (%)" htmlFor="p-idg-r"
               helper="Fração da altura da página (o mesmo dos blocos de questões).">
          <Input id="p-idg-r" type="number" step={0.001} min={0.004} max={0.06}
                 value={Number((g.radius * 100).toFixed(3))}
                 onChange={(e) => {
                   const pct = Number(e.target.value);
                   upd({ radius: pct > 0 ? Math.max(0.004, Math.min(0.06, pct / 100)) : 0.014 });
                 }} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!g.locked} onChange={(e) => upd({ locked: e.target.checked })} />
          Travar posição
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Cada coluna é um dígito; as 10 bolhas de 0 a 9 são lidas de cima para
          baixo. A leitura só devolve a matrícula quando <b>todos</b> os dígitos
          estão marcados sem ambiguidade.
        </p>
      </div>
    );
  }

  if (kind === 'anchor') {
    const a = config.anchors.find((x) => x.id === id);
    if (!a) return null;
    const upd = (patch: Partial<CustomAnchor>) =>
      updateField({ anchors: config.anchors.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    return (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Âncora</p>
        <Field label="Tipo" htmlFor="p-anc-type">
          <Select id="p-anc-type" value={a.type} onChange={(e) => {
            const type = e.target.value as 'aruco' | 'quad';
            upd(type === 'aruco'
              ? { type, aruco_id: a.aruco_id ?? nextArucoId(config.anchors, a.page ?? 0, 0) }
              : { type, aruco_id: null });
          }}>
            <option value="quad">Quadrado</option>
            <option value="aruco">ArUco</option>
          </Select>
        </Field>
        {a.type === 'aruco' && (
          <Field label="ID ArUco" htmlFor="p-anc-id">
            <Input id="p-anc-id" type="number" value={a.aruco_id ?? 0}
                   onChange={(e) => upd({ aruco_id: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Canto" htmlFor="p-anc-corner">
          <Select id="p-anc-corner" value={a.corner ?? ''}
                  onChange={(e) => upd({ corner: (e.target.value || null) as CustomAnchor['corner'] })}>
            <option value="">Automático</option>
            <option value="TL">Superior esquerdo</option>
            <option value="TR">Superior direito</option>
            <option value="BR">Inferior direito</option>
            <option value="BL">Inferior esquerdo</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <PctInput id="p-anc-x" label="X (%)" value={a.x} onChange={(v) => upd({ x: v })} />
          <PctInput id="p-anc-y" label="Y (%)" value={a.y} onChange={(v) => upd({ y: v })} />
          <PctInput id="p-anc-size" label="Tamanho (%)" value={a.size} onChange={(v) => upd({ size: v })} />
          <PctInput id="p-anc-tol" label="Tolerância (%)" value={a.tolerance} onChange={(v) => upd({ tolerance: v })} />
        </div>
      </div>
    );
  }

  if (kind === 'qr' && config.qr) {
    const q = config.qr;
    const upd = (patch: Partial<CustomQr>) => updateField({ qr: { ...q, ...patch } });
    return (
      <div className="space-y-2">
        <p className="font-semibold text-sm">QR Code</p>
        <div className="grid grid-cols-2 gap-2">
          <PctInput id="p-qr-x" label="X (%)" value={q.x} onChange={(v) => upd({ x: v })} />
          <PctInput id="p-qr-y" label="Y (%)" value={q.y} onChange={(v) => upd({ y: v })} />
          <PctInput id="p-qr-w" label="Largura (%)" value={q.w} onChange={(v) => upd({ w: v })} />
          <PctInput id="p-qr-h" label="Altura (%)" value={q.h} onChange={(v) => upd({ h: v })} />
        </div>
        <Field label="Finalidade" htmlFor="p-qr-purpose">
          <Select id="p-qr-purpose" value={q.purpose} onChange={(e) => upd({ purpose: e.target.value })}>
            <option value="card">Identificar o cartão</option>
            <option value="student">Identificar o aluno</option>
            <option value="exam">Identificar a prova</option>
          </Select>
        </Field>
      </div>
    );
  }

  if (kind === 'info') {
    const i = config.info_regions.find((x) => x.id === id);
    if (!i) return null;
    const upd = (patch: Partial<CustomInfoRegion>) =>
      updateField({ info_regions: config.info_regions.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    const pf = config.print_fields.find((f) => f.region_id === id);
    const setPrintField = (source: string, align?: CustomPrintField['align'], fontSize?: number) => {
      const others = config.print_fields.filter((f) => f.region_id !== id);
      updateField({
        print_fields: source
          ? [{
              region_id: id,
              source,
              font_size: fontSize ?? pf?.font_size ?? 30,
              align: align ?? pf?.align ?? 'left',
            }, ...others]
          : others,
      });
    };
    return (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Região informativa</p>
        <div className="grid grid-cols-2 gap-2">
          <PctInput id="p-info-x" label="X (%)" value={i.x} onChange={(v) => upd({ x: v })} />
          <PctInput id="p-info-y" label="Y (%)" value={i.y} onChange={(v) => upd({ y: v })} />
          <PctInput id="p-info-w" label="Largura (%)" value={i.w} onChange={(v) => upd({ w: v })} />
          <PctInput id="p-info-h" label="Altura (%)" value={i.h} onChange={(v) => upd({ h: v })} />
        </div>
        <Field label="Campo impresso" htmlFor="p-info-src" helper="Vincule esta região a um dado do sistema.">
          <Select id="p-info-src" value={pf?.source ?? ''} onChange={(e) => setPrintField(e.target.value)}>
            <option value="">Não imprimir</option>
            {PRINT_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        {pf && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fonte (px)" htmlFor="p-info-fs" helper="Altura da letra na imagem do modelo.">
              <Input id="p-info-fs" type="number" min={6} max={400} value={pf.font_size}
                     onChange={(e) => setPrintField(pf.source, undefined, clamp(Number(e.target.value) || 6, 6, 400))} />
            </Field>
            <Field label="Alinhamento" htmlFor="p-info-align">
              <Select id="p-info-align" value={pf.align}
                      onChange={(e) => setPrintField(pf.source, e.target.value as CustomPrintField['align'])}>
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
              </Select>
            </Field>
          </div>
        )}
      </div>
    );
  }

  if (kind === 'element') {
    const el = (config.elements ?? []).find((x) => x.id === id);
    if (!el) return null;
    const upd = (patch: Partial<CustomElement>) =>
      updateField({ elements: (config.elements ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    return (
      <div className="space-y-2">
        <p className="font-semibold text-sm">
          Elemento · {el.kind === 'text' ? 'texto' : el.kind === 'line' ? 'linha' : 'imagem'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <PctInput id="p-el-x" label="X (%)" value={el.x} onChange={(v) => upd({ x: v })} />
          <PctInput id="p-el-y" label="Y (%)" value={el.y} onChange={(v) => upd({ y: v })} />
          <PctInput id="p-el-w" label="Largura (%)" value={el.w} onChange={(v) => upd({ w: v })} />
          <PctInput id="p-el-h" label="Altura (%)" value={el.h} onChange={(v) => upd({ h: v })} />
        </div>
        {el.kind === 'text' && (
          <>
            <Field label="Texto" htmlFor="p-el-text" helper="Sai na impressão; a leitura OMR ignora. Use {{nome}} para o nome do aluno no lote.">
              <textarea id="p-el-text" className="input" rows={2} maxLength={300}
                        value={el.text} onChange={(e) => upd({ text: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Fonte (px)" htmlFor="p-el-fs">
                <Input id="p-el-fs" type="number" min={6} max={400} value={el.font_size}
                       onChange={(e) => upd({ font_size: clamp(Number(e.target.value) || 6, 6, 400) })} />
              </Field>
              <Field label="Alinhamento" htmlFor="p-el-align">
                <Select id="p-el-align" value={el.align}
                        onChange={(e) => upd({ align: e.target.value as CustomElement['align'] })}>
                  <option value="left">Esquerda</option>
                  <option value="center">Centro</option>
                  <option value="right">Direita</option>
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={el.bold ? 'primary' : 'secondary'} onClick={() => upd({ bold: !el.bold })}
                      icon={<Bold size={14} aria-hidden />}>Negrito</Button>
            </div>
          </>
        )}
        {el.kind === 'image' && (
          <Button size="sm" variant="secondary" icon={<ImagePlus size={14} aria-hidden />}
                  onClick={() => onPickAsset(el.id)}>Trocar imagem</Button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!el.locked} onChange={(e) => upd({ locked: e.target.checked })} />
          Travar posição
        </label>
      </div>
    );
  }

  const b = config.questions.find((x) => x.id === id);
  if (!b) return null;
  const upd = (patch: Partial<CustomBlock>) =>
    updateField({ questions: config.questions.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const updLabels = (raw: string) => {
    const labels = raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    upd({ labels: labels.length ? labels : ['A'] });
  };
  // Início X/Y move o bloco inteiro; os ajustes individuais acompanham.
  const updStart = (patch: { first_x?: number; first_y?: number }) => {
    const nx = patch.first_x ?? b.first_x;
    const ny = patch.first_y ?? b.first_y;
    upd({ ...patch, overrides: shiftOverrides(b.overrides, nx - b.first_x, ny - b.first_y) });
  };
  const overrideRows = Object.entries(b.overrides ?? {})
    .flatMap(([q, opts]) => Object.entries(opts).map(([option, p]) => ({ q: Number(q), option, ...p })))
    .sort((a, z) => a.q - z.q || a.option.localeCompare(z.option));
  const clearOneOverride = (q: number, option: string) =>
    upd({ overrides: withoutBubbleOverride(b, q, option).overrides });
  const clearAllOverrides = () => upd({ overrides: {} });
  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold text-sm">Bloco de questões</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Q{b.start_question}–Q{b.start_question + b.n_questions - 1}
          {' · '}{b.columns} coluna(s) × {b.labels.length} alternativa(s)
          {b.annulled ? ' · anulada' : ''}{b.multi_answer ? ' · múltipla' : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="1ª questão" htmlFor="p-blk-start">
          <Input id="p-blk-start" type="number" min={1} value={b.start_question}
                 onChange={(e) => upd({ start_question: Math.max(1, Number(e.target.value)) })} />
        </Field>
        <Field label="Nº de questões" htmlFor="p-blk-nq">
          <Input id="p-blk-nq" type="number" min={1} value={b.n_questions}
                 onChange={(e) => upd({ n_questions: Math.max(0, Number(e.target.value)) })} />
        </Field>
      </div>
      <Field label="Alternativas (separadas por vírgula)" htmlFor="p-blk-labels">
        <Input id="p-blk-labels" value={b.labels.join(', ')} onChange={(e) => updLabels(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Colunas" htmlFor="p-blk-cols">
          <Input id="p-blk-cols" type="number" min={1} value={b.columns}
                 onChange={(e) => upd({ columns: Math.max(1, Number(e.target.value)) })} />
        </Field>
        <Field label="Ordem" htmlFor="p-blk-dist">
          <Select id="p-blk-dist" value={b.distribution}
                  onChange={(e) => upd({ distribution: e.target.value as 'column' | 'row' })}>
            <option value="column">Por coluna</option>
            <option value="row">Por linha</option>
          </Select>
        </Field>
      </div>

      <details className="rounded border border-gray-200 dark:border-gray-800">
        <summary className="cursor-pointer select-none px-2 py-2 text-sm font-medium">
          Avançado — posição, bolhas e regras
        </summary>
        <div className="space-y-2 border-t border-gray-200 p-2 dark:border-gray-800">
          <div className="grid grid-cols-2 gap-2">
            <PctInput id="p-blk-osx" label="Espaço X (%)" value={b.option_step_x} onChange={(v) => upd({ option_step_x: v })} />
            <PctInput id="p-blk-qsy" label="Espaço Y (%)" value={b.question_step_y} onChange={(v) => upd({ question_step_y: v })} />
            <PctInput id="p-blk-csx" label="Passo coluna (%)" value={b.column_step_x ?? b.option_step_x * b.labels.length}
                      onChange={(v) => upd({ column_step_x: v })} />
            <PctInput id="p-blk-r" label="Raio da bolha (%)" value={b.radius} onChange={(v) => upd({ radius: v })} />
            <PctInput id="p-blk-fx" label="Início X (%)" value={b.first_x} onChange={(v) => updStart({ first_x: v })} />
            <PctInput id="p-blk-fy" label="Início Y (%)" value={b.first_y} onChange={(v) => updStart({ first_y: v })} />
          </div>
          <div className="space-y-1 rounded border border-amber-200 dark:border-amber-900/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="label mb-0">Ajustes individuais ({overrideRows.length})</p>
              {overrideRows.length > 0 && (
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={clearAllOverrides}>
                  Limpar todos
                </button>
              )}
            </div>
            {overrideRows.length === 0 ? (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Use a ferramenta <strong>Ajustar bolhas</strong> e arraste uma bolha para corrigir o alinhamento.
              </p>
            ) : (
              <div className="max-h-32 space-y-0.5 overflow-y-auto">
                {overrideRows.map((o) => (
                  <div key={`${o.q}-${o.option}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono">Q{o.q} · {o.option}</span>
                    <span className="tabular-nums text-gray-400">
                      {o.x != null ? `${(o.x * 100).toFixed(1)}%` : '—'}, {o.y != null ? `${(o.y * 100).toFixed(1)}%` : '—'}
                    </span>
                    <button type="button" className="text-gray-400 hover:text-red-500" title="Remover ajuste"
                            onClick={() => clearOneOverride(o.q, o.option)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Field label="Formato da bolha" htmlFor="p-blk-shape">
            <Select id="p-blk-shape" value={b.shape} onChange={(e) => upd({ shape: e.target.value as 'circle' | 'square' })}>
              <option value="circle">Círculo</option>
              <option value="square">Quadrado</option>
            </Select>
          </Field>
          <Field label="Estilo de marcação" htmlFor="p-blk-mark">
            <Select id="p-blk-mark" value={b.mark_style}
                    onChange={(e) => upd({ mark_style: e.target.value as 'filled' | 'marks' })}>
              <option value="filled">Bolha preenchida</option>
              <option value="marks">Marca (X / check)</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Valor (pontos)" htmlFor="p-blk-points">
              <Input id="p-blk-points" type="number" step={0.1} value={b.points}
                     onChange={(e) => upd({ points: Number(e.target.value) })} />
            </Field>
            <div className="flex items-end gap-3 pb-1 text-sm">
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={b.multi_answer} onChange={(e) => upd({ multi_answer: e.target.checked })} />
                Múltiplas
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={b.annulled} onChange={(e) => upd({ annulled: e.target.checked })} />
                Anulada
              </label>
            </div>
          </div>
          {b.multi_answer && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Mín. de marcas (2+)" htmlFor="p-blk-mmin">
                <Input id="p-blk-mmin" type="number" min={2} placeholder="2"
                       value={b.multi_marks_min ?? ''}
                       onChange={(e) => upd({ multi_marks_min: e.target.value === '' ? null : Math.max(2, Number(e.target.value)) })} />
              </Field>
              <Field label="Máx. de marcas" htmlFor="p-blk-mmax">
                <Input id="p-blk-mmax" type="number" min={2} placeholder={String(b.labels.length)}
                       value={b.multi_marks_max ?? ''}
                       onChange={(e) => upd({ multi_marks_max: e.target.value === '' ? null : Math.max(2, Number(e.target.value)) })} />
              </Field>
            </div>
          )}

          <div className="space-y-1 rounded border border-gray-200 dark:border-gray-800 p-2">
            <p className="label mb-1">Regras de decisão</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={b.pick_darkest_mark} disabled={b.multi_answer}
                     onChange={(e) => upd({ pick_darkest_mark: e.target.checked })} />
              Marca mais escura resolve dupla
            </label>
            {b.pick_darkest_mark && !b.multi_answer && (
              <div className="pl-6">
                <PctInput id="p-blk-dmt" label="Gap mínimo (%)" value={b.darkest_mark_threshold ?? 0.11}
                          onChange={(v) => upd({ darkest_mark_threshold: v })} />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={b.fallback_on_empty}
                     onChange={(e) => upd({ fallback_on_empty: e.target.checked })} />
              Reler questões vazias (fallback)
            </label>
            {b.fallback_on_empty && (
              <div className="pl-6">
                <PctInput id="p-blk-fbf" label="Piso alternativo (%)" value={b.fallback_floor ?? 0.20}
                          onChange={(v) => upd({ fallback_floor: v })} />
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Diagnóstico da configuração
// ───────────────────────────────────────────────────────────────────────────

function ValidationPanel({ issues, warnings, onGoTo }: {
  issues: ValidationIssue[];
  warnings: TemplatePageWarning[];
  onGoTo: (s: Selection) => void;
}) {
  if (!issues.length && !warnings.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle2 size={16} /> Sem problemas detectados.
      </div>
    );
  }
  const kindOf = (id: string | null): RegionType | null => {
    if (!id) return null;
    if (id.startsWith('anc')) return 'anchor';
    if (id.startsWith('qr')) return 'qr';
    if (id.startsWith('info')) return 'info';
    if (id.startsWith('blk')) return 'block';
    if (id.startsWith('idg')) return 'idgrid';
    return null;
  };
  return (
    <div className="space-y-1">
      <p className="label">Diagnóstico</p>
      {warnings.map((w) => (
        <div key={`w-${w.page}-${w.code}`}
             className="w-full text-left text-xs rounded px-2 py-1 flex items-start gap-1.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>{w.message}</span>
        </div>
      ))}
      {issues.map((it, k) => {
        const kind = kindOf(it.region_id);
        return (
          <button key={k} type="button"
                  onClick={() => kind && it.region_id && onGoTo({ kind, id: it.region_id })}
                  className={`w-full text-left text-xs rounded px-2 py-1 flex items-start gap-1.5 ${it.level === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'}`}>
            {it.level === 'error'
              ? <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              : <Info size={13} className="mt-0.5 shrink-0" />}
            <span>{it.message}</span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Ações: testar com foto + imprimir
// ───────────────────────────────────────────────────────────────────────────

function ActionsPanel({ detailId, onRestore }: { detailId: number; onRestore: (c: CustomConfig) => void }) {
  const toast = useNotify();
  const [testOpen, setTestOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<CustomVersionRow[]>([]);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [result, setResult] = useState<CustomTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [truth, setTruth] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const testFileRef = useRef<HTMLInputElement>(null);

  /** Baixa o modelo de leitura (JSON com a posição de cada bolha em mm). */
  const downloadReadingModel = async () => {
    setModelBusy(true);
    try {
      const model = await customTemplateReadingModel(detailId, 0);
      saveBlob(
        new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }),
        `modelo-de-leitura-${detailId}.json`,
      );
      const t = model.totals;
      toast.success(
        `Modelo baixado: ${t.questions} questões, ${t.bubbles} bolhas`
        + (t.studentIdBubbles ? `, ${t.studentIdBubbles} de matrícula` : '')
        + ` (${model.page.unit}).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar o modelo de leitura');
    } finally {
      setModelBusy(false);
    }
  };

  const openVersions = async () => {
    setVersionsBusy(true);
    try {
      const r = await listCustomVersions(detailId);
      setVersions(r.versions);
      setVersionsOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao listar as versões');
    } finally {
      setVersionsBusy(false);
    }
  };

  // Restaurar só aplica no editor (com Desfazer) — nada é gravado até Salvar.
  const restoreVersion = async (v: number) => {
    setVersionsBusy(true);
    try {
      const r = await getCustomVersion(detailId, v);
      onRestore(r.config);
      setVersionsOpen(false);
      toast.info(`Versão ${v} aplicada no editor. Salve para manter.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao restaurar a versão');
    } finally {
      setVersionsBusy(false);
    }
  };

  const parseTruth = (raw: string): Record<string, string> => {
    const t = raw.trim();
    if (!t) return {};
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
    } catch {
      /* tenta o formato curto */
    }
    return Object.fromEntries(
      t.split(/[,;\n]+/).map((p) => {
        const [q, l] = p.split(/[:=]/);
        return [String(q).trim(), String(l ?? '').trim().toUpperCase()] as const;
      }).filter(([q, l]) => q && l),
    );
  };

  const runTest = async (file: File) => {
    setBusy(true);
    try {
      const r = await testCustomTemplate(detailId, file, parseTruth(truth));
      setResult(r);
      toast[r.success ? 'success' : 'error'](r.success ? 'Teste concluído.' : (r.error || 'Falha no teste'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no teste');
    } finally {
      setBusy(false);
      if (testFileRef.current) testFileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <p className="label">Ações</p>
      <Button size="sm" variant="secondary" className="w-full" icon={<FlaskConical size={15} aria-hidden />}
              onClick={() => setTestOpen(true)}>Testar com foto</Button>
      <Button size="sm" variant="secondary" className="w-full" icon={<Printer size={15} aria-hidden />}
              onClick={() => setPrintOpen(true)}>Imprimir / exportar</Button>
      <Button size="sm" variant="secondary" className="w-full" icon={<FileJson size={15} aria-hidden />}
              loading={modelBusy} onClick={() => void downloadReadingModel()}
              title="Baixa a posição de cada bolha, campo e QR em JSON (mm quando o modelo declara o DPI)">
        Modelo de leitura
      </Button>
      <Button size="sm" variant="secondary" className="w-full" icon={<History size={15} aria-hidden />}
              loading={versionsBusy} onClick={() => void openVersions()}>Versões</Button>

      <Modal open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Versões do modelo">
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Cada ativação guarda uma cópia da configuração. Restaurar aplica a versão no
            editor (dá para desfazer) — nada é gravado até você clicar em <strong>Salvar</strong>.
            A imagem importada não é versionada, só as regiões.
          </p>
          {versions.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma versão ainda — ative o modelo para criar a primeira.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2 dark:border-gray-800">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Versão {v.version}</p>
                    <p className="text-[11px] text-gray-500">
                      {v.created_at ? new Date(v.created_at).toLocaleString('pt-BR') : '—'}
                      {' · '}{v.summary.n_anchors} âncora(s)
                      {' · '}{v.summary.n_blocks} bloco(s)
                      {' · '}{v.summary.n_questions} questão(ões)
                      {' · '}{v.summary.n_pages} página(s)
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" loading={versionsBusy}
                          onClick={() => void restoreVersion(v.version)}>Restaurar</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal open={testOpen} onClose={() => setTestOpen(false)} wide title="Testar leitura com uma foto real">
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Envie uma foto do cartão preenchido. O sistema lê com este modelo e compara
            com o gabarito, se informado.
          </p>
          <Field label="Gabarito esperado (opcional)" htmlFor="ct-truth"
                 helper={'Aceita JSON {"1":"A"} ou "1:A, 2:B".'}>
            <textarea id="ct-truth" className="input font-mono text-xs" rows={3}
                      value={truth} onChange={(e) => setTruth(e.target.value)}
                      placeholder="1:A, 2:B, 3:C" />
          </Field>
          <input ref={testFileRef} type="file" accept="image/*" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) void runTest(f); }} />
          <Button loading={busy} onClick={() => testFileRef.current?.click()}
                  icon={<Upload size={16} aria-hidden />}>Escolher foto</Button>

          {result && !result.success && (
            <div className="text-sm text-red-600">
              <p>{result.error}</p>
              {result.alignment?.detail && (
                <p className="mt-1 text-xs text-red-500">
                  Alinhamento: {result.alignment.detail}
                  {result.alignment.inferred_corners?.length
                    ? ` · âncora inferida: ${result.alignment.inferred_corners.join(', ')}`
                    : ''}
                </p>
              )}
            </div>
          )}
          {result?.success && (
            <div className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-3">
              {result.comparison && result.comparison.accuracy != null && (
                <p className="text-sm">
                  <strong>Acerto:</strong> {(result.comparison.accuracy * 100).toFixed(1)}%
                  {' '}({result.comparison.correct}/{result.comparison.evaluated})
                </p>
              )}
              {result.alignment && (
                <p className="text-xs text-gray-500">
                  Alinhamento: {result.alignment.method}
                  {result.alignment.precision != null
                    ? ` · grade ${(result.alignment.precision * 100).toFixed(0)}%`
                    : ''}
                  {result.alignment.enrichment != null
                    ? ` · tinta ${result.alignment.enrichment.toFixed(2)}×`
                    : ''}
                  {result.alignment.inferred_corners?.length
                    ? ` · âncora inferida: ${result.alignment.inferred_corners.join(', ')}`
                    : ''}
                </p>
              )}
              <p className="text-xs text-gray-500">
                {Object.keys(result.answers ?? {}).length} marcadas · {(result.blank_questions ?? []).length} brancas ·
                {' '}{(result.duplicate_questions ?? []).length} duplas · {(result.low_confidence ?? []).length} incertas
                {(result.darkest_marks ?? []).length ? ` · ${(result.darkest_marks ?? []).length} por marca mais escura` : ''}
                {(result.fallback_marks ?? []).length ? ` · ${(result.fallback_marks ?? []).length} por fallback` : ''}
                {Object.keys(result.multi_marks ?? {}).length ? ` · ${Object.keys(result.multi_marks ?? {}).length} múltipla resposta` : ''}
                {result.qr_id ? ` · QR: ${result.qr_id}` : ''}
                {result.student_id_detail
                  ? (result.student_id
                    ? ` · matrícula: ${result.student_id}`
                    : ` · matrícula: não identificada (${Object.values(result.student_id_detail)
                        .filter((d) => d.value != null && d.score >= 0.25).length} de `
                      + `${Object.keys(result.student_id_detail).length} dígitos lidos)`)
                  : ''}
              </p>
              {result.comparison?.mismatches?.length ? (
                <div className="text-xs">
                  <p className="font-medium">Divergências:</p>
                  <ul className="max-h-32 overflow-y-auto">
                    {result.comparison.mismatches.map((m, k) => (
                      <li key={k}>Q{m.question}: esperado {m.expected}, lido {m.got ?? '—'}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {result.rectified_image && (
                  <figure>
                    <img src={result.rectified_image} alt="Retificada" className="w-full rounded border border-gray-200 dark:border-gray-700" />
                    <figcaption className="text-[11px] text-center text-gray-500">Retificada</figcaption>
                  </figure>
                )}
                {result.overlay_image && (
                  <figure>
                    <img src={result.overlay_image} alt="Diagnóstico" className="w-full rounded border border-gray-200 dark:border-gray-700" />
                    <figcaption className="text-[11px] text-center text-gray-500">Verde = marcada</figcaption>
                  </figure>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <PrintModal open={printOpen} onClose={() => setPrintOpen(false)} detailId={detailId} />
    </div>
  );
}

function PrintModal({ open, onClose, detailId }: { open: boolean; onClose: () => void; detailId: number }) {
  const toast = useNotify();
  const [mode, setMode] = useState<'blank' | 'students' | 'avaliacao'>('blank');
  const [format, setFormat] = useState<'PDF' | 'PNG'>('PDF');
  const [studentsText, setStudentsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<PrintPreviewResult | null>(null);

  const parseStudents = (): { nome: string; matricula?: string }[] | undefined => {
    if (mode !== 'students') return undefined;
    const list = studentsText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [nome, matricula] = l.split(/[,;\t]/).map((s) => s.trim());
      return { nome, matricula };
    });
    return list.length ? list : undefined;
  };

  // qualquer mudança no que será gerado invalida a prévia
  useEffect(() => { setPreview(null); }, [mode, format, studentsText]);

  const handlePrint = async () => {
    setBusy(true);
    try {
      const students = parseStudents();
      const fmt = mode === 'students' && students && students.length > 1 ? 'PDF' : format;
      await printCustomTemplate(detailId, mode, fmt, students);
      toast.success('Arquivo gerado.');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar');
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async () => {
    const students = parseStudents();
    if (mode === 'students' && !students) {
      toast.info('Informe ao menos um aluno para pré-visualizar.');
      return;
    }
    setPreviewBusy(true);
    try {
      const res = await printPreviewCustomTemplate(detailId, mode, format, students);
      setPreview(res);
      if (!res.ok) toast.error(res.error ?? 'Não foi possível gerar a prévia.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na prévia');
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Imprimir / exportar"
           footer={
             <>
               <Button variant="secondary" onClick={onClose}>Cancelar</Button>
               <Button loading={busy} onClick={() => void handlePrint()} icon={<Printer size={16} aria-hidden />}>Gerar</Button>
             </>
           }>
      <div className="space-y-3">
        <Field label="O que gerar" htmlFor="pr-mode">
          <Select id="pr-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="blank">Cartão em branco</option>
            <option value="students">Cartões por aluno (lista manual)</option>
            <option value="avaliacao">Cartões da turma da prova (banco)</option>
          </Select>
        </Field>
        {mode === 'students' && (
          <div className="callout-info text-xs">
            Lista manual não grava gabaritos oficiais no banco: os QR saem com
            código temporário. Para leitura/correção vinculada à prova, use
            “Cartões da turma da prova”.
          </div>
        )}
        {mode !== 'avaliacao' && (
          <Field label="Formato" htmlFor="pr-fmt">
            <Select id="pr-fmt" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              <option value="PDF">PDF</option>
              <option value="PNG">PNG</option>
            </Select>
          </Field>
        )}
        {mode === 'students' && (
          <Field label="Alunos (um por linha: nome, matrícula)" htmlFor="pr-students">
            <textarea id="pr-students" className="input font-mono text-xs" rows={5}
                      value={studentsText} onChange={(e) => setStudentsText(e.target.value)}
                      placeholder={'Ana Silva, 2024001\nBruno Souza'} />
          </Field>
        )}
        {mode === 'avaliacao' && (
          <p className="text-xs text-gray-500">
            Usa os alunos importados na prova vinculada e cria/atualiza um gabarito
            com QR Code por aluno.
          </p>
        )}

        {/* Prévia do lote — confira antes de gerar/imprimir */}
        <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="label mb-0">Prévia</span>
            <Button variant="secondary" size="sm" loading={previewBusy}
                    onClick={() => void handlePreview()} icon={<Eye size={15} aria-hidden />}>
              Ver prévia
            </Button>
          </div>

          {!preview && (
            <p className="text-xs text-gray-500">
              Mostra os primeiros cartões do lote antes de gerar o arquivo.
            </p>
          )}
          {preview && !preview.ok && (
            <p className="text-xs text-red-600 dark:text-red-400">{preview.error}</p>
          )}
          {preview && preview.ok && (
            <>
              <p className="text-xs text-gray-500">
                {preview.count === 1 ? '1 cartão' : `${preview.count} cartões`}
                {preview.shown < preview.count ? ` · exibindo os ${preview.shown} primeiros` : ''}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {preview.pages.map((p, i) => (
                  <figure key={`${p.code}-${i}`}>
                    <img src={p.image} alt={`Cartão ${p.title || i + 1}`}
                         className="w-full rounded border border-gray-200 dark:border-gray-700" />
                    <figcaption className="text-[10px] text-center text-gray-500 truncate"
                                title={p.title}>{p.title || 'Sem nome'}</figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
