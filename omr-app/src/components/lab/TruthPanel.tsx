import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp, Save, Wand2 } from 'lucide-react';
import { LabSessionSummary, labSaveGroundTruth, labTotalQuestions } from '../../utils/lab-api';
import { TruthParseResult, downloadTruthTemplate, formatTruthPreview, parseGroundTruthFile, parseGroundTruthText } from '../../utils/lab-truth';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

interface Props {
  session: LabSessionSummary;
  currentTruth: Record<string, string> | null;
  onSaved: (truth: Record<string, string>) => void;
}

export default function TruthPanel({ session, currentTruth, onSaved }: Props) {
  const total = labTotalQuestions(session);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<TruthParseResult | null>(null);
  const [source, setSource] = useState<'file' | 'text' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = (result: TruthParseResult, from: 'file' | 'text') => {
    setParsed(result);
    setSource(from);
    setSaved(false);
    setError(result.n === 0 ? 'Nenhuma resposta válida encontrada no arquivo.' : null);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      apply(await parseGroundTruthFile(file), 'file');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ler o arquivo');
    }
  };

  const useText = () => {
    setError(null);
    if (!text.trim()) { setError('Cole o gabarito antes de interpretar.'); return; }
    apply(parseGroundTruthText(text), 'text');
  };

  const save = async () => {
    if (!parsed || parsed.n === 0) return;
    setBusy(true);
    setError(null);
    try {
      await labSaveGroundTruth(session.id, parsed.truth);
      setSaved(true);
      onSaved(parsed.truth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o gabarito');
    } finally {
      setBusy(false);
    }
  };

  const nCurrent = currentTruth ? Object.keys(currentTruth).length : 0;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h3 className="text-lg font-semibold text-ink dark:text-white">Gabarito esperado</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadTruthTemplate(total, currentTruth, `gabarito-sessao-${session.id}.xlsx`)}
          icon={<Download size={15} aria-hidden />}
        >
          Baixar modelo (XLSX)
        </Button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Sem gabarito não há métrica. O cartão deste modelo tem <strong>{total}</strong> questões.
        {nCurrent > 0 && <> Já salvo: <strong>{nCurrent}</strong>.</>}
        {' '}Baixe o modelo, preencha a coluna <code>gabarito</code> e reimporte.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-dashed border-line dark:border-gray-700 p-4">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-100 mb-2">Importar planilha (CSV/XLSX)</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Duas colunas <code>questão</code> + <code>gabarito</code>, ou uma linha com os números das questões no cabeçalho.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onFile}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} icon={<FileUp size={16} aria-hidden />}>
            Escolher arquivo…
          </Button>
        </div>

        <div className="rounded-xl border border-line dark:border-gray-800 p-4">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-100" htmlFor="lab-truth-text">
            Ou cole o gabarito
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 mt-1">
            Aceita <code>1=A</code> por linha ou a sequência <code>A B C D</code>.
          </p>
          <textarea
            id="lab-truth-text"
            className="input font-mono text-xs h-24"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'1=A\n2=C\n3=D\n4=B\n…'}
          />
          <Button variant="secondary" size="sm" onClick={useText} icon={<Wand2 size={15} aria-hidden />} className="mt-2">Interpretar texto</Button>
        </div>
      </div>

      {parsed && (
        <div className="mt-4 rounded-xl border border-line dark:border-gray-800 p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone="info">formato: {parsed.mode}</Badge>
            <Badge tone={parsed.n === total ? 'success' : 'warning'}>
              {parsed.n}/{total} questões
            </Badge>
            {source === 'file' && parsed.versions.length > 1 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">planilha com {parsed.versions.length} linhas — usando a última</span>
            )}
          </div>
          <p className="font-mono text-xs text-gray-600 dark:text-gray-300 break-words">{formatTruthPreview(parsed.truth, 20)}</p>

          {parsed.warnings.length > 0 && (
            <ul className="mt-3 text-xs text-warning-600 dark:text-warning-100 list-disc pl-5 space-y-0.5">
              {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {parsed.ignored.length > 0 && (
            <details className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              <summary className="cursor-pointer min-h-[44px]"> {parsed.ignored.length} linha(s) ignorada(s)</summary>
              <ul className="mt-2 space-y-0.5">
                {parsed.ignored.slice(0, 20).map((ig, i) => (
                  <li key={i}>linha {ig.row}: {ig.reason}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex items-center gap-3 mt-4">
            <Button onClick={save} loading={busy} disabled={parsed.n === 0} icon={<Save size={16} aria-hidden />}>
              Salvar gabarito nesta sessão
            </Button>
            {saved && <span className="inline-flex items-center gap-1 text-sm text-success-600 dark:text-success-100 font-medium"><CheckCircle2 size={15} aria-hidden /> Gabarito salvo.</span>}
          </div>
        </div>
      )}

      {error && <div className="callout-danger mt-4">{error}</div>}
    </div>
  );
}