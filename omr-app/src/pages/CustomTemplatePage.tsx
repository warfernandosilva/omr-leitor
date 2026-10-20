import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft, ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Trash2, Save,
  Upload, ShieldCheck, Eye, EyeOff, Printer, FlaskConical, Crosshair, PenSquare,
  Square, Info, QrCode, Boxes, AlertTriangle, CheckCircle2, ImageIcon, ScanSearch, Plus, Move,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { syncExam } from '../utils/api';
import { getExams } from '../utils/storage';
import type { Exam } from '../types';
import {
  CustomAnchor, CustomBlock, CustomConfig, CustomInfoRegion, CustomQr,
  CustomTemplateDetail, CustomTemplateSummary, CustomTestResult,
  PRINT_SOURCES, STATUS_LABEL, ValidationIssue, activateCustomTemplate,
  createCustomTemplate, customTemplateImage, deleteCustomTemplate, detectCustomGrid, detectCustomAnchors, detectPageCorners, expandBlock,
  getCustomTemplate, listCustomTemplates, printCustomTemplate, printPreviewCustomTemplate,
  testCustomTemplate, updateCustomTemplate, validateCustomTemplate,
} from '../utils/custom-template-api';
import type { PrintPreviewResult } from '../utils/custom-template-api';
import { makeAnchor, nextArucoId } from '../utils/custom-template-anchor';

type RegionType = 'anchor' | 'qr' | 'info' | 'block';
type Tool = 'select' | 'anchor' | 'qr' | 'info' | 'place-block';
type Selection = { kind: RegionType; id: string } | null;

interface Rect { x: number; y: number; w: number; h: number }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rnd = () => Math.random().toString(36).slice(2, 8);

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
      <TemplateEditor
        detail={detail}
        onClose={() => { setDetail(null); void refreshList(); }}
        onSaved={setDetail}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Gabarito personalizado"
        subtitle="Importe a imagem de um cartão-resposta próprio, marque as regiões e leia com o motor OMR do sistema."
      />
      <TemplateList
        templates={templates}
        loading={loadingList}
        onOpen={openTemplate}
        onChanged={refreshList}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Lista + criação
// ───────────────────────────────────────────────────────────────────────────

function TemplateList({
  templates, loading, onOpen, onChanged,
}: {
  templates: CustomTemplateSummary[];
  loading: boolean;
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const toast = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState('');
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  useEffect(() => {
    try {
      setExams(getExams());
    } catch {
      setExams([]);
    }
  }, []);

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
      <div className="card max-w-2xl">
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
          Envie uma imagem (PNG/JPG) do seu cartão-resposta. Depois você desenha as
          âncoras, o QR e as bolhas no editor visual.
        </p>
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
          <Field label="Nome do modelo" htmlFor="ct-nome">
            <Input id="ct-nome" value={nome} placeholder="Ex.: Cartão da escola"
                   onChange={(e) => setNome(e.target.value)} />
          </Field>
          <Button loading={busy} icon={<Upload size={16} aria-hidden />}
                  onClick={() => fileRef.current?.click()}>
            Importar imagem
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
          description="Importe uma imagem acima para começar."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="card flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-ink dark:text-white truncate">{t.nome}</h3>
                <span className={`badge ${t.status === 'ativo' ? 'badge-success' : 'badge-info'}`}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
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

type DragState =
  | { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'move'; region: Exclude<RegionType, 'block'>; id: string; start: { x: number; y: number }; orig: Rect }
  | { kind: 'resize'; region: Exclude<RegionType, 'block'>; id: string; handle: string; orig: Rect }
  | { kind: 'moveblock'; id: string; start: { x: number; y: number }; orig: { x: number; y: number } }
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
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [show, setShow] = useState({ anchors: true, qr: true, info: true, bubbles: true });
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
  // Multi-página (mesma folha): página do modelo atualmente editada.
  const [pageIdx, setPageIdx] = useState(0);
  // Cópia de configuração de outro modelo
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyCandidates, setCopyCandidates] = useState<CustomTemplateSummary[]>([]);
  const [copyFromId, setCopyFromId] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);

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

  // imagem de fundo
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await customTemplateImage(detail.id);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImgUrl(url);
      } catch {
        /* preview é opcional */
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [detail.id]);

  const baseW = config.page_w || detail.image_w || 1000;
  const baseH = config.page_h || detail.image_h || 1400;

  const nPages = Math.max(1, config.n_pages ?? 1);
  // Página efetivamente editada (clampada ao número disponível).
  const currentPage = Math.min(pageIdx, nPages - 1);
  // Config recortada à página atual: o canvas/overlay/lista mostram só as
  // regiões dessa página. QR, info e print_fields são compartilhados.
  const pageConfig = useMemo<CustomConfig>(
    () => ({
      ...config,
      anchors: config.anchors.filter((a) => (a.page ?? 0) === currentPage),
      questions: config.questions.filter((b) => (b.page ?? 0) === currentPage),
    }),
    [config, currentPage],
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const snapRef = useRef<CustomConfig | null>(null);
  const creatingRef = useRef<CreateBox | null>(null);
  const createCtxRef = useRef<{ tool: 'anchor' | 'qr' | 'info'; anchorType: 'aruco' | 'quad'; arucoId: number; anchorSize: number; page: number }>(
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
        setPan({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) });
        return;
      }
      const p = toBase(e.clientX, e.clientY);
      if (d.kind === 'move') {
        const dx = (p.x - d.start.x) / baseW;
        const dy = (p.y - d.start.y) / baseH;
        const nx = clamp(d.orig.x + dx, 0, 1 - d.orig.w);
        const ny = clamp(d.orig.y + dy, 0, 1 - d.orig.h);
        setConfig((cfg) => setRect(cfg, d.region, d.id, { x: nx, y: ny, w: d.orig.w, h: d.orig.h }));
      } else if (d.kind === 'resize') {
        setConfig((cfg) => setRect(cfg, d.region, d.id, resizeRect(d.orig, d.handle, p.x / baseW, p.y / baseH)));
      } else if (d.kind === 'moveblock') {
        const dx = (p.x - d.start.x) / baseW;
        const dy = (p.y - d.start.y) / baseH;
        setConfig((cfg) => setBlockStart(cfg, d.id, clamp(d.orig.x + dx, 0, 1), clamp(d.orig.y + dy, 0, 1)));
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
        const w = Math.abs(c.x1 - c.x0) / baseW;
        const h = Math.abs(c.y1 - c.y0) / baseH;
        if (w < 0.012 || h < 0.012) return; // clique sem arrasto
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
      dragRef.current = null;
      setDragKind(null);
      if (!d || d.kind === 'pan') return;
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
  }, [baseW, baseH, toBase, pushHistory, currentPage]);

  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || e.altKey) {
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
      setDragKind('pan');
      return;
    }
    if (tool === 'select') { setSelection(null); return; }
    if (tool === 'place-block') return;
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
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelection({ kind, id });
    snapRef.current = clone(configRef.current);
    const p = toBase(e.clientX, e.clientY);
    if (kind === 'block') {
      const b = configRef.current.questions.find((x) => x.id === id);
      if (!b) return;
      dragRef.current = { kind: 'moveblock', id, start: p, orig: { x: b.first_x, y: b.first_y } };
      setDragKind('moveblock');
      return;
    }
    const orig = rectOf(configRef.current, kind, id);
    if (!orig) return;
    dragRef.current = { kind: 'move', region: kind, id, start: p, orig };
    setDragKind('move');
  };

  const startResize = (e: ReactPointerEvent<SVGElement>, kind: Exclude<RegionType, 'block'>, id: string, handle: string, orig: Rect) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    snapRef.current = clone(configRef.current);
    dragRef.current = { kind: 'resize', region: kind, id, handle, orig };
    setDragKind('resize');
  };

  const startPageCornerDrag = (e: ReactPointerEvent<SVGElement>, index: number) => {
    if (e.button !== 0) return;
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

  // Multi-página (mesma folha): adiciona uma página nova (copia as âncoras da
  // 1ª página que as tenha — a folha é a mesma) e remove a página atual.
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
      ? `Página ${idx + 1} criada com as âncoras copiadas da página ${(srcPage ?? 0) + 1}.`
      : `Página ${idx + 1} criada.`);
  };
  const removePage = () => {
    if (nPages <= 1) return;
    const idx = currentPage;
    const cfg = configRef.current;
    apply({
      ...cfg,
      n_pages: nPages - 1,
      anchors: cfg.anchors
        .filter((a) => (a.page ?? 0) !== idx)
        .map((a) => ((a.page ?? 0) > idx ? { ...a, page: (a.page ?? 0) - 1 } : a)),
      questions: cfg.questions
        .filter((b) => (b.page ?? 0) !== idx)
        .map((b) => ((b.page ?? 0) > idx ? { ...b, page: (b.page ?? 0) - 1 } : b)),
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

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const d = await updateCustomTemplate(detail.id, { config });
      onSaved(d);
      const v = await validateCustomTemplate(detail.id);
      setIssues(v.issues);
      setStatus(v.status as typeof status);
      setDirty(false);
      toast.success('Modelo salvo.');
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar');
      return false;
    } finally {
      setSaving(false);
    }
  }, [config, detail.id, onSaved, toast]);

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

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        title={detail.nome}
        subtitle={`Gabarito personalizado · ${STATUS_LABEL[status] ?? status}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onClose}
                    icon={<ArrowLeft size={15} aria-hidden />}>Modelos</Button>
            <Button variant="secondary" size="sm" onClick={() => void save()} loading={saving}
                    disabled={!dirty} icon={<Save size={15} aria-hidden />}>Salvar</Button>
            <Button variant="secondary" size="sm" onClick={() => void runValidate()}
                    icon={<CheckCircle2 size={15} aria-hidden />}>Validar</Button>
            <Button variant="success" size="sm" onClick={() => void activate()}
                    icon={<ShieldCheck size={15} aria-hidden />}>
              {status === 'ativo' ? 'Ativar nova versão' : 'Ativar modelo'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_280px] gap-3">
        {/* Painel esquerdo */}
        <div className="card space-y-3 max-h-[85vh] overflow-y-auto">
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
          </div>
          {/* Cópia de configuração de outro modelo */}
          <div className="space-y-2">
            <button type="button" onClick={() => void openCopy()}
                    className="btn btn-secondary btn-sm w-full justify-start">
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
          <Toolbar tool={tool} setTool={setTool}
                   anchorType={anchorType} setAnchorType={setAnchorType}
                   anchorArucoId={anchorArucoId} setAnchorArucoId={setAnchorArucoId}
                   onAddBlock={addBlock}
                   anchorCount={pageConfig.anchors.length}
                   onAddAnchor={addAnchor}
                   anchorSize={anchorSize} setAnchorSize={setAnchorSize}
                   onDetectGrid={() => void detectGrid()} detecting={detecting}
                    onDetectAnchors={() => void detectAnchors()} detectingAnchors={detectingAnchors}
                    onDetectPageCorners={() => void handleDetectPageCorners()} detectingPageCorners={detectingPageCorners}
                    onManualPageCorners={startManualPageCorners}
                    onRemovePageCorners={removePageCorners}
                    hasPageCorners={Array.isArray(config.page_corners) && config.page_corners.length === 4} />

          <div>
            <p className="label">Camadas</p>
            <div className="flex flex-wrap gap-2">
              {(['anchors', 'qr', 'info', 'bubbles'] as const).map((k) => (
                <button key={k} type="button" className="btn btn-secondary btn-sm"
                        title={`Mostrar/ocultar ${k}`}
                        onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>
                  {show[k] ? <Eye size={14} /> : <EyeOff size={14} className="opacity-50" />}
                  <span className="text-[10px] ml-1 capitalize">{k}</span>
                </button>
              ))}
            </div>
          </div>

          <RegionalList config={pageConfig} selection={selection} setSelection={setSelection}
                        onDelete={(kind, id) => {
                          apply(removeRegion(configRef.current, kind, id));
                          setSelection(null);
                        }} />
        </div>

        {/* Área central */}
        <div className="card p-2 flex flex-col gap-2 min-h-[78vh]">
          <div className="flex items-center flex-wrap gap-2">
            <Button size="icon" variant="ghost" title="Reduzir" onClick={() => setZoom((z) => Math.max(0.1, z - 0.05))}><ZoomOut size={16} /></Button>
            <input type="number" min={10} max={400} step={1} value={Math.round(zoom * 100)}
                   onChange={(e) => {
                     const v = Number(e.target.value);
                     if (!Number.isFinite(v)) return;
                     setZoom(Math.max(0.1, Math.min(4, v / 100)));
                   }}
                   className="text-xs w-12 text-center border border-gray-300 dark:border-gray-700 rounded px-1 py-0.5 bg-transparent" />
            <span className="text-xs text-gray-500">%</span>
            <Button size="icon" variant="ghost" title="Ampliar" onClick={() => setZoom((z) => Math.min(4, z + 0.05))}><ZoomIn size={16} /></Button>
            <Button size="icon" variant="ghost" title="Ajustar"
                    onClick={() => { setZoom(0.5); setPan({ x: 0, y: 0 }); }}><Maximize size={16} /></Button>
            <span className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-1" />
            <Button size="icon" variant="ghost" title="Desfazer" disabled={!past.length} onClick={undo}><Undo2 size={16} /></Button>
            <Button size="icon" variant="ghost" title="Refazer" disabled={!future.length} onClick={redo}><Redo2 size={16} /></Button>
            {tool !== 'select' && (
              <span className="text-xs text-brand-600 dark:text-brand-300 ml-2 inline-flex items-center gap-1">
                <Crosshair size={13} />
                {tool === 'place-block' ? 'Clique para posicionar o bloco' : 'Arraste para criar a região'}
              </span>
            )}
          </div>

          <div className="relative overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800 flex-1"
               style={{ cursor: dragKind === 'pan' ? 'grabbing' : tool === 'select' ? 'default' : 'crosshair' }}>
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, position: 'absolute', left: 0, top: 0, width: baseW * zoom, height: baseH * zoom }}>
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
                  config={pageConfig} show={show} selection={selection} zoom={zoom}
                  onSelect={setSelection} onStartDrag={startDragRegion} onStartResize={startResize}
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
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Alt+arrastar (ou botão do meio) move a visualização. {bubbles.length} bolha(s) configurada(s).
            {Array.isArray(config.page_corners) && config.page_corners.length === 4 && (
              <> Cantos da folha (roxo) ativos — arraste os 4 pontos para ajustar. Usados como destino
              do alinhamento quando o modelo não tem as 4 âncoras de canto.</>
            )}
          </p>
        </div>

        {/* Painel direito */}
        <div className="card space-y-3 max-h-[85vh] overflow-y-auto">
          <PropertiesPanel config={config} selection={selection} updateField={updateField} />
          <ValidationPanel issues={issues} onGoTo={setSelection} />
          <ActionsPanel detailId={detail.id} />
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers puros de edição da configuração
// ───────────────────────────────────────────────────────────────────────────

function buildCreate(
  cfg: CustomConfig, region: 'anchor' | 'qr' | 'info', rect: Rect,
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

function removeRegion(cfg: CustomConfig, kind: RegionType, id: string): CustomConfig {
  if (kind === 'anchor') return { ...cfg, anchors: cfg.anchors.filter((a) => a.id !== id) };
  if (kind === 'qr') return { ...cfg, qr: null };
  if (kind === 'info') return { ...cfg, info_regions: cfg.info_regions.filter((r) => r.id !== id) };
  return { ...cfg, questions: cfg.questions.filter((b) => b.id !== id) };
}

function rectOf(cfg: CustomConfig, kind: RegionType, id: string): Rect | null {
  if (kind === 'qr' && cfg.qr) return { x: cfg.qr.x, y: cfg.qr.y, w: cfg.qr.w, h: cfg.qr.h };
  if (kind === 'info') {
    const r = cfg.info_regions.find((x) => x.id === id);
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
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
  return {
    ...cfg,
    anchors: cfg.anchors.map((a) =>
      a.id === id ? { ...a, x: rect.x + a.size / 2, y: rect.y + a.size / 2 } : a),
  };
}

function setBlockStart(cfg: CustomConfig, id: string, x: number, y: number): CustomConfig {
  return {
    ...cfg,
    questions: cfg.questions.map((b) => (b.id === id ? { ...b, first_x: x, first_y: y } : b)),
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
  anchorCount, onAddAnchor,
  onAddBlock, onDetectGrid, onDetectAnchors, onDetectPageCorners, onManualPageCorners, onRemovePageCorners,
  detecting, detectingAnchors, detectingPageCorners, hasPageCorners,
}: {
  tool: Tool; setTool: (t: Tool) => void;
  anchorType: 'aruco' | 'quad'; setAnchorType: (t: 'aruco' | 'quad') => void;
  anchorArucoId: number; setAnchorArucoId: (n: number) => void;
  anchorSize: number; setAnchorSize: (n: number) => void;
  anchorCount: number;
  onAddAnchor: () => void;
  onAddBlock: () => void;
  onDetectGrid: () => void;
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
  ];
  return (
    <div className="space-y-2">
      <p className="label">Ferramentas</p>
      <div className="grid grid-cols-2 gap-2">
        {tools.map((t) => (
          <button key={t.id} type="button" onClick={() => setTool(t.id)}
                  className={`btn btn-sm min-h-[40px] justify-start ${tool === t.id ? 'btn-primary' : 'btn-secondary'}`}>
            <t.icon size={15} aria-hidden /> {t.label}
          </button>
        ))}
        <button type="button" onClick={onAddAnchor}
                title="Adiciona uma âncora no próximo canto livre. Clique nela no cartão para editar tipo e tamanho."
                className="btn btn-sm min-h-[40px] justify-start col-span-2 btn-secondary">
          <Plus size={15} aria-hidden /> Adicionar âncora
        </button>
        <button type="button" onClick={onAddBlock}
                className={`btn btn-sm min-h-[40px] justify-start col-span-2 ${tool === 'place-block' ? 'btn-primary' : 'btn-secondary'}`}>
          <Boxes size={15} aria-hidden /> Bloco de questões
        </button>
        <button type="button" onClick={onDetectGrid} disabled={detecting}
                title="Analisa a imagem importada e sugere os blocos de questões automaticamente"
                className="btn btn-sm min-h-[40px] justify-start col-span-2 btn-secondary">
          <ScanSearch size={15} aria-hidden /> {detecting ? 'Detectando…' : 'Detectar grade'}
        </button>
        <button type="button" onClick={onDetectAnchors} disabled={detectingAnchors}
                title="Detecta e centraliza automaticamente as 4 âncoras de canto da imagem importada"
                className="btn btn-sm min-h-[40px] justify-start col-span-2 btn-secondary">
          <Crosshair size={15} aria-hidden /> {detectingAnchors ? 'Detectando…' : 'Detectar âncoras'}
        </button>
        <button type="button" onClick={onDetectPageCorners} disabled={detectingPageCorners}
                title="Detecta os 4 cantos da folha (marcadores de canto ou maior quadrilátero)"
                className="btn btn-sm min-h-[40px] justify-start col-span-2 btn-secondary">
          <Maximize size={15} aria-hidden /> {detectingPageCorners ? 'Detectando…' : 'Detectar cantos da folha'}
        </button>
        <button type="button" onClick={onManualPageCorners}
                title="Cria os 4 cantos da folha para ajuste manual (arraste os pontos no cartão)"
                className="btn btn-sm min-h-[40px] justify-start col-span-2 btn-secondary">
          <Move size={15} aria-hidden /> Ajustar cantos manualmente
        </button>
        {hasPageCorners && (
          <button type="button" onClick={onRemovePageCorners}
                  title="Remove os cantos da folha do modelo"
                  className="btn btn-sm min-h-[40px] justify-start col-span-2 btn-secondary">
              <Trash2 size={15} aria-hidden /> Remover cantos
          </button>
        )}
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
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Clique em uma âncora no cartão para editar tipo, tamanho e canto.
          </p>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Overlay SVG
// ───────────────────────────────────────────────────────────────────────────

function OverlayRegions({
  config, show, selection, zoom, onSelect, onStartDrag, onStartResize, onStartPageCorner,
}: {
  config: CustomConfig;
  show: { anchors: boolean; qr: boolean; info: boolean; bubbles: boolean };
  selection: Selection;
  zoom: number;
  onSelect: (s: Selection) => void;
  onStartDrag: (e: ReactPointerEvent<SVGElement>, kind: RegionType, id: string) => void;
  onStartResize: (e: ReactPointerEvent<SVGElement>, kind: Exclude<RegionType, 'block'>, id: string, handle: string, orig: Rect) => void;
  onStartPageCorner: (e: ReactPointerEvent<SVGElement>, index: number) => void;
}) {
  const pw = config.page_w || 1;
  const ph = config.page_h || 1;
  const sel = (kind: RegionType, id: string) => selection?.kind === kind && selection?.id === id;
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
      {show.anchors && config.anchors.map((a) => {
        const r: Rect = { x: a.x - a.size / 2, y: a.y - a.size / 2, w: a.size, h: a.size };
        return (
          <g key={a.id} onPointerDown={(e) => onStartDrag(e, 'anchor', a.id)} style={{ cursor: 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth={sel('anchor', a.id) ? stroke * 1.6 : stroke} />
            <text x={r.x * pw} y={r.y * ph - 3 / zoom} fontSize={11 / zoom} fill="#b45309">
              {a.type}{a.type === 'aruco' ? ` #${a.aruco_id ?? '?'}` : ''}{a.corner ? ` ${a.corner}` : ''}
            </text>
            {sel('anchor', a.id) && handlesFor('anchor', a.id, r)}
          </g>
        );
      })}

      {show.qr && config.qr && (() => {
        const q = config.qr;
        const r: Rect = { x: q.x, y: q.y, w: q.w, h: q.h };
        return (
          <g onPointerDown={(e) => onStartDrag(e, 'qr', q.id)} style={{ cursor: 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill="rgba(37,99,235,0.12)" stroke="#2563eb" strokeWidth={sel('qr', q.id) ? stroke * 1.6 : stroke} />
            <text x={r.x * pw} y={r.y * ph - 3 / zoom} fontSize={11 / zoom} fill="#1d4ed8">QR</text>
            {sel('qr', q.id) && handlesFor('qr', q.id, r)}
          </g>
        );
      })()}

      {show.info && config.info_regions.map((i) => {
        const r: Rect = { x: i.x, y: i.y, w: i.w, h: i.h };
        return (
          <g key={i.id} onPointerDown={(e) => onStartDrag(e, 'info', i.id)} style={{ cursor: 'move' }}>
            <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph}
                  fill="rgba(16,185,129,0.12)" stroke="#10b981" strokeWidth={sel('info', i.id) ? stroke * 1.6 : stroke} />
            <text x={r.x * pw} y={r.y * ph - 3 / zoom} fontSize={11 / zoom} fill="#047857">{i.kind}</text>
            {sel('info', i.id) && handlesFor('info', i.id, r)}
          </g>
        );
      })}

      {show.bubbles && config.questions.map((b) => {
        const bl = expandBlock(b);
        if (!bl.length) return null;
        const xs = bl.map((x) => x.x);
        const ys = bl.map((x) => x.y);
        const bx = Math.min(...xs) - b.radius;
        const by = Math.min(...ys) - b.radius;
        const bw = Math.max(...xs) + b.radius - bx;
        const bh = Math.max(...ys) + b.radius - by;
        return (
          <g key={b.id}>
            <rect x={bx * pw} y={by * ph} width={bw * pw} height={bh * ph}
                  fill="rgba(239,68,68,0.06)"
                  stroke={sel('block', b.id) ? '#dc2626' : '#ef4444'}
                  strokeWidth={sel('block', b.id) ? stroke * 1.6 : stroke}
                  strokeDasharray="5 3" style={{ cursor: 'move' }}
                  onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'block', id: b.id }); onStartDrag(e, 'block', b.id); }} />
            {bl.map((x, k) => (
              <circle key={k} cx={x.x * pw} cy={x.y * ph} r={Math.max(1.5, x.r * pw)}
                      fill="none" stroke="#ef4444" strokeWidth={1.2 / zoom} />
            ))}
            {sel('block', b.id) && (
              <text x={bx * pw} y={by * ph - 4 / zoom} fontSize={12 / zoom} fill="#b91c1c">
                Q{b.start_question}–Q{b.start_question + b.n_questions - 1}
              </text>
            )}
          </g>
        );
      })}

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
    <div className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${selection?.kind === kind && selection?.id === id ? 'bg-gray-100 dark:bg-gray-800' : ''}`}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <button type="button" className="flex-1 text-left truncate" onClick={() => setSelection({ kind, id })}>{label}</button>
      <button type="button" className="text-gray-400 hover:text-red-500" title="Excluir"
              onClick={() => onDelete(kind, id)}><Trash2 size={14} /></button>
    </div>
  );
  const empty = !config.anchors.length && !config.qr && !config.info_regions.length && !config.questions.length;
  return (
    <div className="space-y-1">
      <p className="label">Elementos</p>
      {config.anchors.map((a) => (
        <Item key={a.id} kind="anchor" id={a.id} color="#f59e0b"
              label={`Âncora ${a.type}${a.type === 'aruco' && a.aruco_id != null ? ` #${a.aruco_id}` : ''}`} />
      ))}
      {config.qr && <Item kind="qr" id={config.qr.id} color="#2563eb" label="QR Code" />}
      {config.info_regions.map((i) => <Item key={i.id} kind="info" id={i.id} color="#10b981" label={`Info · ${i.kind}`} />)}
      {config.questions.map((b) => (
        <Item key={b.id} kind="block" id={b.id} color="#ef4444"
              label={`Q${b.start_question}–Q${b.start_question + b.n_questions - 1} (${b.n_questions}×${b.labels.length})`} />
      ))}
      {empty && <p className="text-xs text-gray-400">Nada configurado ainda.</p>}
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
  config, selection, updateField,
}: {
  config: CustomConfig;
  selection: Selection;
  updateField: (patch: Partial<CustomConfig>) => void;
}) {
  if (!selection) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Selecione uma região no cartão para editar as propriedades.</p>;
  }
  const { kind, id } = selection;

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
    const setPrintField = (source: string) => {
      const others = config.print_fields.filter((f) => f.region_id !== id);
      updateField({
        print_fields: source
          ? [...others, { region_id: id, source, font_size: pf?.font_size ?? 30, align: pf?.align ?? 'left' }]
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
  return (
    <div className="space-y-2">
      <p className="font-semibold text-sm">Bloco de questões</p>
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
      <div className="grid grid-cols-2 gap-2">
        <PctInput id="p-blk-osx" label="Espaço horizontal (%)" value={b.option_step_x} onChange={(v) => upd({ option_step_x: v })} />
        <PctInput id="p-blk-qsy" label="Espaço vertical (%)" value={b.question_step_y} onChange={(v) => upd({ question_step_y: v })} />
        <PctInput id="p-blk-csx" label="Passo da coluna (%)" value={b.column_step_x ?? b.option_step_x * b.labels.length}
                  onChange={(v) => upd({ column_step_x: v })} />
        <PctInput id="p-blk-r" label="Raio da bolha (%)" value={b.radius} onChange={(v) => upd({ radius: v })} />
        <PctInput id="p-blk-fx" label="Início X (%)" value={b.first_x} onChange={(v) => upd({ first_x: v })} />
        <PctInput id="p-blk-fy" label="Início Y (%)" value={b.first_y} onChange={(v) => upd({ first_y: v })} />
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
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Diagnóstico da configuração
// ───────────────────────────────────────────────────────────────────────────

function ValidationPanel({ issues, onGoTo }: { issues: ValidationIssue[]; onGoTo: (s: Selection) => void }) {
  if (!issues.length) {
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
    return null;
  };
  return (
    <div className="space-y-1">
      <p className="label">Diagnóstico</p>
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

function ActionsPanel({ detailId }: { detailId: number }) {
  const toast = useNotify();
  const [testOpen, setTestOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [result, setResult] = useState<CustomTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [truth, setTruth] = useState('');
  const testFileRef = useRef<HTMLInputElement>(null);

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
            <option value="students">Cartões por aluno (lista)</option>
            <option value="avaliacao">Cartões da turma da prova (banco)</option>
          </Select>
        </Field>
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
