import { useRef, useState } from 'react';
import { LabSessionSummary, LabUploadResultItem, labUploadImages } from '../../utils/lab-api';

interface Props {
  session: LabSessionSummary;
  onUploaded: () => void;
}

export default function UploadPanel({ session, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<LabUploadResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nArquivos, setNArquivos] = useState(0);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const imgs = Array.from(list).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
    setFiles(prev => [...prev, ...imgs.filter(f => !prev.some(p => p.name === f.name && p.size === f.size))]);
    setResults(null);
  };

  const upload = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const j = await labUploadImages(session.id, files, session.adaptive);
      setNArquivos(j.n_arquivos);
      setResults(j.results);
      setFiles([]);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setBusy(false);
    }
  };

  const ok = results?.filter(r => r.status === 'processed') ?? [];
  const fail = results?.filter(r => r.status === 'error') ?? [];

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Adicionar fotos</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Cada foto roda o motor de produção (<strong>{session.template}</strong>, {session.layout_mode === 'dual' ? 'dual' : 'simples'}).
        Fotos ilegíveis também são salvas como erro — assim a sessão mostra o lote inteiro.
      </p>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-gray-300 dark:border-gray-700'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <p className="text-sm text-gray-600 dark:text-gray-300">Arraste as fotos aqui</p>
        <button onClick={() => inputRef.current?.click()} className="btn btn-secondary mt-3 min-h-[44px]">
          Escolher fotos…
        </button>
      </div>

      {files.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">{files.length} arquivo(s) selecionado(s)</p>
            <button onClick={() => setFiles([])} className="text-xs text-gray-500 hover:underline">limpar</button>
          </div>
          <ul className="text-xs text-gray-500 dark:text-gray-400 max-h-28 overflow-y-auto space-y-0.5">
            {files.map(f => <li key={f.name + f.size}>{f.name}</li>)}
          </ul>
          <button onClick={upload} disabled={busy} className="btn btn-primary mt-3 min-h-[44px]">
            {busy ? 'Processando… (pode demorar)' : `Processar ${files.length} foto(s)`}
          </button>
        </div>
      )}

      {error && <div className="callout-danger mt-4">{error}</div>}

      {results && (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="badge-success">{ok.length} lida(s)</span>
            {fail.length > 0 && <span className="badge-danger">{fail.length} com erro</span>}
            <span className="text-xs text-gray-400 self-center">{nArquivos} enviada(s)</span>
          </div>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border text-sm ${
                  r.status === 'processed'
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30'
                    : 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{r.filename}</span>
                  <span className="text-xs text-gray-500 shrink-0">#{r.image_id}</span>
                </div>
                {r.status === 'processed' ? (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.total_questions} questões
                    {r.qr_id && <> · QR {r.qr_id}</>}
                    {r.floor_used != null && <> · floor {r.floor_used.toFixed(2)} ({r.floor_source})</>}
                  </p>
                ) : (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{r.error}</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Vá para a aba <strong>Revisão</strong> para conferir questão a questão.
          </p>
        </div>
      )}
    </div>
  );
}