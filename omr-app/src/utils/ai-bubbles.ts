/**
 * Caixas normalizadas (0..1) das bolhas A–D de uma questão, para o recorte do
 * assistente local. Reaproveita a MESMA geometria do overlay da revisão, então
 * o recorte acompanha o modelo detectado (padrão, SAE, SAEV, Herby, Simulado e
 * Gabarito Personalizado).
 */

import type { Exam } from '../types';
import { CARD_HEIGHT, CARD_WIDTH } from './card-template';
import { SAE_BUBBLE_RADIUS, saeBubbleCenter } from './sae-template';
import {
  OVERLAY_LETTERS, customBubbleShape, overlayBubbleFor, overlayHerbyBubbleFor,
  overlaySaevBubbleFor, overlaySimuladoBubbleFor,
} from './overlay-bubbles';
import type { ExpandedBubble } from './custom-template-api';
import type { NormBox } from './ai-crop';

export type BubbleModel = 'padrao' | 'sae' | 'saev' | 'herby' | 'simulado' | 'custom';

type ExamGeom = Pick<Exam, 'questionsPerSubject' | 'layoutMode'>;

export interface CustomPageBubbles {
  bubbles: readonly ExpandedBubble[];
  pageW: number;
  pageH: number;
}

/** Caixa de uma bolha circular do template de 1448×2048 (coords do canvas). */
export function bubbleBox(x: number, y: number, r: number): NormBox {
  return {
    x: (x - r) / CARD_WIDTH,
    y: (y - r) / CARD_HEIGHT,
    w: (2 * r) / CARD_WIDTH,
    h: (2 * r) / CARD_HEIGHT,
  };
}

/** Caixa a partir de um raio já normalizado (Gabarito Personalizado). */
function shapeBox(cx: number, cy: number, rx: number, ry: number): NormBox {
  return { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry };
}

/**
 * Bolhas A–D da questão na página exibida. Lista vazia quando a questão não
 * pertence ao modelo/página (ex.: outra página do Gabarito Personalizado).
 */
export function questionBubbleBoxes(
  model: BubbleModel,
  exam: ExamGeom | null | undefined,
  question: number,
  custom?: CustomPageBubbles | null,
): NormBox[] {
  if (model === 'custom') {
    if (!custom || custom.pageW <= 0 || custom.pageH <= 0) return [];
    return custom.bubbles
      .filter((b) => b.question === question)
      .map((b) => {
        const shape = customBubbleShape(b, custom.pageW, custom.pageH);
        return shapeBox(shape.cx, shape.cy, shape.rx, shape.ry);
      });
  }
  if (!exam) return [];
  return OVERLAY_LETTERS.flatMap((letter) => {
    if (model === 'sae') {
      const ci = OVERLAY_LETTERS.indexOf(letter);
      const [x, y] = saeBubbleCenter(question, ci);
      return [bubbleBox(x, y, SAE_BUBBLE_RADIUS)];
    }
    if (model === 'saev') {
      const p = overlaySaevBubbleFor(exam.questionsPerSubject, question, letter);
      return p ? [bubbleBox(p.x, p.y, p.side / 2)] : [];
    }
    if (model === 'herby') {
      const p = overlayHerbyBubbleFor(
        exam.questionsPerSubject, question, letter,
        exam.layoutMode === 'single' ? 'single' : 'dual',
      );
      return p ? [bubbleBox(p.x, p.y, p.side / 2)] : [];
    }
    if (model === 'simulado') {
      const p = overlaySimuladoBubbleFor(question, letter);
      return p ? [bubbleBox(p.x, p.y, p.r)] : [];
    }
    const p = overlayBubbleFor(exam, question, letter);
    return p ? [bubbleBox(p.x, p.y, p.r)] : [];
  });
}
