import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Play, RefreshCw, Table2 } from 'lucide-react';
import StatCard from '../ui/StatCard';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Button from '../ui/Button';
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
    { nome: 'Acertos', valor: m.acertos, cor: '#16A36A' },
    { nome: 'Erros', valor: m.erros - m.brancos, cor: '#DC3545' },
    { nome: 'Brancos', valor: m.brancos, cor: '#9ca3af' },
    { nome: 'Ambíguas', valor: m.ambiguas, cor: '#F59E0B' },
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
      {loading && <div className="card text-center py-10 text-gray-500 dark:text-gray-400" role="status">Calculando métricas…</div>}
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
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-1">Simular reclassificação</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Usa os scores já salvos (sem reler a foto). Mudanças de CLAHE/raio exigem reprocessar.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="floor" htmlFor="lab-floor">
                  <Input id="lab-floor" type="number" step="0.01" min="0" max="1" value={floor}
                    onChange={e => setFloor(Number(e.target.value))} />
                </Field>
                <Field label="margin" htmlFor="lab-margin">
                  <Input id="lab-margin" type="number" step="0.01" min="0" max="1" value={margin}
                    onChange={e => setMargin(Number(e.target.value))} />
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
                <label className="flex items-end gap-2 text-sm text-gray-600 dark:text-gray-300 pb-3 min-h-[44px]">
                  <input type="checkbox" checked={persist} onChange={e => setPersist(e.target.checked)} className="w-4 h-4 accent-brand-500" />
                  Gravar no banco
                </label>
              </div>
              <Button onClick={runReclassify} loading={simBusy} icon={<Play size={16} aria-hidden />} className="mt-3">
                Simular
              </Button>
              {sim && (
                <div className="callout-info mt-4 text-sm">
                  <p className="font-medium">
                    {persist ? 'Aplicado e gravado' : 'Simulação'} — acerto {pct(sim.taxa_acerto)} ({sim.acertos}/{sim.com_gabarito})
                  </p>
                  <p className="text-xs mt-1">
                    {sim.ambiguas} ambíguas · {sim.erros - sim.brancos} erros · {sim.brancos} brancos
                  </p>
                </div>
              )}
            </div>
          </div>

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