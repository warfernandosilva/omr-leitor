import { useRef, useState } from 'react';
import {
  Activity, Bell, Bot, ChevronRight, Database, Download, FileUp, Info, Printer,
  ScanLine, Table2, Trash2, TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppView } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  adminDownloadBackup, adminRestoreBackup, getApiBase, saveBlob,
  loadAdaptiveFlag, saveAdaptiveFlag, testConnection,
  type ConnectionTest, type RestoreCounts,
} from '../utils/api';
import {
  clearTelemetryLog, isTelemetryEnabled, readTelemetryLog,
  setTelemetryEnabled, telemetryCsv,
} from '../utils/telemetry';
import {
  getAiStatus, isAiAssistEnabled, setAiAssistEnabled, type AiStatus,
} from '../utils/ai-assist';
import { getResults } from '../utils/storage';
import { pendingFromResults } from '../utils/pending';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

interface Props {
  onNavigate: (view: AppView) => void;
}

function Row({ icon: Icon, title, desc, action }: {
  icon: LucideIcon; title: string; desc: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 min-h-[64px]">
      <span className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-600 dark:text-brand-200 shrink-0" aria-hidden>
        <Icon size={18} strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink dark:text-gray-100">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{desc}</p>
      </div>
      {action}
    </div>
  );
}

/** Configurações: preferências reais, backup (admin) e informações do app. */
export default function SettingsPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [adaptive, setAdaptive] = useState(() => loadAdaptiveFlag());
  const [connTest, setConnTest] = useState<ConnectionTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreCounts, setRestoreCounts] = useState<RestoreCounts | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [telemetry, setTelemetry] = useState(() => isTelemetryEnabled());
  const [telemetryCount, setTelemetryCount] = useState(() => readTelemetryLog().length);
  const [telemetryMsg, setTelemetryMsg] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(() => isAiAssistEnabled());
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = pendingFromResults(getResults(undefined, user?.id));

  const toggleTelemetry = (enabled: boolean) => {
    setTelemetry(enabled);
    setTelemetryEnabled(enabled);
    setTelemetryMsg(enabled
      ? 'Telemetria ligada: as próximas leituras serão registradas neste aparelho.'
      : 'Telemetria desligada. Os registros existentes continuam aqui até você limpá-los.');
  };

  const exportTelemetry = () => {
    const entries = readTelemetryLog();
    if (!entries.length) {
      setTelemetryMsg('Não há registros para exportar.');
      return;
    }
    // BOM para o Excel reconhecer UTF-8 nos acentos.
    const csv = `\uFEFF${telemetryCsv(entries)}`;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `telemetria-omr-${stamp}.csv`);
    setTelemetryMsg(`${entries.length} registro(s) exportados.`);
  };

  const clearTelemetry = () => {
    clearTelemetryLog();
    setTelemetryCount(0);
    setTelemetryMsg('Registros de telemetria apagados.');
  };

  const testAi = async () => {
    setAiTesting(true);
    try {
      setAiStatus(await getAiStatus());
    } catch (err) {
      setAiStatus({
        available: false,
        url: '',
        model: '',
        models: [],
        error: err instanceof Error ? err.message : 'Falha ao falar com o backend.',
      });
    } finally {
      setAiTesting(false);
    }
  };

  const doDownload = async () => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const name = await adminDownloadBackup();
      setBackupMsg(`Backup salvo: ${name}`);
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : 'Falha ao gerar backup.');
    } finally {
      setBackupBusy(false);
    }
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const r = await adminRestoreBackup(restoreFile, true);
      setRestoreCounts(r.counts ?? null);
      setBackupMsg(r.restored
        ? `Banco restaurado (${r.counts ? `${r.counts.avaliacoes} provas, ${r.counts.alunos} alunos, ${r.counts.gabaritos} gabaritos` : 'ok'}).`
        : (r.error || 'Restauração não concluída.'));
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : 'Falha na restauração.');
    } finally {
      setBackupBusy(false);
      setConfirmRestore(false);
      setRestoreFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Configurações"
        subtitle="Preferências, backup e informações do aplicativo"
        crumbs={[{ label: 'Sistema' }, { label: 'Configurações' }]}
      />

      <div className="card card-pad-none divide-y divide-line dark:divide-gray-800">
        <Row
          icon={ScanLine}
          title="Preferências da leitura"
          desc={adaptive ? 'Limiar adaptativo por foto (experimental)' : 'Limiar fixo calibrado'}
          action={
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={adaptive}
                onChange={e => { setAdaptive(e.target.checked); saveAdaptiveFlag(e.target.checked); }}
                className="w-5 h-5 accent-brand-500"
                aria-label="Usar limiar adaptativo por foto"
              />
              Adaptativo
            </label>
          }
        />
        <Row
          icon={Printer}
          title="Impressão de gabaritos"
          desc="Gerar o cartão-resposta em PDF para impressão"
          action={<Button size="sm" variant="secondary" onClick={() => onNavigate('generate-card')} className="min-h-[44px]">Abrir <ChevronRight size={15} aria-hidden /></Button>}
        />
        <Row
          icon={Table2}
          title="Exportação de resultados"
          desc="Baixar CSV ou XLSX por prova, turma e período"
          action={<Button size="sm" variant="secondary" onClick={() => onNavigate('reports')} className="min-h-[44px]">Abrir <ChevronRight size={15} aria-hidden /></Button>}
        />
        <Row
          icon={Bell}
          title="Notificações"
          desc={pending.length > 0 ? `${pending.length} revisão(ões) pendente(s) no sino` : 'Revisões pendentes aparecem no sino do cabeçalho'}
          action={<Button size="sm" variant="secondary" onClick={() => onNavigate('pending')} className="min-h-[44px]">Ver fila <ChevronRight size={15} aria-hidden /></Button>}
        />
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={16} className="text-brand-600 dark:text-brand-200" aria-hidden />
          <h2 className="text-base font-semibold text-ink dark:text-white">Telemetria local (opt-in)</h2>
        </div>
        <p className="field-helper">
          Registra métricas das leituras (acertos, falhas, tempo) <strong>somente neste aparelho</strong>.
          Nada é enviado para servidores. Desligada por padrão.
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 min-h-[44px] cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={telemetry}
            onChange={e => toggleTelemetry(e.target.checked)}
            className="w-5 h-5 accent-brand-500"
            aria-label="Ativar telemetria local das leituras"
          />
          Ativar telemetria neste aparelho
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {telemetryCount} registro(s) guardado(s){telemetryCount > 0 ? ' (máximo 500)' : ''}.
        </p>
        {telemetryMsg && (
          <p className="callout-info mt-3" role="status">{telemetryMsg}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <Button
            variant="secondary"
            onClick={exportTelemetry}
            disabled={telemetryCount === 0}
            icon={<Download size={15} aria-hidden />}
            className="min-h-[44px] flex-1"
          >
            Exportar CSV
          </Button>
          <Button
            variant="secondary"
            onClick={clearTelemetry}
            disabled={telemetryCount === 0}
            icon={<Trash2 size={15} aria-hidden />}
            className="min-h-[44px] flex-1"
          >
            Limpar registros
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Bot size={16} className="text-brand-600 dark:text-brand-200" aria-hidden />
          <h2 className="text-base font-semibold text-ink dark:text-white">Assistente IA local (opt-in)</h2>
        </div>
        <p className="field-helper">
          Sugere a alternativa marcada em questões duvidosas e pode ler a folha inteira
          usando um modelo de visão no <strong>Ollama deste computador</strong>. Nada sai
          do aparelho. Desligado por padrão.
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 min-h-[44px] cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={e => { setAiEnabled(e.target.checked); setAiAssistEnabled(e.target.checked); }}
            className="w-5 h-5 accent-brand-500"
            aria-label="Ativar assistente de correção com IA local"
          />
          Ativar assistente IA na revisão
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {aiStatus
            ? (aiStatus.available
              ? `Ollama disponível · modelo ${aiStatus.model}`
              : `Ollama indisponível${aiStatus.model ? ` · modelo ${aiStatus.model}` : ''}`)
            : 'Status do Ollama ainda não verificado.'}
        </p>
        {aiStatus && !aiStatus.available && (
          <p className="callout-info mt-3" role="status">
            {aiStatus.error || 'Ollama não detectado.'}
          </p>
        )}
        <Button
          variant="secondary"
          onClick={testAi}
          loading={aiTesting}
          icon={<Bot size={15} aria-hidden />}
          className="mt-3 min-h-[44px]"
        >
          Testar Ollama
        </Button>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Database size={16} className="text-brand-600 dark:text-brand-200" aria-hidden />
            <h2 className="text-base font-semibold text-ink dark:text-white">Backup de dados</h2>
          </div>
          <p className="field-helper">Baixe o dump JSON do banco ou restaure um backup anterior. A restauração substitui os dados atuais.</p>
          {backupMsg && (
            <p className="callout-info mt-3" role="status">{backupMsg}</p>
          )}
          {restoreCounts && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Restaurado: {restoreCounts.users} usuário(s), {restoreCounts.avaliacoes} prova(s), {restoreCounts.alunos} aluno(s), {restoreCounts.gabaritos} gabarito(s).
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <Button
              variant="secondary"
              onClick={doDownload}
              loading={backupBusy}
              icon={<Download size={15} aria-hidden />}
              className="min-h-[44px] flex-1"
            >
              Baixar backup
            </Button>
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={backupBusy}
              icon={<FileUp size={15} aria-hidden />}
              className="min-h-[44px] flex-1"
            >
              Restaurar backup
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Arquivo de backup JSON"
              onChange={e => {
                const f = e.target.files?.[0] ?? null;
                setRestoreFile(f);
                if (f) setConfirmRestore(true);
              }}
            />
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Info size={16} className="text-brand-600 dark:text-brand-200" aria-hidden />
          <h2 className="text-base font-semibold text-ink dark:text-white">Sobre o aplicativo</h2>
        </div>
        <dl className="text-sm space-y-1.5 mt-2">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Versão</dt>
            <dd className="font-medium text-ink dark:text-gray-100">v1.0 — Gabarito+</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">API</dt>
            <dd className="font-medium text-ink dark:text-gray-100 break-all text-right">{getApiBase() || '(mesma origem)'}/api</dd>
          </div>
        </dl>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => { setTesting(true); setConnTest(null); setConnTest(await testConnection()); setTesting(false); }}
          loading={testing}
          className="mt-3 min-h-[44px]"
        >
          Testar conexão com a API
        </Button>
        {connTest && (
          <p className={`mt-2 text-xs ${connTest.ok ? 'text-success-600' : 'text-danger-600'}`} role="status">
            {connTest.ok ? `✔ ${connTest.detail}` : `✖ ${connTest.detail}`}
          </p>
        )}
      </div>

      <Modal
        open={confirmRestore}
        onClose={() => { setConfirmRestore(false); setRestoreFile(null); if (fileRef.current) fileRef.current.value = ''; }}
        title="Restaurar backup?"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setConfirmRestore(false); setRestoreFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={doRestore} loading={backupBusy} icon={<TriangleAlert size={15} aria-hidden />}>
              Restaurar e substituir
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          O arquivo <strong>{restoreFile?.name}</strong> vai <strong>substituir todos os dados atuais</strong> do banco.
          Essa ação não pode ser desfeita. Deseja continuar?
        </p>
      </Modal>
    </div>
  );
}
