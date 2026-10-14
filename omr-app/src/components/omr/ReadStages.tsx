import { Check, Loader2 } from 'lucide-react';

interface Props {
  /** Quantidade de etapas concluídas (0–8). A etapa `doneCount` é a atual. */
  doneCount: number;
  /** Rótulo da etapa 2, conforme o modelo do cartão. */
  anchorLabel: string;
}

const FIXED: [string, string, string, string, string, string] = [
  'Imagem recebida',
  'Correção de perspectiva',
  'Identificação das regiões das bolhas',
  'Interpretação das marcações',
  'Comparando com o gabarito oficial',
  'Calculando a pontuação',
];

/** Linha do tempo das 8 etapas da leitura (referência: "Processamento da leitura").
 *
 * As etapas 2–5 acontecem dentro da mesma chamada ao backend: enquanto ela
 * está no ar, a etapa 2 aparece como atual; ao chegar a resposta, as quatro
 * são marcadas de uma vez (todas concluíram no servidor). Nada aqui é
 * simulado por temporizador — cada marca reflete um marco real do fluxo.
 */
export default function ReadStages({ doneCount, anchorLabel }: Props) {
  const done = Math.max(0, Math.min(8, doneCount));
  const labels = [FIXED[0], anchorLabel, FIXED[1], FIXED[2], FIXED[3], FIXED[4], FIXED[5], 'Salvando o resultado'];
  const pct = Math.round((done / 8) * 100);

  return (
    <div>
      <ol className="space-y-2.5 text-left" aria-label="Etapas da leitura">
        {labels.map((label, i) => {
          const isDone = i < done;
          const isCurrent = i === done && done < 8;
          return (
            <li key={label} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0
                  ${isDone
                    ? 'bg-success-500 text-white'
                    : isCurrent
                      ? 'bg-brand-500 text-white'
                      : 'bg-surface text-gray-300 dark:bg-gray-800 dark:text-gray-600'}`}
              >
                {isDone ? (
                  <Check size={14} strokeWidth={3} />
                ) : isCurrent ? (
                  <Loader2 size={14} strokeWidth={2.5} className="animate-spin" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-current" />
                )}
              </span>
              <span
                className={`text-sm ${isDone || isCurrent
                  ? 'text-ink dark:text-gray-100 font-medium'
                  : 'text-gray-400 dark:text-gray-500'}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 tabular-nums" role="status">
        {done} de 8 etapas
      </p>
      <div className="w-full bg-line dark:bg-gray-700 rounded-full h-2 mt-1.5 overflow-hidden" aria-hidden>
        <div
          className={`${done >= 8 ? 'bg-success-500' : 'bg-brand-500'} h-2 rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {done < 8 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Este processo pode levar alguns segundos. Por favor, aguarde…
        </p>
      )}
    </div>
  );
}
