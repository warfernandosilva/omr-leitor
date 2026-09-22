// ─── Recorte do gabarito p/ a visualização da correção ───
// Bounding-box da grade de bolhas (+ respiro) em coords do template
// 1448×2048. A revisão mostra só essa região, com as mesmas marcações.
import type { Exam } from '../types';
import {
  CARD_WIDTH, CARD_HEIGHT,
  BUBBLE_RADIUS, PORTUGUESE_X, MATHEMATICS_X, questionYFor,
  SINGLE_X, SINGLE_BUBBLE_RADIUS, singleQuestionYFor,
} from './card-template';
import { SAE_BUBBLE_RADIUS, saeBubbleCenter } from './sae-template';

export const CROP_PAD = 40;

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CropInput = Pick<Exam, 'questionsPerSubject' | 'layoutMode' | 'totalQuestions' | 'templateType'>;

export function gabaritoCropBox(exam: CropInput): CropBox {
  let xs: number[];
  let ys: number[];
  let r: number;

  if (exam.templateType === 'sae' || exam.templateType === 'colar') {
    const n = Math.max(1, exam.totalQuestions || 0);
    xs = [];
    ys = [];
    for (let q = 1; q <= n; q++) {
      for (let ci = 0; ci < 4; ci++) {
        const [x, y] = saeBubbleCenter(q, ci);
        xs.push(x);
        ys.push(y);
      }
    }
    r = SAE_BUBBLE_RADIUS;
  } else if (exam.layoutMode === 'single') {
    xs = [...SINGLE_X];
    ys = singleQuestionYFor(exam.questionsPerSubject || 0);
    r = SINGLE_BUBBLE_RADIUS;
  } else {
    xs = [...PORTUGUESE_X, ...MATHEMATICS_X];
    ys = questionYFor(exam.questionsPerSubject || 0);
    r = BUBBLE_RADIUS;
  }

  const x0 = Math.max(0, Math.min(...xs) - r - CROP_PAD);
  const y0 = Math.max(0, Math.min(...ys) - r - CROP_PAD);
  const x1 = Math.min(CARD_WIDTH, Math.max(...xs) + r + CROP_PAD);
  const y1 = Math.min(CARD_HEIGHT, Math.max(...ys) + r + CROP_PAD);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
