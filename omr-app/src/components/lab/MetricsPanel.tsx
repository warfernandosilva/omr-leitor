import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, RefreshCw, Save, Table2 } from 'lucide-react';
import StatCard from '../ui/StatCard';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import DataTable from '../ui/DataTable';
import {
  LAB_STATUS_LABEL, LabMetrics, LabReclassifyQuestion, LabReclassifyResult,
  LabSessionDetail, LabSessionMetrics, LabSessionSummary,
  labExportCsv, labExportJson, labReclassify, labSessionMetrics, labStatusTone,
} from '../../utils/lab-api';
import { exportSheetsToXlsx } from '../../utils/lab-truth';

interface Props {
  session: LabSessionSummary;
  /** Sessão carregada (questões + componentes salvos): base do diff e do histograma. */
  detail: LabSessionDetail | null;
}

const PREVIEW_DEBOUNCE_MS = 250;
const HIST_BINS = 20;

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function chartData(m: LabMetrics) {
  return [
    { nome: 'Acertos', valor: m.acertos, cor: '#16A36A' },
    { nome: 'Erros', valor: m.erros - m.brancos, cor: '#DC3545' },
    { nome: 'Brancos', valor: m.brancos, cor: '#9ca3af' },
    { nome: 'Ambíguas', valor: m.ambiguas, cor: '#F59E0B' },
  ];
}

type QuestionBase = { status: string; detected: string | null };

const keyOf = (imageId: number, question: number) => `${imageId}:${question}`;

function labelOf(q: { status: string; detected: string | null }): string {
  const label = LAB_STATUS_LABEL[q.status as keyof typeof LAB_STATUS_LABEL] ?? q.status;
  return q.detected ? `${label} · ${q.detected}` : label;
}

/** Resultado da questão frente ao gabarito (cor da coluna "Efeito"). */
function outcome(q: { status: string; detected: string | null; truth: string | null }): 'good' | 'bad' | 'mid' {
  if (!q.truth) return 'mid';
  if (q.status === 'ok' && q.detected === q.truth) return 'good';
  if (q.status === 'blank' || q.status === 'ok') return 'bad';
  return 'mid';
}

export default function MetricsPanel({ session, detail }: Props) {
  const [m, setM] = useState<LabSessionMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [floor, setFloor] = useState(0.3);
  const [margin, setMargin] = useState(0.15);
  const [w0, setW0] = useState(0.4);
  const [w1, setW1] = useState(0.4);
  const [w2, setW2] = useState(0.2);
  const [lowConf, setLowConf] = useState('');
  const [sim, setSim] = useState<LabReclassifyResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  // Base do diff: a classificação gravada (detail) ou a última gravação feita aqui.
  const [savedBase, setSavedBase] = useState<Map<string, QuestionBase> | null>(null);
  // O simulador nasce nos thresholds que a leitura realmente usou (não em 0.30/0.15).
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [perImageFloor, setPerImageFloor] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setM(await labSessionMetrics(session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => { load(); }, [load]);

  // Trocar de sessão zera o preview (os componentes salvos são outros).
  useEffect(() => {
    setSavedBase(null);
    setSim(null);
    setDefaultsApplied(false);
    setPerImageFloor(false);
  }, [session.id]);

  // Inicia os sliders no que a leitura usou: floor gravado da primeira foto e
  // margin do modelo (Herby 0.15, demais 0.22). Assim "0 mudanças" = produção.
  useEffect(() => {
    if (!m || m.session_id !== session.id || defaultsApplied) return;
    if (m.defaults?.floor != null) setFloor(m.defaults.floor);
    if (m.defaults) setMargin(m.defaults.margin);
    // Adaptativo varia por foto: nasce reproduzindo o floor de cada uma.
    setPerImageFloor(
      m.defaults?.floor_source === 'adaptive' || (m.defaults?.floor_values.length ?? 0) > 1,
    );
    setDefaultsApplied(true);
  }, [m, session.id, defaultsApplied]);

  // Preview em TEMPO REAL: cada mudança de parâmetro reclassifica sobre os
  // componentes salvos (sem reler a foto) e atualiza métricas + diff.
  // O contador de sequência descarta resposta fora de ordem enquanto arrasta.
  const ready = defaultsApplied && m?.session_id === session.id;
  const seq = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const id = ++seq.current;
    setSimBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const j = await labReclassify(session.id, {
          floor,
          margin,
          weights: [w0, w1, w2],
          low_conf_threshold: lowConf.trim() === '' ? null : Number(lowConf),
          use_saved_floor: perImageFloor,
        });
        if (id !== seq.current) return;
        setSim(j);
        setError(null);
      } catch (err) {
        if (id === seq.current) setError(err instanceof Error ? err.message : 'Falha na simulação');
      } finally {
        if (id === seq.current) setSimBusy(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [session.id, floor, margin, w0, w1, w2, lowConf, perImageFloor, ready]);

  const baseline = useMemo(() => {
    const map = new Map<string, QuestionBase>();
    for (const img of detail?.images ?? [])
      for (const q of img.questions) map.set(keyOf(img.id, q.question), { status: q.status, detected: q.detected });
    return map;
  }, [detail]);

  const base = savedBase ?? baseline;

  const filenames = useMemo(
    () => new Map((detail?.images ?? []).map(img => [img.id, img.filename])),
    [detail],
  );

  const changes = useMemo(() => {
    if (!sim) return [];
    const out: { row: LabReclassifyQuestion; before: QuestionBase; image: string }[] = [];
    for (const row of sim.questions) {
      const before = base.get(keyOf(row.image_id, row.question));
      if (before && (before.status !== row.status || before.detected !== row.detected))
        out.push({ row, before, image: filenames.get(row.image_id) ?? `#${row.image_id}` });
    }
    return out;
  }, [sim, base, filenames]);

  // Histograma dos scores (recalculado com os pesos atuais) × linha do floor.
  const scores = useMemo(() => {
    const out: number[] = [];
    for (const img of detail?.images ?? [])
      for (const q of img.questions)
        for (const o of q.options ?? [])
          out.push(w0 * o.mean_intensity + w1 * o.dark_ratio + w2 * o.contrast);
    return out;
  }, [detail, w0, w1, w2]);

  const hist = useMemo(() => {
    const counts = new Array<number>(HIST_BINS).fill(0);
    for (const s of scores) counts[Math.min(HIST_BINS - 1, Math.max(0, Math.floor(s * HIST_BINS)))] += 1;
    return { counts, max: Math.max(1, ...counts) };
  }, [scores]);

  const belowFloor = useMemo(() => scores.filter(s => s < floor).length, [scores, floor]);

  const persistNow = async () => {
    setSaving(true);
    setError(null);
    try {
      const j = await labReclassify(session.id, {
        floor,
        margin,
        weights: [w0, w1, w2],
        low_conf_threshold: lowConf.trim() === '' ? null : Number(lowConf),
        use_saved_floor: perImageFloor,
        persist: true,
      });
      setSim(j);
      setSavedBase(new Map(j.questions.map(q => [keyOf(q.image_id, q.question), { status: q.status, detected: q.detected }])));
      setM(await labSessionMetrics(session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gravar a reclassificação');
    } finally {
      setSaving(false);
    }
  };

  const exportXlsx = async () => {
    setExportBusy(true);
    setError(null);
    try {
      const data = await labExportJson(session.id);
      exportSheetsToXlsx(data.sheets, `lab-sessao-${session.id}.xlsx`, ['metricas', 'questoes', 'scores']);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no export');
    } finally {
      setExportBusy(false);
    }
  };

  const exportCsv = async () => {
    setExportBusy(true);
    setError(null);
    try {
      await labExportCsv(session.id, `lab-sessao-${session.id}-questoes.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no export CSV');
    } finally {
      setExportBusy(false);
    }
  };

  const shown = sim?.metrics ?? m;
  const delta = sim && m ? sim.metrics.acertos - m.acertos : 0;
  const floorValues = m?.defaults?.floor_values ?? [];
  // Floor adaptativo varia por foto: um slider único não reproduz a leitura.
  const showPerImageFloor = floorValues.length > 1 || m?.defaults?.floor_source === 'adaptive';
  const savedFloorText = m?.defaults?.floor == null ? null
    : floorValues.length > 1
      ? `${floorValues.map(v => v.toFixed(2)).join(' · ')} (por foto)`
      : `${m.defaults.floor.toFixed(2)} (${m.defaults.floor_source === 'adaptive' ? 'adaptativo' : 'fixo'})`;

  return (
    <div className="space-y-6">
      {loading && <div className="card text-center py-10 text-gray-500 dark:text-gray-400" role="status">Calculando métricas…</div>}
      {error && <div className="callout-danger">{error}</div>}

      {m && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Com gabarito" value={shown?.com_gabarito ?? 0} tone="info" />
            <StatCard label="Taxa de acerto" value={pct(shown?.taxa_acerto)} tone="success" />
            <StatCard label="Ambíguas" value={shown?.ambiguas ?? 0} tone="warning" />
            <StatCard label="Erros de leitura" value={m.n_erro_processamento} tone={m.n_erro_processamento ? 'danger' : 'default'} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-4">Distribuição</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData(shown ?? m)} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="nome" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} />
                    <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                      {chartData(shown ?? m).map((d, i) => <Cell key={i} fill={d.cor} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400 mt-3">
                <span>Brancos: {shown?.brancos ?? 0} ({pct(shown?.taxa_branco)})</span>
                <span>Taxa de erro: {pct(shown?.taxa_erro)}</span>
                <span>Respondidas: {shown?.respondidas ?? 0}</span>
                <span>Total: {shown?.total_questoes ?? 0} questões</span>
              </div>
            </div>

            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100">Simular reclassificação</h3>
                {simBusy && <span className="text-xs text-gray-500 dark:text-gray-400" role="status">simulando…</span>}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Atualiza ao arrastar, usando os scores já salvos (sem reler a foto). Os sliders partem do que a leitura
                usou, então “0 mudanças” = produção. Mudanças de CLAHE/raio exigem reprocessar.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={perImageFloor ? 'floor · por foto' : `floor · ${floor.toFixed(2)}`} htmlFor="lab-floor">
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min={0} max={1} step={0.01} value={floor}
                      onChange={e => setFloor(Number(e.target.value))}
                      disabled={perImageFloor}
                      aria-label="floor (arrastar)" className="flex-1 accent-brand-500 disabled:opacity-40"
                    />
                    <div className="w-20 shrink-0">
                      <Input id="lab-floor" type="number" step="0.01" min="0" max="1" value={floor}
                        disabled={perImageFloor}
                        onChange={e => setFloor(Number(e.target.value))} />
                    </div>
                  </div>
                </Field>
                <Field label={`margin · ${margin.toFixed(2)}`} htmlFor="lab-margin">
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min={0} max={1} step={0.01} value={margin}
                      onChange={e => setMargin(Number(e.target.value))}
                      aria-label="margin (arrastar)" className="flex-1 accent-brand-500"
                    />
                    <div className="w-20 shrink-0">
                      <Input id="lab-margin" type="number" step="0.01" min="0" max="1" value={margin}
                        onChange={e => setMargin(Number(e.target.value))} />
                    </div>
                  </div>
                </Field>
                <div className="col-span-2">
                  <span className="label">Pesos (média, razão escura, contraste)</span>
                  <div className="grid grid-cols-3 gap-2">
                    <Input aria-label="peso média" type="number" step="0.05" value={w0} onChange={e => setW0(Number(e.target.value))} />
                    <Input aria-label="peso razão escura" type="number" step="0.05" value={w1} onChange={e => setW1(Number(e.target.value))} />
                    <Input aria-label="peso contraste" type="number" step="0.05" value={w2} onChange={e => setW2(Number(e.target.value))} />
                  </div>
                </div>
                <Field label="low_conf_threshold" htmlFor="lab-lowconf">
                  <Input id="lab-lowconf" type="number" step="0.01" placeholder="vazio = padrão"
                    value={lowConf} onChange={e => setLowConf(e.target.value)} />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs">
                {savedFloorText && (
                  <span className="text-gray-500 dark:text-gray-400">
                    Leitura original: <span className="tabular-nums">{savedFloorText}</span>
                    {' · margin '}<span className="tabular-nums">{m?.defaults?.margin?.toFixed(2)}</span>
                  </span>
                )}
                {showPerImageFloor && (
                  <label className="flex items-center gap-2 cursor-pointer text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox" checked={perImageFloor}
                      onChange={e => setPerImageFloor(e.target.checked)}
                      className="accent-brand-500"
                    />
                    floor por foto (como foi lido)
                  </label>
                )}
              </div>

              {detail && scores.length > 0 && (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Scores × floor</h4>
                    <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {perImageFloor
                        ? `${scores.length} scores · floor por foto`
                        : `${belowFloor} de ${scores.length} abaixo do floor`}
                    </span>
                  </div>
                  <div className="relative flex items-end gap-px h-28 border-b border-line dark:border-gray-800" aria-hidden>
                    {hist.counts.map((n, i) => (
                      <div
                        key={i}
                        title={`${(i / HIST_BINS).toFixed(2)}–${((i + 1) / HIST_BINS).toFixed(2)}: ${n}`}
                        className="flex-1 bg-brand-500/60 rounded-t-sm"
                        style={{ height: `${Math.max(1, (n / hist.max) * 100)}%` }}
                      />
                    ))}
                    {!perImageFloor && (
                      <div className="absolute inset-y-0 w-0.5 bg-danger-500" style={{ left: `${floor * 100}%` }} />
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                    <span>0.00</span><span>0.25</span><span>0.50</span><span>0.75</span><span>1.00</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {perImageFloor
                      ? 'Sem linha única: cada foto usa o floor com que foi lida (adaptativo). Desmarque para simular um floor global.'
                      : 'Linha vermelha = floor; abaixo dela nenhuma bolha conta como marcada.'}
                  </p>
                </div>
              )}

              {sim && (
                <div className="callout-info mt-4 text-sm">
                  <p className="font-medium">
                    Acerto {pct(sim.metrics.taxa_acerto)} ({sim.metrics.acertos}/{sim.metrics.com_gabarito})
                    {delta !== 0 && (
                      <span className={delta > 0 ? 'text-success-600 dark:text-success-100' : 'text-danger-600 dark:text-danger-100'}>
                        {' '}({delta > 0 ? '+' : ''}{delta} vs. gravado)
                      </span>
                    )}
                  </p>
                  <p className="text-xs mt-1">
                    {sim.metrics.ambiguas} ambíguas · {sim.metrics.brancos} brancos · {changes.length} questão(ões) mudaram
                  </p>
                </div>
              )}
            </div>
          </div>

          {sim && (
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100">O que muda com estes valores</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Comparação com a classificação gravada ({changes.length} alterada(s)). Nada é gravado sem o botão.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={persistNow} loading={saving} icon={<Save size={15} aria-hidden />}>
                  Gravar no banco
                </Button>
              </div>
              <DataTable
                ariaLabel="Questões alteradas pela simulação"
                minWidth={620}
                pageSize={10}
                rows={changes}
                rowKey={c => `${c.row.image_id}:${c.row.question}`}
                empty="Nenhuma questão muda com estes valores."
                columns={[
                  {
                    key: 'imagem', header: 'Imagem',
                    render: c => <span className="text-xs text-gray-600 dark:text-gray-300 block max-w-[180px] truncate">{c.image}</span>,
                  },
                  { key: 'questao', header: 'Questão', render: c => <span className="tabular-nums font-medium">{c.row.question}</span> },
                  { key: 'antes', header: 'Antes', render: c => <Badge tone={labStatusTone(c.before.status)}>{labelOf(c.before)}</Badge> },
                  { key: 'depois', header: 'Depois', render: c => <Badge tone={labStatusTone(c.row.status)}>{labelOf(c.row)}</Badge> },
                  {
                    key: 'efeito', header: 'Efeito',
                    render: c => {
                      const o = outcome(c.row);
                      return (
                        <span className={
                          o === 'good' ? 'text-success-600 dark:text-success-100'
                            : o === 'bad' ? 'text-danger-600 dark:text-danger-100'
                              : 'text-warning-600 dark:text-warning-100'
                        }>
                          {o === 'good' ? 'acertou' : o === 'bad' ? 'errou' : 'ambígua'}
                        </span>
                      );
                    },
                  },
                ]}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportXlsx} loading={exportBusy} icon={<Table2 size={16} aria-hidden />}>
              Exportar XLSX
            </Button>
            <Button variant="secondary" onClick={exportCsv} loading={exportBusy} icon={<Download size={16} aria-hidden />}>
              Exportar CSV (questões)
            </Button>
            <Button variant="secondary" onClick={load} icon={<RefreshCw size={16} aria-hidden />}>Recarregar</Button>
          </div>
        </>
      )}
    </div>
  );
}
