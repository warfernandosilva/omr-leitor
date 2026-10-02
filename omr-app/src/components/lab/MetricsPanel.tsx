import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import StatCard from '../ui/StatCard';
import {
  LabMetrics, LabSessionMetrics, LabSessionSummary,
  labExportCsv, labExportJson, labReclassify, labSessionMetrics,
} from '../../utils/lab-api';
import { exportSheetsToXlsx } from '../../utils/lab-truth';

interface Props {
  session: LabSessionSummary;
}

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function chartData(m: LabMetrics) {
  return [
    { nome: 'Acertos', valor: m.acertos, cor: '#10b981' },
    { nome: 'Erros', valor: m.erros - m.brancos, cor: '#ef4444' },
    { nome: 'Brancos', valor: m.brancos, cor: '#9ca3af' },
    { nome: 'Ambíguas', valor: m.ambiguas, cor: '#f59e0b' },
  ];
}

export default function MetricsPanel({ session }: Props) {
  const [m, setM] = useState<LabSessionMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [floor, setFloor] = useState(0.3);
  const [margin, setMargin] = useState(0.15);
  const [w0, setW0] = useState(0.4);
  const [w1, setW1] = useState(0.4);
  const [w2, setW2] = useState(0.2);
  const [lowConf, setLowConf] = useState('');
  const [persist, setPersist] = useState(false);
  const [sim, setSim] = useState<LabMetrics | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setM(await labSessionMetrics(session.id));
      setSim(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => { load(); }, [load]);

  const runReclassify = async () => {
    setSimBusy(true);
    setError(null);
    try {
      const j = await labReclassify(session.id, {
        floor,
        margin,
        weights: [w0, w1, w2],
        low_conf_threshold: lowConf.trim() === '' ? null : Number(lowConf),
        persist,
      });
      setSim(j.metrics);
      if (persist) setM(await labSessionMetrics(session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na reclassificação');
    } finally {
      setSimBusy(false);
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

  const shown = sim ?? m;

  return (
    <div className="space-y-6">
      {loading && <div className="card text-center py-10 text-gray-500">Calculando métricas…</div>}
      {error && <div className="callout-danger">{error}</div>}

      {m && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Com gabarito" value={m.com_gabarito} tone="info" />
            <StatCard label="Taxa de acerto" value={pct(m.taxa_acerto)} tone="success" />
            <StatCard label="Ambíguas" value={m.ambiguas} tone="warning" />
            <StatCard label="Erros de leitura" value={m.n_erro_processamento} tone={m.n_erro_processamento ? 'danger' : 'default'} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-4">Distribuição</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData(shown ?? m)} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="nome" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                      {chartData(shown ?? m).map((d, i) => <Cell key={i} fill={d.cor} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-3">
                <span>Brancos: {shown?.brancos ?? 0} ({pct(shown?.taxa_branco)})</span>
                <span>Taxa de erro: {pct(shown?.taxa_erro)}</span>
                <span>Respondidas: {shown?.respondidas ?? 0}</span>
                <span>Total: {shown?.total_questoes ?? 0} questões</span>
              </div>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">Simular reclassificação</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Usa os scores já salvos (sem reler a foto). Mudanças de CLAHE/raio exigem reprocessar.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="lab-floor">floor</label>
                  <input id="lab-floor" type="number" step="0.01" min="0" max="1" className="input" value={floor}
                    onChange={e => setFloor(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label" htmlFor="lab-margin">margin</label>
                  <input id="lab-margin" type="number" step="0.01" min="0" max="1" className="input" value={margin}
                    onChange={e => setMargin(Number(e.target.value))} />
                </div>
                <div className="col-span-2">
                  <label className="label">Pesos (média, razão escura, contraste)</label>
                  <div className="grid grid-cols-3 gap-2">
                    <input aria-label="peso média" type="number" step="0.05" className="input" value={w0} onChange={e => setW0(Number(e.target.value))} />
                    <input aria-label="peso razão escura" type="number" step="0.05" className="input" value={w1} onChange={e => setW1(Number(e.target.value))} />
                    <input aria-label="peso contraste" type="number" step="0.05" className="input" value={w2} onChange={e => setW2(Number(e.target.value))} />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="lab-lowconf">low_conf_threshold</label>
                  <input id="lab-lowconf" type="number" step="0.01" className="input" placeholder="vazio = padrão"
                    value={lowConf} onChange={e => setLowConf(e.target.value)} />
                </div>
                <label className="flex items-end gap-2 text-sm text-gray-700 dark:text-gray-300 pb-3">
                  <input type="checkbox" checked={persist} onChange={e => setPersist(e.target.checked)} className="w-4 h-4" />
                  Gravar no banco
                </label>
              </div>
              <button onClick={runReclassify} disabled={simBusy} className="btn btn-primary mt-3 min-h-[44px]">
                {simBusy ? 'Calculando…' : 'Simular'}
              </button>
              {sim && (
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 p-3 text-sm">
                  <p className="font-medium text-blue-800 dark:text-blue-200">
                    {persist ? 'Aplicado e gravado' : 'Simulação'} — acerto {pct(sim.taxa_acerto)} ({sim.acertos}/{sim.com_gabarito})
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    {sim.ambiguas} ambíguas · {sim.erros - sim.brancos} erros · {sim.brancos} brancos
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={exportXlsx} disabled={exportBusy} className="btn btn-secondary min-h-[44px]">
              Exportar XLSX
            </button>
            <button onClick={exportCsv} disabled={exportBusy} className="btn btn-secondary min-h-[44px]">
              Exportar CSV (questões)
            </button>
            <button onClick={load} className="btn btn-secondary min-h-[44px]">Recarregar</button>
          </div>
        </>
      )}
    </div>
  );
}