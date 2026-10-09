// ─── Recorte do gabarito p/ a visualização da correção ───
// Bounding-box das ÂNCORAS DE CANTO em coords do template 1448×2048, com 0 px
// de respiro: o quadro termina na borda externa dos ArUcos/quadrados. Assim os
// 4 marcadores de alinhamento ficam visíveis na revisão junto da grade.
//
// Só para os modelos com âncoras de canto (padrao/sae/colar/saev/simulado). O
// Herby não tem ArUco — os 2 QRs estão ambos na metade esquerda e o bbox deles
// cortaria a grade —, então segue com bbox da grade + CROP_PAD até os
// retângulos pretos entrarem no gabarito dele.
import type { Exam } from '../types';
import {
  CARD_WIDTH, CARD_HEIGHT,
  BUBBLE_RADIUS, PORTUGUESE_X, MATHEMATICS_X, questionYFor,
  SINGLE_X, SINGLE_BUBBLE_RADIUS, singleQuestionYFor,
} from './card-template';
import { SAE_BUBBLE_RADIUS, saeBubbleCenter } from './sae-template';
import { SAEV_SIDE, saevBubbleCenter, saevBlockRows } from './saev-template';
import { HERBY_SIDE, herbyBubbleCenter, herbyBlockRows } from './herby-template';
import { simuladoGridExtent } from './simulado-template';
import { anchorBoxFor } from './anchors';

/** Respiro (px) fora do bbox da grade — vale só no ramo Herby. */
export const CROP_PAD = 40;

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CropInput = Pick<Exam, 'questionsPerSubject' | 'layoutMode' | 'totalQuestions' | 'templateType'>;

// BBox da grade de bolhas, já dilatado pelo raio (sem respiro extra).
// Serve de base para o Herby e p/ os testes provarem que as âncoras contêm a grade.
function gridExtent(exam: CropInput): { x0: number; y0: number; x1: number; y1: number } {
  let xs: number[];
  let ys: number[];
  let r: number;

  if (exam.templateType === 'saev') {
    const qps = Math.max(1, exam.questionsPerSubject || 0);
    xs = [];
    ys = [];
    for (const [, col, row] of saevBlockRows(qps)) {
      for (let ci = 0; ci < 4; ci++) {
        const [x, y] = saevBubbleCenter(col, row, ci, qps);
        xs.push(x);
        ys.push(y);
      }
    }
    r = SAEV_SIDE / 2;
  } else if (exam.templateType === 'herby') {
    const qps = Math.max(1, exam.questionsPerSubject || 0);
    const layout = exam.layoutMode === 'single' ? 'single' : 'dual';
    xs = [];
    ys = [];
    for (const [, col, row] of herbyBlockRows(qps, layout)) {
      for (let ci = 0; ci < 4; ci++) {
        const [x, y] = herbyBubbleCenter(col, row, ci, qps);
        xs.push(x);
        ys.push(y);
      }
    }
    r = HERBY_SIDE / 2;
  } else if (exam.templateType === 'simulado') {
    // tabela única fixa: 22 questões, sem layout dual
    const g = simuladoGridExtent();
    return g;
  } else if (exam.templateType === 'sae' || exam.templateType === 'colar') {
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

  return {
    x0: Math.min(...xs) - r,
    y0: Math.min(...ys) - r,
    x1: Math.max(...xs) + r,
    y1: Math.max(...ys) + r,
  };
}

/** BBox da grade de bolhas (0 px de respiro) — só p/ asserção de invariantes. */
export function gabaritoGridBox(exam: CropInput): CropBox {
  const g = gridExtent(exam);
  return { x: g.x0, y: g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0 };
}

export function gabaritoCropBox(exam: CropInput): CropBox {
  const t = exam.templateType;

  // Modelos com âncoras de canto: o recorte É o quadro das âncoras.
  // Não depende de questionsPerSubject/layoutMode — as âncoras não se movem.
  if (t !== 'herby') {
    const b = anchorBoxFor(t ?? 'padrao');
    return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  }

  const g = gridExtent(exam);
  const x0 = Math.max(0, g.x0 - CROP_PAD);
  const y0 = Math.max(0, g.y0 - CROP_PAD);
  const x1 = Math.min(CARD_WIDTH, g.x1 + CROP_PAD);
  const y1 = Math.min(CARD_HEIGHT, g.y1 + CROP_PAD);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
