import { Bot } from 'lucide-react';
import Button from '../ui/Button';

export interface AiSuggestionLike {
  suggestion?: string | null;
  confidence?: number | null;
  reason?: string;
}

interface Props {
  status: {
    available: boolean;
    model: string;
    error?: string | null;
  };
  error: string | null;
  progress: { done: number; total: number } | null;
  pending: number[];
  targets: number[];
  suggestions: Record<number, AiSuggestionLike>;
  list: number[];
  onRunAll: () => void;
  onStop: () => void;
  onApplyAll: () => void;
  onApply: (question: number, letter: string) => void;
  onIgnore: (question: number) => void;
}

/** Assistente IA local: sugestões por questão, sempre revisáveis antes de aplicar. */
export default function AiAssistPanel({
  status, error, progress, pending, targets, suggestions, list,
  onRunAll, onStop, onApplyAll, onApply, onIgnore,
}: Props) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-brand-600 dark:text-brand-200 shrink-0" aria-hidden />
        <h3 className="text-sm font-semibold text-[#172B4D] dark:text-white">Assistente IA local</h3>
        <span className="text-[11px] text-[#71809A] dark:text-gray-400">
          Ollama · {status.model}
        </span>
      </div>
      <p className="text-xs text-[#71809A] dark:text-gray-400">
        Gerado neste computador. <strong>Revise antes de aplicar</strong> — nada é salvo
        automaticamente.
      </p>
      {error && (
        <p className="callout-info text-xs" role="status">{error}</p>
      )}

      <div className="rounded-lg border border-line dark:border-gray-700 p-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            loading={progress != null}
            disabled={progress != null || pending.length === 0}
            icon={<Bot size={15} aria-hidden />}
            onClick={onRunAll}
          >
            {progress
              ? `Conferindo ${progress.done}/${progress.total}…`
              : 'Corrigir tudo com IA'}
          </Button>
          {progress && (
            <Button size="sm" variant="secondary" onClick={onStop}>
              Parar
            </Button>
          )}
          <span className="text-[11px] text-[#71809A] dark:text-gray-400">
            {targets.length} questão(ões) marcadas nesta folha
            {Object.keys(suggestions).length > 0
              && ` · IA respondeu ${Object.keys(suggestions).length}`}
          </span>
        </div>
        <p className="text-[11px] text-[#71809A] dark:text-gray-400">
          Uma questão por vez, com o recorte da linha. Marca fraca que o OMR deu como
          em branco também é conferida; linha sem nenhuma tinta não é enviada — nela o
          modelo inventa uma letra.
        </p>
        {Object.keys(suggestions).length > 0 && (
          <Button size="sm" onClick={onApplyAll}>
            Aplicar as {Object.keys(suggestions).length} sugestões
          </Button>
        )}
      </div>

      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((q) => {
            const s = suggestions[q];
            const conf = s?.confidence != null ? Math.round(s.confidence * 100) : null;
            return (
              <li key={q} className="rounded-lg border border-line dark:border-gray-700 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#172B4D] dark:text-gray-100">Questão {q}</span>
                  {conf != null && (
                    <span className="text-[11px] text-[#71809A] dark:text-gray-400">{conf}% confiança</span>
                  )}
                </div>
                {s?.suggestion ? (
                  <p className="text-sm text-[#172B4D] dark:text-gray-100 mt-1">
                    Sugestão: <strong>{s.suggestion}</strong>
                  </p>
                ) : null}
                <p className="text-xs text-[#71809A] dark:text-gray-400">{s.reason}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {s.suggestion && /^[ABCD]$/.test(s.suggestion) && (
                    <Button size="sm" onClick={() => onApply(q, s.suggestion as string)}>
                      Aplicar {s.suggestion}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => onIgnore(q)}>
                    Ignorar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
