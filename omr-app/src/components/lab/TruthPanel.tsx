import { useRef, useState } from 'react';
import { LabSessionSummary, labSaveGroundTruth, labTotalQuestions } from '../../utils/lab-api';
import { TruthParseResult, downloadTruthTemplate, formatTruthPreview, parseGroundTruthFile, parseGroundTruthText } from '../../utils/lab-truth';

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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Gabarito esperado</h3>
        <button
          onClick={() => downloadTruthTemplate(total, currentTruth, `gabarito-sessao-${session.id}.xlsx`)}
          className="btn btn-secondary btn-sm min-h-[44px]"
        >
          Baixar modelo (XLSX)
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Sem gabarito não há métrica. O cartão deste modelo tem <strong>{total}</strong> questões.
        {nCurrent > 0 && <> Já salvo: <strong>{nCurrent}</strong>.</>}
        {' '}Baixe o modelo, preencha a coluna <code>gabarito</code> e reimporte.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-2">Importar planilha (CSV/XLSX)</p>
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
          <button onClick={() => fileRef.current?.click()} className="btn btn-secondary min-h-[44px]">
            Escolher arquivo…
          </button>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <label className="text-sm font-medium text-gray-800 dark:text-gray-100" htmlFor="lab-truth-text">
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
          <button onClick={useText} className="btn btn-secondary btn-sm mt-2 min-h-[44px]">Interpretar texto</button>
        </div>
      </div>

      {parsed && (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="badge-info">formato: {parsed.mode}</span>
            <span className={parsed.n === total ? 'badge-success' : 'badge-warning'}>
              {parsed.n}/{total} questões
            </span>
            {source === 'file' && parsed.versions.length > 1 && (
              <span className="text-xs text-gray-500">planilha com {parsed.versions.length} linhas — usando a última</span>
            )}
          </div>
          <p className="font-mono text-xs text-gray-700 dark:text-gray-300 break-words">{formatTruthPreview(parsed.truth, 20)}</p>

          {parsed.warnings.length > 0 && (
            <ul className="mt-3 text-xs text-amber-700 dark:text-amber-300 list-disc pl-5 space-y-0.5">
              {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {parsed.ignored.length > 0 && (
            <details className="mt-3 text-xs text-gray-500">
              <summary className="cursor-pointer">{parsed.ignored.length} linha(s) ignorada(s)</summary>
              <ul className="mt-2 space-y-0.5">
                {parsed.ignored.slice(0, 20).map((ig, i) => (
                  <li key={i}>linha {ig.row}: {ig.reason}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button onClick={save} disabled={busy || parsed.n === 0} className="btn btn-primary min-h-[44px]">
              {busy ? 'Salvando…' : 'Salvar gabarito nesta sessão'}
            </button>
            {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Gabarito salvo.</span>}
          </div>
        </div>
      )}

      {error && <div className="callout-danger mt-4">{error}</div>}
    </div>
  );
}