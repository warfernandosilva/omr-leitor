import { useRef, useState } from 'react';
import { ImagePlus, Play } from 'lucide-react';
import { LabSessionSummary, LabUploadResultItem, labUploadImages } from '../../utils/lab-api';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

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
      <h3 className="text-lg font-semibold text-ink dark:text-white mb-1">Adicionar fotos</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Cada foto roda o motor de produção (<strong>{session.template}</strong>, {session.layout_mode === 'dual' ? 'dual' : 'simples'}).
        Fotos ilegíveis também são salvas como erro — assim a sessão mostra o lote inteiro.
      </p>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/15' : 'border-line dark:border-gray-700'
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
        <ImagePlus size={28} strokeWidth={1.5} className="text-gray-400 dark:text-gray-500 mx-auto mb-2" aria-hidden />
        <p className="text-sm text-gray-600 dark:text-gray-300">Arraste as fotos aqui</p>
        <Button variant="secondary" onClick={() => inputRef.current?.click()} className="mt-3">
          Escolher fotos…
        </Button>
      </div>

      {files.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm text-gray-600 dark:text-gray-300">{files.length} arquivo(s) selecionado(s)</p>
            <button onClick={() => setFiles([])} className="text-xs text-gray-500 dark:text-gray-400 hover:underline min-h-[44px] px-2">limpar</button>
          </div>
          <ul className="text-xs text-gray-500 dark:text-gray-400 max-h-28 overflow-y-auto space-y-0.5">
            {files.map(f => <li key={f.name + f.size}>{f.name}</li>)}
          </ul>
          <Button onClick={upload} loading={busy} icon={<Play size={16} aria-hidden />} className="mt-3">
            {busy ? 'Processando… (pode demorar)' : `Processar ${files.length} foto(s)`}
          </Button>
        </div>
      )}

      {error && <div className="callout-danger mt-4">{error}</div>}

      {results && (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge tone="success">{ok.length} lida(s)</Badge>
            {fail.length > 0 && <Badge tone="danger">{fail.length} com erro</Badge>}
            <span className="text-xs text-gray-400 dark:text-gray-500 self-center">{nArquivos} enviada(s)</span>
          </div>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border text-sm ${
                  r.status === 'processed'
                    ? 'border-success-500/30 bg-success-50/50 dark:bg-success-700/10'
                    : 'border-danger-500/30 bg-danger-50/50 dark:bg-danger-700/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-700 dark:text-gray-100 truncate">{r.filename}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">#{r.image_id}</span>
                </div>
                {r.status === 'processed' ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {r.total_questions} questões
                    {r.qr_id && <> · QR {r.qr_id}</>}
                    {r.floor_used != null && <> · floor {r.floor_used.toFixed(2)} ({r.floor_source})</>}
                  </p>
                ) : (
                  <p className="text-xs text-danger-600 dark:text-danger-100 mt-0.5">{r.error}</p>
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