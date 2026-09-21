// ─── Fila de pendências: resultados que exigem revisão do professor ───
// Função pura (testável): a partir dos resultados salvos, devolve os itens
// acionáveis — duplicadas, leitura incerta ou QR ilegível sem identificação.
// Regras:
// - só o resultado MAIS RECENTE de cada aluno/prova pode pendente
//   (re-correção supera o resultado anterior);
// - resultados já marcados como revisados saem da fila;
// - resultados antigos (sem os campos novos) nunca geram pendência fantasma.
import type { StudentResult } from '../types';

export interface PendingItem {
  resultId: string;
  examId: string;
  studentName: string;
  duplicateQuestions: number[];
  lowConfidence: number[];
  qrIssue: boolean;
}

function identityKey(r: StudentResult): string {
  const who = r.codigoUnico || r.studentName.trim().toLowerCase() || r.id;
  return `${r.examId}::${who}`;
}

export function pendingFromResults(results: StudentResult[]): PendingItem[] {
  const latest = new Map<string, StudentResult>();
  for (const r of results) {
    const k = identityKey(r);
    const cur = latest.get(k);
    if (!cur || (r.timestamp ?? '') >= (cur.timestamp ?? '')) latest.set(k, r);
  }
  const out: PendingItem[] = [];
  for (const r of latest.values()) {
    if (r.reviewed) continue;
    const duplicateQuestions = r.duplicateQuestions ?? [];
    const lowConfidence = r.lowConfidence ?? [];
    const qrIssue = r.qrOk === false && !r.studentName.trim();
    if (!duplicateQuestions.length && !lowConfidence.length && !qrIssue) continue;
    out.push({
      resultId: r.id,
      examId: r.examId,
      studentName: r.studentName,
      duplicateQuestions,
      lowConfidence,
      qrIssue,
    });
  }
  return out;
}
