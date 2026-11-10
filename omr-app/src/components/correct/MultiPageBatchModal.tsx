import { createPortal } from 'react-dom';
import Button from '../ui/Button';

export interface MultiPageBatchResult {
  idx: number;
  answers: Record<string, string>;
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  nPages: number;
  busy: boolean;
  files: File[][];
  results: MultiPageBatchResult[];
  onFilesChange: (page: number, files: File[]) => void;
  onProcess: () => void;
}

/** Lote multi-página do Gabarito Personalizado: uma lista de fotos por página. */
export default function MultiPageBatchModal({
  open, onClose, nPages, busy, files, results, onFilesChange, onProcess,
}: Props) {
  if (!open) return null;

  const complete = files.every((page) => page.length > 0);
  const minLen = files.length ? Math.min(...files.map((f) => f.length)) : 0;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-2xl space-y-3">
        <div>
          <h3 className="text-lg font-bold text-[#172B4D] dark:text-white">Lote multi-página</h3>
          <p className="text-xs text-[#71809A] dark:text-gray-400">
            Envie, para cada página, a lista de fotos na mesma ordem. As respostas são casadas por posição.
          </p>
        </div>

        <div className="space-y-3">
          {Array.from({ length: nPages }, (_, p) => (
            <div key={p} className="space-y-1">
              <label className="text-sm font-medium text-[#172B4D] dark:text-gray-200">Página {p + 1}</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onFilesChange(p, Array.from(e.target.files ?? []))}
                className="input !min-h-[44px]"
              />
              <p className="text-xs text-[#71809A] dark:text-gray-400">
                {(files[p]?.length ?? 0)} arquivo(s)
              </p>
            </div>
          ))}
        </div>

        {files.some((f, i) => i > 0 && f.length !== files[0].length) && (
          <p className="callout-warning text-xs">
            Atenção: as páginas têm quantidades diferentes de arquivos. Serão processados os primeiros {minLen} de cada.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Fechar
          </Button>
          <Button size="sm" onClick={onProcess} disabled={busy || !complete}>
            {busy ? 'Processando...' : 'Processar lote'}
          </Button>
        </div>

        {results.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-[#172B4D] dark:text-white">Resultados ({results.length})</h4>
            <div className="table-shell">
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead className="bg-[#F8FAFF] dark:bg-gray-800">
                    <tr>
                      <th className="table-th w-12">#</th>
                      <th className="table-th">Respostas</th>
                      <th className="table-th">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.idx}>
                        <td className="table-td tabular-nums">{r.idx}</td>
                        <td className="table-td font-mono text-xs">
                          {Object.entries(r.answers).map(([q, a]) => `${q}:${a}`).join(' ') || '—'}
                        </td>
                        <td className="table-td">
                          {r.error
                            ? <span className="text-danger-600 dark:text-danger-100">{r.error}</span>
                            : <span className="text-success-600 dark:text-success-100">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
