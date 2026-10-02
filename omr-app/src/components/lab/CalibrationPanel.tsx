import { useCallback, useEffect, useState } from 'react';
import DataTable from '../ui/DataTable';
import {
  LabCandidate, LabConfig, LabConfigList, LabSessionSummary,
  labCalibrate, labCreateConfig, labDeactivateConfig, labListConfigs, labPublishConfig, labRollbackConfig,
} from '../../utils/lab-api';

interface Props {
  session: LabSessionSummary;
  isAdmin: boolean;
}

function parseGrid(text: string): number[] | undefined {
  const nums = text.split(/[,;\s]+/).map(t => Number(t)).filter(n => Number.isFinite(n));
  return nums.length ? nums : undefined;
}

function parseWeights(text: string): number[][] | undefined {
  const sets = text.split(';').map(s => s.trim()).filter(Boolean);
  const out: number[][] = [];
  for (const s of sets) {
    const nums = s.split(/[,;\s]+/).map(t => Number(t)).filter(n => Number.isFinite(n));
    if (nums.length === 3) out.push(nums);
  }
  return out.length ? out : undefined;
}

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

export default function CalibrationPanel({ session, isAdmin }: Props) {
  const [floorGrid, setFloorGrid] = useState('0.20,0.25,0.30,0.35,0.40,0.45');
  const [marginGrid, setMarginGrid] = useState('0.10,0.15,0.20,0.22,0.25,0.30');
  const [weightsText, setWeightsText] = useState('0.4,0.4,0.2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [best, setBest] = useState<LabCandidate | null>(null);
  const [results, setResults] = useState<LabCandidate[]>([]);
  const [runId, setRunId] = useState<number | null>(null);

  const [configs, setConfigs] = useState<LabConfigList | null>(null);
  const [cfgBusy, setCfgBusy] = useState(false);

  const loadConfigs = useCallback(async () => {
    try {
      setConfigs(await labListConfigs());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao listar configurações');
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = await labCalibrate(session.id, {
        floor_grid: parseGrid(floorGrid),
        margin_grid: parseGrid(marginGrid),
        weights_grid: parseWeights(weightsText),
      });
      setBest(j.best);
      setResults(j.results);
      setRunId(j.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na calibração');
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    if (!best) return;
    const nome = prompt('Nome da configuração:', `floor ${best.floor} / margin ${best.margin}`);
    if (!nome) return;
    setCfgBusy(true);
    setError(null);
    try {
      await labCreateConfig({
        nome,
        template: session.template,
        params: {
          floor: best.floor,
          margin: best.margin,
          weights: best.weights,
          low_conf_threshold: best.low_conf_threshold ?? null,
        },
        metrics: best as unknown as Record<string, unknown>,
        source_session_id: session.id,
        source_run_id: runId,
      });
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar a configuração');
    } finally {
      setCfgBusy(false);
    }
  };

  const doPublish = async (cfg: LabConfig) => {
    if (!confirm(`Publicar "${cfg.nome}"?\n\nGrava data/active_config.json no servidor. O motor de produção atual NÃO muda sozinho — a config vale para os fluxos que a solicitarem.`)) return;
    setCfgBusy(true);
    try {
      await labPublishConfig(cfg.id);
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao publicar');
    } finally {
      setCfgBusy(false);
    }
  };

  const doRollback = async (cfg: LabConfig) => {
    setCfgBusy(true);
    try {
      await labRollbackConfig(cfg.id);
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no rollback');
    } finally {
      setCfgBusy(false);
    }
  };

  const doDeactivate = async () => {
    if (!confirm('Remover a configuração publicada (voltar ao default do motor)?')) return;
    setCfgBusy(true);
    try {
      await labDeactivateConfig();
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao desativar');
    } finally {
      setCfgBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Calibrar thresholds</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Varre floor × margin × pesos sobre as questões com gabarito (usa os scores salvos). Devolve os melhores candidatos para publicar.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="lab-floor-grid">Grid de floor</label>
            <input id="lab-floor-grid" className="input font-mono text-xs" value={floorGrid} onChange={e => setFloorGrid(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="lab-margin-grid">Grid de margin</label>
            <input id="lab-margin-grid" className="input font-mono text-xs" value={marginGrid} onChange={e => setMarginGrid(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="lab-weights-grid">Pesos (separe conjuntos com ;)</label>
            <input id="lab-weights-grid" className="input font-mono text-xs" value={weightsText} onChange={e => setWeightsText(e.target.value)} />
          </div>
        </div>
        <button onClick={run} disabled={busy} className="btn btn-primary mt-4 min-h-[44px]">
          {busy ? 'Varrendo…' : 'Rodar calibração'}
        </button>
        {error && <div className="callout-danger mt-4">{error}</div>}

        {best && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-emerald-800 dark:text-emerald-200">
                  Melhor: floor {best.floor} · margin {best.margin} · pesos [{best.weights.join(', ')}]
                </p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  Acerto {pct(best.taxa_acerto)} ({best.acertos}/{best.com_gabarito}) · {best.ambiguas} ambíguas · {best.erros} erros
                </p>
              </div>
              <button onClick={saveConfig} disabled={cfgBusy} className="btn btn-success min-h-[44px]">
                Salvar como configuração
              </button>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-5">
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">Top candidatos (até 50)</h4>
            <DataTable<LabCandidate>
              minWidth={620}
              rows={results}
              rowKey={(r, i) => `${r.floor}-${r.margin}-${i}`}
              columns={[
                { key: 'floor', header: 'floor', render: r => <span className="font-mono text-xs">{r.floor}</span> },
                { key: 'margin', header: 'margin', render: r => <span className="font-mono text-xs">{r.margin}</span> },
                { key: 'weights', header: 'pesos', render: r => <span className="font-mono text-xs">[{r.weights.join(',')}]</span> },
                { key: 'acerto', header: 'acerto', render: r => <span className="text-emerald-600 dark:text-emerald-400 font-medium">{pct(r.taxa_acerto)}</span> },
                { key: 'acertos', header: 'acertos', render: r => <span className="text-xs">{r.acertos}/{r.com_gabarito}</span> },
                { key: 'amb', header: 'ambíguas', render: r => <span className="text-xs text-amber-600">{r.ambiguas}</span> },
                { key: 'erros', header: 'erros', render: r => <span className="text-xs text-red-600">{r.erros}</span> },
              ]}
            />
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Configurações publicadas</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {configs?.active_file
                ? `Arquivo ativo: ${JSON.stringify(configs.active_file)}`
                : 'Nenhuma configuração publicada — o motor está no default.'}
            </p>
          </div>
          {isAdmin && (
            <button onClick={doDeactivate} disabled={cfgBusy} className="btn btn-sm btn-secondary min-h-[44px]">
              Remover config publicada
            </button>
          )}
        </div>

        {!configs || configs.configs.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma configuração salva ainda.</p>
        ) : (
          <DataTable<LabConfig>
            minWidth={700}
            rows={configs.configs}
            rowKey={c => String(c.id)}
            columns={[
              {
                key: 'nome',
                header: 'Nome',
                render: c => (
                  <div>
                    <span className="font-medium text-gray-900 dark:text-white">{c.nome}</span>
                    {c.ativa && <span className="badge-success ml-2">ativa</span>}
                  </div>
                ),
              },
              { key: 'template', header: 'Modelo', render: c => <span className="text-xs">{c.template ?? 'global'}</span> },
              {
                key: 'params',
                header: 'Parâmetros',
                render: c => <span className="font-mono text-xs text-gray-500">{JSON.stringify(c.params)}</span>,
              },
              {
                key: 'acoes',
                header: 'Ações',
                className: 'text-right',
                render: c => (
                  <div className="flex justify-end gap-1">
                    <button onClick={() => doPublish(c)} disabled={cfgBusy || c.ativa} className="btn btn-sm btn-secondary">
                      Publicar
                    </button>
                    <button onClick={() => doRollback(c)} disabled={cfgBusy || c.ativa} className="btn btn-sm btn-secondary">
                      Rollback
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}