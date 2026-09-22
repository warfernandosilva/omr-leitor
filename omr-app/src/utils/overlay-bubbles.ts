// ─── Posições das bolhas p/ o overlay da revisão (coords do template 1448×2048) ───
// Centraliza a diferença entre os layouts: 1 disciplina usa a geometria
// SINGLE_X/singleQuestionYFor (colunas centrais), dual usa PORTUGUESE_X/
// MATHEMATICS_X/questionYFor. O overlay desenhava sempre dual — por isso as
// bolinhas caíam fora no cartão 1 disciplina.
import type { Exam } from '../types';
import {
  BUBBLE_RADIUS, PORTUGUESE_X, MATHEMATICS_X, questionYFor,
  SINGLE_X, SINGLE_BUBBLE_RADIUS, singleQuestionYFor,
} from './card-template';
import { SAEV_SIDE, saevBubbleCenter, saevRowYs } from './saev-template';

export const OVERLAY_LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface OverlayCell {
  q: number; // questão global (dual: MAT = qps + linha)
  letter: string;
  x: number;
}

export interface OverlayRow {
  row: number; // linha 1-based dentro da disciplina
  y: number;
  r: number;
  cells: OverlayCell[];
}

type ExamGeom = Pick<Exam, 'questionsPerSubject' | 'layoutMode'>;

export function isSingleLayout(exam: ExamGeom): boolean {
  return exam.layoutMode === 'single';
}

// Uma linha da grade (LP no dual, única no single) com as células A–D de cada disciplina
export function overlayRowFor(exam: ExamGeom, row: number): OverlayRow {
  const qps = exam.questionsPerSubject || 0;
  if (isSingleLayout(exam)) {
    const ys = singleQuestionYFor(qps);
    return {
      row,
      y: ys[row - 1] ?? 0,
      r: SINGLE_BUBBLE_RADIUS,
      cells: SINGLE_X.map((x, ci) => ({ q: row, letter: OVERLAY_LETTERS[ci], x })),
    };
  }
  const ys = questionYFor(qps);
  const y = ys[row - 1] ?? 0;
  const cells: OverlayCell[] = PORTUGUESE_X.map((x, ci) => ({
    q: row, letter: OVERLAY_LETTERS[ci], x,
  }));
  cells.push(...MATHEMATICS_X.map((x, ci) => ({
    q: row + qps, letter: OVERLAY_LETTERS[ci], x,
  })));
  return { row, y, r: BUBBLE_RADIUS, cells };
}

// ─── Overlay do Gabarito SAEV (quadrados; dual LP=1..qps, MAT=qps+1..2qps) ───
export interface OverlaySaevRow {
  row: number; // linha 1-based dentro da disciplina
  y: number;
  side: number;
  cells: OverlayCell[]; // LP e MAT na mesma linha física
}

export function overlaySaevRowFor(qps: number, row: number): OverlaySaevRow {
  const ys = saevRowYs(qps);
  const y = ys[row - 1] ?? 0;
  const rows = Math.ceil(Math.max(1, qps) / 2);
  const cells: OverlayCell[] = [];
  for (let col = 0; col < 4; col++) {
    const base = col < 2 ? 0 : qps;
    const off = col % 2 === 0 ? 0 : rows;
    const q = base + off + row;
    if (q > base + qps) continue;
    for (let ci = 0; ci < 4; ci++) {
      const [x] = saevBubbleCenter(col, row - 1, ci, qps);
      cells.push({ q, letter: OVERLAY_LETTERS[ci], x });
    }
  }
  return { row, y, side: SAEV_SIDE, cells };
}

// Posição de um quadrado específico (p/ o mapa de duplicadas)
export function overlaySaevBubbleFor(
  qps: number, q: number, letter: string,
): { x: number; y: number; side: number } | null {
  const ci = OVERLAY_LETTERS.indexOf(letter as (typeof OVERLAY_LETTERS)[number]);
  if (ci < 0) return null;
  const rows = Math.ceil(Math.max(1, qps) / 2);
  const inMat = q > qps;
  const local = inMat ? q - qps : q;
  if (local < 1 || local > qps) return null;
  const col = (inMat ? 2 : 0) + (local > rows ? 1 : 0);
  const r = (local - 1) % rows;
  const [x, y] = saevBubbleCenter(col, r, ci, qps);
  return { x, y, side: SAEV_SIDE };
}
// Posição de uma bolha específica (p/ o mapa de duplicadas)
export function overlayBubbleFor(
  exam: ExamGeom, q: number, letter: string,
): { x: number; y: number; r: number } | null {
  const ci = OVERLAY_LETTERS.indexOf(letter as (typeof OVERLAY_LETTERS)[number]);
  if (ci < 0) return null;
  const qps = exam.questionsPerSubject || 0;
  if (isSingleLayout(exam)) {
    const y = singleQuestionYFor(qps)[q - 1];
    if (y == null) return null;
    return { x: SINGLE_X[ci], y, r: SINGLE_BUBBLE_RADIUS };
  }
  const y = questionYFor(qps)[(q - 1) % Math.max(1, qps)];
  if (y == null) return null;
  const xs = q > qps ? MATHEMATICS_X : PORTUGUESE_X;
  return { x: xs[ci], y, r: BUBBLE_RADIUS };
}
