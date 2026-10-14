import type { Exam } from '../types';
import { isHerbyExam, isSimuladoExam } from '../types';

// ─── Rótulo da etapa 2 da timeline de leitura, conforme o modelo ───
// Função pura (testável): cada modelo ancora a leitura de um jeito.

/** Rótulo da etapa 2 ("âncoras") conforme o modelo do cartão. */
export function anchorLabelFor(exam?: Pick<Exam, 'templateType'> | null): string {
  if (isSimuladoExam(exam)) return 'Detecção das réguas da tabela';
  if (isHerbyExam(exam)) return 'Leitura do QR duplo';
  return 'Detecção das âncoras';
}
