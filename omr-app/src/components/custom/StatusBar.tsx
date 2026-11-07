import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface StatusBarProps {
  /** Erros de validação + avisos de completude do modelo. */
  pendings: number;
  zoom: number;
  pageIdx: number;
  nPages: number;
  baseW: number;
  baseH: number;
  onDiagnosticoClick: () => void;
}

export default function StatusBar({
  pendings, zoom, pageIdx, nPages, baseW, baseH, onDiagnosticoClick,
}: StatusBarProps) {
  const isReady = pendings === 0;

  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-gray-600 dark:text-gray-400 border-t border-line dark:border-gray-800">
      <div className="flex items-center gap-3">
        <span className="font-mono">{baseW}×{baseH} px</span>
        <span className="w-px h-3 bg-gray-300 dark:bg-gray-700" />
        <span>Página {pageIdx + 1} de {nPages}</span>
        <span className="w-px h-3 bg-gray-300 dark:bg-gray-700" />
        <button
          type="button"
          onClick={onDiagnosticoClick}
          className={`flex items-center gap-1 min-h-[24px] -my-1 px-1 rounded font-medium transition-colors ${isReady ? 'text-green-600' : 'text-amber-600 hover:text-amber-700'}`}
        >
          {isReady ? <CheckCircle2 size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
          {isReady ? 'Pronto para ler' : `${pendings} pendência(s) →`}
        </button>
      </div>
      <span>Zoom: {Math.round(zoom * 100)}%</span>
    </div>
  );
}
