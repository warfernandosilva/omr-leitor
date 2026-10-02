import { useCallback, useEffect, useState } from 'react';
import { AppView } from '../types';
import { useAuth } from '../context/AuthContext';
import LabTabs, { LabTab } from '../components/lab/LabTabs';
import SessionsPanel from '../components/lab/SessionsPanel';
import UploadPanel from '../components/lab/UploadPanel';
import TruthPanel from '../components/lab/TruthPanel';
import ReviewPanel from '../components/lab/ReviewPanel';
import MetricsPanel from '../components/lab/MetricsPanel';
import CalibrationPanel from '../components/lab/CalibrationPanel';
import {
  LabSessionCreated, LabSessionDetail, LabSessionSummary,
  labGetSession, labListSessions,
} from '../utils/lab-api';

interface Props {
  onNavigate: (view: AppView) => void;
}

function toSummary(detail: LabSessionDetail): LabSessionSummary {
  return {
    id: detail.id,
    nome: detail.nome,
    descricao: detail.descricao,
    template: detail.template,
    questions_per_subject: detail.questions_per_subject,
    layout_mode: detail.layout_mode,
    adaptive: detail.adaptive,
    n_images: detail.images.length,
    n_erro: detail.images.filter(i => i.status === 'error').length,
  };
}

export default function LabPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<LabTab>('sessoes');
  const [sessions, setSessions] = useState<LabSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LabSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await labListSessions();
      setSessions(list);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar as sessões');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      setDetail(await labGetSession(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir a sessão');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const select = useCallback((id: number, switchTo?: LabTab) => {
    setSelectedId(id);
    setDetail(null);
    loadDetail(id);
    if (switchTo) setTab(switchTo);
  }, [loadDetail]);

  const onCreated = useCallback(async (created: LabSessionCreated) => {
    await loadSessions();
    select(created.id, 'coleta');
  }, [loadSessions, select]);

  const onDeleted = useCallback((id: number) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) { setSelectedId(null); setDetail(null); setTab('sessoes'); }
  }, [selectedId]);

  const refreshSelected = useCallback(() => {
    if (selectedId != null) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const summary = detail ? toSummary(detail) : sessions.find(s => s.id === selectedId) ?? null;

  const needsSession = tab !== 'sessoes' && tab !== 'calibracao';

  return (
    <div>
      <LabTabs
        active={tab}
        onChange={setTab}
        badges={detail ? { revisao: detail.images.length } : undefined}
      />

      {error && (
        <div className="callout-danger mb-4">
          {error}
          <button onClick={() => onNavigate('home')} className="btn btn-sm btn-secondary mt-3">Voltar ao início</button>
        </div>
      )}

      {tab === 'sessoes' && (
        <SessionsPanel
          sessions={sessions}
          loading={loading}
          selectedId={selectedId}
          onSelect={id => select(id)}
          onCreated={onCreated}
          onDeleted={onDeleted}
        />
      )}

      {needsSession && !selectedId && (
        <div className="card text-center py-12">
          <p className="text-gray-600 dark:text-gray-300 font-medium">Escolha uma sessão</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Abra uma sessão na aba <strong>Sessões</strong> (ou crie uma nova) para continuar.
          </p>
          <button onClick={() => setTab('sessoes')} className="btn btn-primary mt-4 min-h-[44px]">Ir para Sessões</button>
        </div>
      )}

      {needsSession && selectedId && detailLoading && !detail && (
        <div className="card text-center py-10 text-gray-500">Abrindo sessão…</div>
      )}

      {needsSession && summary && (
        <>
          {tab === 'coleta' && (
            <div className="space-y-6">
              <div className="card flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">{summary.nome}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {summary.template} · {summary.n_images} foto(s) · {detail?.ground_truth ? 'gabarito ok' : 'sem gabarito'}
                  </p>
                </div>
                <button onClick={refreshSelected} className="btn btn-sm btn-secondary min-h-[44px]">Atualizar</button>
              </div>
              <UploadPanel session={summary} onUploaded={refreshSelected} />
              <TruthPanel
                session={summary}
                currentTruth={detail?.ground_truth ?? null}
                onSaved={truth => setDetail(prev => (prev ? { ...prev, ground_truth: truth } : prev))}
              />
            </div>
          )}

          {tab === 'revisao' && detail && <ReviewPanel images={detail.images} />}
          {tab === 'revisao' && !detail && detailLoading && <div className="card text-center py-10 text-gray-500">Carregando fotos…</div>}

          {tab === 'metricas' && <MetricsPanel session={summary} />}
        </>
      )}

      {tab === 'calibracao' && (
        summary ? (
          <CalibrationPanel session={summary} isAdmin={user?.role === 'admin'} />
        ) : (
          <div className="card text-center py-12">
            <p className="text-gray-600 dark:text-gray-300 font-medium">Selecione uma sessão para calibrar</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              A calibração usa as questões e o gabarito de uma sessão.
            </p>
            <button onClick={() => setTab('sessoes')} className="btn btn-primary mt-4 min-h-[44px]">Ir para Sessões</button>
          </div>
        )
      )}
    </div>
  );
}