// ─── Gabarito por foto: converte a leitura OMR em gabarito + marcações ───
// Função pura (testável): recebe o resultado de /api/omr/process e devolve
// o gabarito preenchível + as questões que exigem revisão do professor.
import type { ProcessResult } from './api';

export type KeyFlag = 'blank' | 'duplicate' | 'low';

export interface KeyFromPhoto {
  /** respostas lidas (só questões com vencedor claro ou baixa confiança) */
  key: Record<number, string>;
  /** questões a revisar, com o motivo */
  flags: Record<number, KeyFlag>;
  readCount: number;
  blankCount: number;
  duplicateCount: number;
  lowCount: number;
  /** modelo detectado divergente do esperado (fallback cruzado do backend) */
  mismatchNote?: string;
}

export function keyFromProcessResult(
  result: ProcessResult,
  totalQuestions: number,
  expectedTemplate?: 'padrao' | 'sae' | 'colar' | 'saev',
): KeyFromPhoto {
  const inRange = (q: number) => q >= 1 && q <= totalQuestions;

  const key: Record<number, string> = {};
  const flags: Record<number, KeyFlag> = {};

  const answers = result.answers ?? {};
  for (const [qs, letter] of Object.entries(answers)) {
    const q = Number(qs);
    if (inRange(q) && letter) key[q] = letter;
  }

  for (const q of result.blankQuestions ?? []) {
    if (inRange(q)) flags[q] = 'blank';
  }
  for (const q of result.duplicateQuestions ?? []) {
    if (inRange(q)) flags[q] = 'duplicate';
  }
  for (const q of result.lowConfidence ?? []) {
    if (inRange(q) && !flags[q]) flags[q] = 'low';
  }

  const mismatchNote = expectedTemplate && result.templateUsed && result.templateUsed !== expectedTemplate
    ? `Foto lida no modelo ${result.templateUsed} (esperado: ${expectedTemplate}) — confira o cartão.`
    : undefined;

  return {
    key,
    flags,
    readCount: Object.keys(key).length,
    blankCount: Object.values(flags).filter(f => f === 'blank').length,
    duplicateCount: Object.values(flags).filter(f => f === 'duplicate').length,
    lowCount: Object.values(flags).filter(f => f === 'low').length,
    mismatchNote,
  };
}
