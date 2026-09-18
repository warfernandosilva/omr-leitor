// ─── Guia de captura por modelo de gabarito ───
// Funções puras (testáveis em Node, sem DOM):
// - maior retângulo A4 que cabe no visor, sem distorção;
// - posição das 4 âncoras de cada modelo projetadas no guia (alvos 🎯);
// - limiares do detector calibrados por modelo.
//
// Âncoras normalizadas (0..1 do cartão 1448×2048):
// - Padrão: cantos externos dos ArUcos 104px → quad x 0.059–0.941 / y 0.234–0.941
// - SAE/Colar: quadrados 40px (margem 64, topo 1140, base 1900) → x 0.044–0.956 / y 0.557–0.928
import { GuideThresholds, DEFAULT_THRESHOLDS } from './frame-guides';
import { CARD_WIDTH, CARD_HEIGHT } from './card-template';

export type CaptureTemplate = 'padrao' | 'sae' | 'colar';

export const CARD_ASPECT = CARD_WIDTH / CARD_HEIGHT; // ≈0.7071 (A4 retrato)

// Retângulo em coords normalizadas do overlay (0..100, como o SVG do visor)
export interface GuideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnchorTargets {
  TL: { x: number; y: number };
  TR: { x: number; y: number };
  BR: { x: number; y: number };
  BL: { x: number; y: number };
}

// Cantos externos das âncoras em coords do cartão (0..1)
const ANCHOR_BOX: Record<CaptureTemplate, { x0: number; y0: number; x1: number; y1: number }> = {
  // ArUco 104px: TL(86,479) TR(1258,479) BR(1258,1824) BL(86,1824)
  padrao: {
    x0: 86 / CARD_WIDTH, y0: 479 / CARD_HEIGHT,
    x1: (1258 + 104) / CARD_WIDTH, y1: (1824 + 104) / CARD_HEIGHT,
  },
  // Quadrados 40px: x 64..1384, y 1140..1900 (mesma geometria SAE e Colar)
  sae: {
    x0: 64 / CARD_WIDTH, y0: 1140 / CARD_HEIGHT,
    x1: 1384 / CARD_WIDTH, y1: 1900 / CARD_HEIGHT,
  },
  colar: {
    x0: 64 / CARD_WIDTH, y0: 1140 / CARD_HEIGHT,
    x1: 1384 / CARD_WIDTH, y1: 1900 / CARD_HEIGHT,
  },
};

const VIEW_MARGIN = 4; // % livre em cada borda do visor

// Maior A4 (proporção real, sem distorção) que cabe no visor viewW×viewH
export function guideRectFor(viewW: number, viewH: number): GuideRect {
  if (!(viewW > 0) || !(viewH > 0)) return fallbackGuide();
  const avail = 100 - VIEW_MARGIN * 2;
  const viewAspect = viewW / viewH; // w/h em pixels
  // largura-fw → altura-fh mantendo A4 em pixels: w_px/h_px = CARD_ASPECT
  // (w/100*viewW) / (h/100*viewH) = CARD_ASPECT  →  h = w * viewAspect / CARD_ASPECT
  let w = avail;
  let h = (w * viewAspect) / CARD_ASPECT;
  if (h > avail) {
    h = avail;
    w = (h * CARD_ASPECT) / viewAspect;
  }
  return { x: (100 - w) / 2, y: (100 - h) / 2, w, h };
}

// Guia padrão quando o visor ainda não foi medido (celular retrato típico)
export function fallbackGuide(): GuideRect {
  return guideRectFor(360, 640);
}

// Posição das 4 âncoras projetadas dentro do guia (coords 0..100 do overlay)
export function anchorTargetsFor(template: CaptureTemplate, guide: GuideRect): AnchorTargets {
  const box = ANCHOR_BOX[template];
  const px = (fx: number) => guide.x + fx * guide.w;
  const py = (fy: number) => guide.y + fy * guide.h;
  return {
    TL: { x: px(box.x0), y: py(box.y0) },
    TR: { x: px(box.x1), y: py(box.y0) },
    BR: { x: px(box.x1), y: py(box.y1) },
    BL: { x: px(box.x0), y: py(box.y1) },
  };
}

// Limiares do detector por modelo (SAE/Colar: âncoras pequenas, quad menor)
export function thresholdsFor(template: CaptureTemplate): GuideThresholds {
  if (template === 'padrao') return { ...DEFAULT_THRESHOLDS };
  return {
    ...DEFAULT_THRESHOLDS,
    minAreaFrac: 0.00012, // quadrado 40px ≈ 2.8% da folha (vs ArUco 7.2%)
    minCoverage: 0.08, // quad SAE ≈ 0.31 do frame com a folha cheia
    maxCoverage: 0.7,
  };
}

// Mapeia o templateType da prova (legado sem tipo = padrão)
export function captureTemplateFor(templateType?: string): CaptureTemplate {
  if (templateType === 'sae') return 'sae';
  if (templateType === 'colar') return 'colar';
  return 'padrao';
}
